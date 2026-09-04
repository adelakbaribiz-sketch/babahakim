// ── BabaHakim Backend · Application Service: Case Actions (PHASE 08) ──────
// The unified workflow endpoint's business core, moved OUT of the controller
// (was 263 lines inline). Every branch: zod-validated input → entity prep
// (transactional where multi-entity) → workflow-engine transition → events.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { executeTransition, assertGuards, getMachine } from '@/lib/workflow'
import { WorkflowAction } from '@/lib/constants'
import { genCode } from '@/server/core/ids'
import type { RequestContext } from '@/server/core/context'
import { AppError, BusinessRuleError, ValidationError, ErrorCode } from '@/server/core/errors'
import { writeAudit, toAuditReq } from '@/server/infrastructure/audit'
import { withTransaction } from '@/server/infrastructure/uow'
import { publish, Events } from '@/server/infrastructure/events'
import {
  assessmentSchema, prescriptionSubmitSchema, expert2ReviewSchema, doctorDecisionSchema,
  proformaSchema, shippingSchema,
} from '@/server/application/dto'
import { SHOP_SHIPPING_COST } from '@/server/domain/policies'
import { resolveAiAssistedFlag } from '@/server/infrastructure/ai/validation-gate'
import { finalizeFinalLabel } from '@/server/infrastructure/ai/datasets'
import { logger } from '@/server/core/logger'

type Body = Record<string, unknown>

export interface CaseActionOutcome {
  ok: true
  case: { id: string; status: string }
  extra?: Record<string, unknown>
}

export async function applyCaseAction(
  auth: AuthContext, ctx: RequestContext, caseId: string, rawBody: Body,
): Promise<CaseActionOutcome> {
  const c = await db.medicalCase.findUnique({ where: { id: caseId } })
  if (!c || c.deletedAt) throw new AppError('NOT_FOUND', 'پرونده یافت نشد', 404)
  if (auth.user.role === 'PATIENT' && c.patientId !== auth.user.id) {
    throw new AppError('FORBIDDEN', 'دسترسی غیرمجاز', 403)
  }

  const action = rawBody.action as WorkflowAction | undefined
  if (!action) throw new ValidationError('نوع اقدام مشخص نشده است')

  const actor = { id: auth.user.id, role: auth.user.role as never }
  const req = toAuditReq(ctx) // transport-neutral audit shim for the engine
  let extra: Record<string, unknown> | undefined

  switch (action) {
    // ── Expert 1: initial assessment (+ AI-review machine loop) ────────────
    case 'SUBMIT_ASSESSMENT': {
      const input = assessmentSchema.parse({ ...rawBody, diseases: rawBody.diseases || [] })
      const analyses = await db.aIAnalysis.findMany({
        where: { caseId, reviewStatus: 'PENDING_REVIEW' }, orderBy: { createdAt: 'desc' }, take: 1,
      })
      for (const a of analyses) {
        const reviewAction = input.aiAgreement === 'ACCEPTED' ? 'ACCEPT' : input.aiAgreement === 'REJECTED' ? 'REJECT' : 'MODIFY'
        const review = await executeTransition({
          machine: 'AI_REVIEW', entityId: a.id, action: reviewAction, actor,
          payload: { comment: input.aiComment }, req,
        })
        // PHASE 11 bug fix: a failed review transition is FATAL — the review
        // decision is part of the assessment contract (it was silently
        // no-oped from PHASE 02–10 because of the statusKey mismatch).
        if (!review.ok) {
          throw new AppError(
            (review.code === 'INVALID_TRANSITION' ? 'CONFLICT' : review.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'BUSINESS_RULE') as ErrorCode,
            review.error || 'ثبت بازبینی تحلیل AI ناموفق بود | AI review transition failed',
            review.httpStatus || 409,
          )
        }
        // PHASE 11 — feedback loop: every human decision becomes a dataset
        // label via Events.AiReviewDecided (bootstrap subscriber → datasets)
        await publish(Events.AiReviewDecided, {
          analysisId: a.id, decision: input.aiAgreement,
          reviewerRole: 'EXPERT_1', reviewerId: auth.user.id,
          comment: input.aiComment || null,
          corrections: input.aiCorrections || [],
        }, ctx.reqId)
      }
      // PHASE 11 — validation gate (ED-125): a diagnosis may be marked
      // AI-ASSISTED only when the expert actively endorsed (ACCEPTED or
      // MODIFIED) the AI output — never on REJECTED or no-review.
      const endorsedAI = analyses.length > 0 && resolveAiAssistedFlag(input.aiAgreement)
      await db.diagnosis.create({
        data: {
          caseId, expertId: auth.user.id,
          title: 'ارزیابی اولیه — ' + (input.diseases.join('، ') || 'بررسی بالینی'),
          notes: input.summary, aiAssisted: endorsedAI && input.basedOnAI !== false,
          aiAgreement: input.aiAgreement, confidence: input.confidence ?? null,
        },
      })
      break
    }

    // ── Expert 1: prescription versioning (supersede preserves history) ────
    case 'SUBMIT_PRESCRIPTION': {
      const input = prescriptionSubmitSchema.parse(rawBody)
      const last = await db.prescription.findFirst({ where: { caseId }, orderBy: { version: 'desc' } })
      const version = (last?.version || 0) + 1
      const p = await db.prescription.create({
        data: {
          caseId, version, status: 'PENDING_EXPERT_2', createdById: auth.user.id,
          expert1Notes: input.notes || null,
          items: { create: input.items.map((it) => ({
            productId: it.productId || null, drugName: it.drugName,
            dosage: it.dosage || null, frequency: it.frequency || null, duration: it.duration || null,
            instructionsFa: it.instructions || null, warnings: it.warnings || null,
            quantity: 1,
          })) },
        },
        include: { items: true },
      })
      rawBody.prescriptionId = p.id
      if (last && last.id !== p.id) {
        await executeTransition({
          machine: 'PRESCRIPTION', entityId: last.id, action: 'SUPERSEDE', actor,
          payload: { reason: `نسخه ${version} جایگزین شد` }, req,
        })
      }
      await writeAudit(ctx, {
        userId: auth.user.id, action: 'CREATE_PRESCRIPTION', entity: 'Prescription', entityId: p.id,
        newValues: { version, items: input.items.length },
      })
      break
    }

    // ── Expert 2: availability & pricing ───────────────────────────────────
    case 'EXPERT2_REVIEW': {
      const input = expert2ReviewSchema.parse(rawBody)
      const p = await db.prescription.findFirst({ where: { caseId }, orderBy: { version: 'desc' } })
      if (!p) throw new BusinessRuleError('نسخه‌ای برای بازبینی وجود ندارد')
      await withTransaction(async (tx) => {
        for (const it of input.items) {
          await tx.prescriptionItem.update({
            where: { id: it.id },
            data: {
              available: it.available !== false, missing: it.missing === true,
              unitPrice: it.unitPrice != null ? it.unitPrice : undefined,
            },
          })
        }
      })
      await engineThrowing({
        machine: 'PRESCRIPTION', entityId: p.id, action: 'EXPERT2_REVIEW', actor,
        payload: { notes: input.notes }, req,
      })
      rawBody.prescriptionId = p.id
      break
    }

    // ── Doctor: final gate ──────────────────────────────────────────────────
    case 'DOCTOR_APPROVE':
    case 'DOCTOR_REJECT':
    case 'DOCTOR_REVISION': {
      const input = doctorDecisionSchema.parse(rawBody)
      const p = await db.prescription.findFirst({ where: { caseId }, orderBy: { version: 'desc' } })
      if (p) {
        await engineThrowing({
          machine: 'PRESCRIPTION', entityId: p.id, action, actor,
          payload: { comment: input.comment }, req,
        })
      }
      // PHASE 11 — feedback loop closure: the doctor's decision is the FINAL
      // business validation → lands as the dataset's finalLabel (ground truth)
      if (action === 'DOCTOR_APPROVE' || action === 'DOCTOR_REJECT') {
        const latest = await db.aIAnalysis.findFirst({
          where: { caseId }, orderBy: { createdAt: 'desc' },
        })
        if (latest) {
          await finalizeFinalLabel(
            latest.id,
            action === 'DOCTOR_APPROVE' ? 'DOCTOR_APPROVED' : 'DOCTOR_REJECTED',
          ).catch((e) => logger.warn('dataset final-label failed', {
            analysisId: latest.id, error: e instanceof Error ? e.message : String(e),
          }))
        }
      }
      if (action === 'DOCTOR_REJECT') rawBody.closingNote = input.comment || 'رد توسط پزشک'
      if (input.followUpDays) {
        await db.medicalCase.update({ where: { id: caseId }, data: { followUpDays: input.followUpDays } })
      }
      if (action !== 'DOCTOR_APPROVE') {
        // reject/revision notify the patient with the doctor's comment (machine covers APPROVE)
        await publish(Events.CaseTransitioned, { action, caseId, patientId: c.patientId, code: c.code }, ctx.reqId)
      }
      break
    }

    // ── Operator: proforma (atomic order+invoice, guard-first) ─────────────
    case 'CREATE_PROFORMA': {
      const input = proformaSchema.parse(rawBody)
      // guard-first: refuse invalid transitions BEFORE creating entities
      try {
        assertGuards(getMachine('CASE'), c as unknown as { id: string; status: string }, action, actor)
      } catch (e) {
        const we = e as { code?: string; message?: string; httpStatus?: number; details?: Record<string, unknown> }
        throw new AppError(mapEngineCode(we.code), we.message || 'گذار نامعتبر است', we.httpStatus || 409, we.details)
      }
      const p = await db.prescription.findFirst({
        where: { caseId, status: 'APPROVED' }, orderBy: { version: 'desc' }, include: { items: true },
      })
      if (!p) throw new BusinessRuleError('نسخه تأییدشده‌ای برای صدور پیش‌فاکتور وجود ندارد')
      const existingOrder = await db.order.findFirst({ where: { prescriptionId: p.id, type: 'PRESCRIPTION' } })
      if (existingOrder) throw new AppError('CONFLICT', 'برای این نسخه قبلاً سفارش/پیش‌فاکتور صادر شده است', 409)

      const itemsData = p.items.map((it) => ({
        productId: it.productId || null, nameFa: it.drugName, nameEn: it.drugName,
        unitPrice: it.unitPrice ?? 0, quantity: it.quantity, total: (it.unitPrice ?? 0) * it.quantity,
        available: it.available,
      }))
      const subtotal = itemsData.reduce((s, i) => s + i.total, 0)
      const shippingCost = input.shippingCost ?? SHOP_SHIPPING_COST

      const created = await withTransaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            code: genCode('ORD'), userId: c.patientId, type: 'PRESCRIPTION', status: 'PENDING_CONFIRMATION',
            prescriptionId: p.id, subtotal, shippingCost, total: subtotal + shippingCost,
            note: input.note || null, items: { create: itemsData },
          },
        })
        const invoice = await tx.invoice.create({
          data: {
            code: genCode('INV'), orderId: order.id, caseId, status: 'SENT',
            items: JSON.stringify(itemsData), subtotal, shippingCost, total: subtotal + shippingCost,
            note: 'پیش‌فاکتور نسخه — ' + c.code,
          },
        })
        return { order, invoice }
      })

      // transition after commit; on (rare) failure compensate to stay consistent
      const res = await executeTransition({
        machine: 'CASE', entityId: caseId, action: 'CREATE_PROFORMA', actor,
        payload: { comment: `پیش‌فاکتور ${created.invoice.code} صادر شد` }, req,
      })
      if (!res.ok) {
        await withTransaction(async (tx) => {
          await tx.invoice.delete({ where: { id: created.invoice.id } }).catch(() => {})
          await tx.order.delete({ where: { id: created.order.id } }).catch(() => {})
        })
        throw new AppError(mapEngineCode(res.code), res.error, res.httpStatus, res.details)
      }
      await writeAudit(ctx, {
        userId: auth.user.id, action: 'CREATE_INVOICE', entity: 'Invoice', entityId: created.invoice.id,
        newValues: { total: created.invoice.total },
      })
      return {
        ok: true,
        case: { id: caseId, status: res.entity.status },
        extra: { order: { id: created.order.id, code: created.order.code }, invoice: { id: created.invoice.id, code: created.invoice.code } },
      }
    }

    case 'MARK_PAID': {
      const inv = await db.invoice.findFirst({ where: { caseId }, orderBy: { createdAt: 'desc' } })
      const order = inv ? await db.order.findUnique({ where: { id: inv.orderId } }) : null
      if (order) {
        await engineThrowing({
          machine: 'ORDER', entityId: order.id, action: 'MARK_PAID', actor,
          payload: {
            paymentCode: inv?.code || order.code, paymentAmount: order.total,
            paymentActorId: auth.user.id, paymentSource: 'تأیید دستی پرداخت',
          }, req,
        })
      }
      break
    }

    case 'START_SHIPPING': {
      const input = shippingSchema.parse({ ...rawBody, shipmentId: rawBody.shipmentId || 'n/a' })
      const inv = await db.invoice.findFirst({ where: { caseId }, orderBy: { createdAt: 'desc' } })
      const order = inv ? await db.order.findUnique({ where: { id: inv.orderId }, include: { shipment: true } }) : null
      if (!order) throw new BusinessRuleError('سفارشی برای ارسال وجود ندارد')
      if (!order.shipment) {
        await db.shipment.create({
          data: {
            orderId: order.id, method: input.method || 'MOTORCYCLE', status: 'PREPARING',
            driverName: input.driverName || null, driverPhone: input.driverPhone || null,
            receiverPhone: input.receiverPhone || null, trackingCode: input.trackingCode || null,
            cost: input.cost ?? 0,
          },
        })
      }
      const ship = await db.shipment.findUnique({ where: { orderId: order.id } })
      if (ship) {
        await engineThrowing({ machine: 'SHIPMENT', entityId: ship.id, action: 'SHIP', actor, payload: rawBody, req })
      }
      break
    }

    case 'MARK_DELIVERED': {
      const inv = await db.invoice.findFirst({ where: { caseId }, orderBy: { createdAt: 'desc' } })
      const order = inv ? await db.order.findUnique({ where: { id: inv.orderId }, include: { shipment: true } }) : null
      if (order?.shipment) {
        await engineThrowing({ machine: 'SHIPMENT', entityId: order.shipment.id, action: 'DELIVER', actor, payload: {}, req })
      } else if (order) {
        await engineThrowing({ machine: 'ORDER', entityId: order.id, action: 'DELIVER', actor, payload: {}, req })
      }
      break
    }

    case 'SCHEDULE_FOLLOWUP': {
      const days = Number(rawBody.days || c.followUpDays || 40)
      const due = new Date(Date.now() + days * 864e5)
      await db.followUp.create({ data: { caseId, patientId: c.patientId, dueDate: due, note: String(rawBody.note || '') || null } })
      await db.medicalCase.update({ where: { id: caseId }, data: { followUpAt: due } })
      break
    }

    case 'COMPLETE_FOLLOWUP':
    case 'REFER_AGAIN': {
      const open = await db.followUp.findMany({ where: { caseId, status: { in: ['PENDING', 'DUE', 'OVERDUE'] } } })
      for (const f of open) {
        await executeTransition({
          machine: 'FOLLOWUP', entityId: f.id, action: 'COMPLETE', actor,
          payload: { note: String(rawBody.note || '') }, req,
        })
      }
      break
    }
  }

  // ── final CASE transition through the machine (guards + audit + notify) ──
  const result = await executeTransition({
    machine: 'CASE', entityId: caseId, action, actor, payload: rawBody, req,
  })
  if (!result.ok) {
    throw new AppError(mapEngineCode(result.code), result.error, result.httpStatus, result.details)
  }
  logger.debug('case action applied', { reqId: ctx.reqId, caseId, action })
  return { ok: true, case: { id: caseId, status: result.entity.status }, extra }
}

/** Map workflow-engine error codes onto the public error taxonomy (ED-94). */
function mapEngineCode(code?: string): ErrorCode {
  switch (code) {
    case 'NOT_FOUND': return 'NOT_FOUND'
    case 'FORBIDDEN_ROLE': case 'FORBIDDEN_PERMISSION': case 'NOT_OWNER': return 'FORBIDDEN'
    case 'INVALID_TRANSITION': case 'ALREADY_OWNED': case 'PRECONDITION': return 'CONFLICT'
    case 'VALIDATION': return 'BUSINESS_RULE'
    default: return 'INTERNAL'
  }
}

/** executeTransition wrapper that throws typed AppErrors instead of returning codes. */
async function engineThrowing(input: Parameters<typeof executeTransition>[0]): Promise<Awaited<ReturnType<typeof executeTransition>>> {
  const res = await executeTransition(input)
  if (!res.ok) {
    throw new AppError(mapEngineCode(res.code), res.error, res.httpStatus, res.details)
  }
  return res
}
