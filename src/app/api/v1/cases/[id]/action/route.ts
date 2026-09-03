import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, genCode } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { applyTransition } from '@/lib/caseService'
import { executeTransition } from '@/lib/workflow'
import { notify } from '@/lib/notify'
import { WorkflowAction } from '@/lib/constants'

// POST /api/v1/cases/[id]/action — unified workflow endpoint (engine-guarded).
// Actions: CLAIM | SUBMIT_ASSESSMENT | USER_APPROVE | USER_DECLINE | SUBMIT_PRESCRIPTION |
// EXPERT2_REVIEW | DOCTOR_APPROVE | DOCTOR_REJECT | DOCTOR_REVISION | CREATE_PROFORMA |
// CONFIRM_PROFORMA | REJECT_PROFORMA | MARK_PAID | START_SHIPPING | MARK_DELIVERED |
// SCHEDULE_FOLLOWUP | COMPLETE_FOLLOWUP | REFER_AGAIN
//
// Phase 02: every status write below goes through the Workflow Engine
// (declarative machines + guards + CaseEvent + AuditLog + notifications).
// Entity preparation (diagnosis, prescription rows, order/invoice creation)
// stays in the route and runs BEFORE the machine transition.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const action = body.action as WorkflowAction
  if (!action) return fail('نوع اقدام مشخص نشده است')

  const c = await db.medicalCase.findUnique({ where: { id } })
  if (!c || c.deletedAt) return fail('پرونده یافت نشد', 404)
  if (auth.user.role === 'PATIENT' && c.patientId !== auth.user.id) return fail('دسترسی غیرمجاز', 403)

  const actor = { id: auth.user.id, role: auth.user.role as never }

  // ── Per-action entity preparation (status writes via machines) ───────
  switch (action) {
    case 'SUBMIT_ASSESSMENT': {
      const summary = String(body.summary || '').trim()
      const diseases: string[] = body.diseases || []
      if (!summary) return fail('متن ارزیابی اولیه الزامی است')
      // AI review machine: mark the case's pending AI analyses as human-reviewed (dataset loop)
      const analyses = await db.aIAnalysis.findMany({
        where: { caseId: id, reviewStatus: 'PENDING_REVIEW' },
        orderBy: { createdAt: 'desc' }, take: 1,
      })
      for (const a of analyses) {
        const reviewAction = body.aiAgreement === 'ACCEPTED' ? 'ACCEPT' : body.aiAgreement === 'REJECTED' ? 'REJECT' : 'MODIFY'
        await executeTransition({
          machine: 'AI_REVIEW', entityId: a.id, action: reviewAction, actor,
          payload: { comment: String(body.aiComment || '') }, req,
        })
      }
      await db.diagnosis.create({
        data: {
          caseId: id, expertId: auth.user.id, title: 'ارزیابی اولیه — ' + (diseases.join('، ') || 'بررسی بالینی'),
          notes: summary, aiAssisted: Boolean(body.basedOnAI !== false),
          aiAgreement: body.aiAgreement || 'MODIFIED', confidence: body.confidence ? Number(body.confidence) : null,
        },
      })
      break
    }

    case 'SUBMIT_PRESCRIPTION': {
      const items = body.items as { productId?: string; drugName: string; dosage?: string; frequency?: string; duration?: string; instructions?: string; warnings?: string }[]
      if (!Array.isArray(items) || items.length === 0) return fail('نسخه باید حداقل یک قلم داشته باشد')
      const last = await db.prescription.findFirst({ where: { caseId: id }, orderBy: { version: 'desc' } })
      const version = (last?.version || 0) + 1
      const p = await db.prescription.create({
        data: {
          caseId: id, version, status: 'PENDING_EXPERT_2', createdById: auth.user.id,
          expert1Notes: String(body.notes || '') || null,
          items: { create: items.map((it) => ({
            productId: it.productId || null, drugName: it.drugName,
            dosage: it.dosage || null, frequency: it.frequency || null, duration: it.duration || null,
            instructionsFa: it.instructions || null, warnings: it.warnings || null,
            quantity: 1,
          })) },
        },
        include: { items: true },
      })
      body.prescriptionId = p.id
      // supersede the previous version (BR-MED-06 / ED-24 — history preserved)
      if (last && last.id !== p.id) {
        await executeTransition({
          machine: 'PRESCRIPTION', entityId: last.id, action: 'SUPERSEDE', actor,
          payload: { reason: `نسخه ${version} جایگزین شد` }, req,
        })
      }
      await audit(req, auth.user.id, 'CREATE_PRESCRIPTION', 'Prescription', p.id, null, { version, items: items.length })
      break
    }

    case 'EXPERT2_REVIEW': {
      const p = await db.prescription.findFirst({ where: { caseId: id }, orderBy: { version: 'desc' } })
      if (!p) return fail('نسخه‌ای برای بازبینی وجود ندارد')
      const items = (body.items as { id: string; available: boolean; missing: boolean; unitPrice: number }[] | undefined) || []
      for (const it of items) {
        await db.prescriptionItem.update({
          where: { id: it.id },
          data: { available: it.available !== false, missing: it.missing === true, unitPrice: it.unitPrice != null ? Number(it.unitPrice) : undefined },
        })
      }
      // prescription machine: PENDING_EXPERT_2 → PENDING_DOCTOR (guarded + audited)
      const res = await executeTransition({
        machine: 'PRESCRIPTION', entityId: p.id, action: 'EXPERT2_REVIEW', actor,
        payload: { notes: String(body.notes || '') }, req,
      })
      if (!res.ok) return fail(res.error, res.httpStatus, res.details)
      body.prescriptionId = p.id
      break
    }

    case 'DOCTOR_APPROVE':
    case 'DOCTOR_REJECT':
    case 'DOCTOR_REVISION': {
      const p = await db.prescription.findFirst({ where: { caseId: id }, orderBy: { version: 'desc' } })
      if (p) {
        // prescription machine: guarded doctor decision (comment mandatory on reject/revision)
        const res = await executeTransition({
          machine: 'PRESCRIPTION', entityId: p.id, action, actor,
          payload: { comment: String(body.comment || '') }, req,
        })
        if (!res.ok) return fail(res.error, res.httpStatus, res.details)
      }
      if (action === 'DOCTOR_REJECT') body.closingNote = String(body.comment || 'رد توسط پزشک')
      if (body.followUpDays) {
        await db.medicalCase.update({ where: { id }, data: { followUpDays: Number(body.followUpDays) } })
      }
      if (action !== 'DOCTOR_APPROVE') {
        // case machine postCommit covers APPROVED (DOCTOR_APPROVED + sms);
        // reject/revision still notify the patient with the doctor's comment
        await notify(c.patientId, 'DOCTOR_COMMENTED', { link: `/cases/${id}`, sms: true })
      }
      break
    }

    case 'CREATE_PROFORMA': {
      const p = await db.prescription.findFirst({ where: { caseId: id, status: 'APPROVED' }, orderBy: { version: 'desc' }, include: { items: true } })
      if (!p) return fail('نسخه تأییدشده‌ای برای صدور پیش‌فاکتور وجود ندارد')
      const existingOrder = await db.order.findFirst({ where: { prescriptionId: p.id, type: 'PRESCRIPTION' } })
      if (existingOrder) return fail('برای این نسخه قبلاً سفارش/پیش‌فاکتور صادر شده است', 409)

      const itemsData = p.items.map((it) => ({
        productId: it.productId || null, nameFa: it.drugName, nameEn: it.drugName,
        unitPrice: it.unitPrice ?? 0, quantity: it.quantity, total: (it.unitPrice ?? 0) * it.quantity,
        available: it.available,
      }))
      const subtotal = itemsData.reduce((s, i) => s + i.total, 0)
      const shippingCost = Number(body.shippingCost || 50000)
      const order = await db.order.create({
        data: {
          code: genCode('ORD'), userId: c.patientId, type: 'PRESCRIPTION', status: 'PENDING_CONFIRMATION',
          prescriptionId: p.id, subtotal, shippingCost, total: subtotal + shippingCost, note: String(body.note || '') || null,
          items: { create: itemsData },
        },
      })
      const invoice = await db.invoice.create({
        data: {
          code: genCode('INV'), orderId: order.id, caseId: id, status: 'SENT',
          items: JSON.stringify(itemsData), subtotal, shippingCost, total: subtotal + shippingCost,
          note: 'پیش‌فاکتور نسخه — ' + c.code,
        },
      })
      // case machine: PRESCRIPTION_APPROVED → PROFORMA_CREATED (event + audit + notify)
      const res = await executeTransition({
        machine: 'CASE', entityId: id, action: 'CREATE_PROFORMA', actor,
        payload: { comment: `پیش‌فاکتور ${invoice.code} صادر شد` }, req,
      })
      if (!res.ok) return fail(res.error, res.httpStatus, res.details)
      await audit(req, auth.user.id, 'CREATE_INVOICE', 'Invoice', invoice.id, null, { total: invoice.total })
      return ok({ ok: true, order: { id: order.id, code: order.code }, invoice: { id: invoice.id, code: invoice.code } })
    }

    case 'MARK_PAID': {
      const inv = await db.invoice.findFirst({ where: { caseId: id }, orderBy: { createdAt: 'desc' } })
      const order = inv ? await db.order.findUnique({ where: { id: inv.orderId } }) : null
      if (order) {
        // order machine: → PAID with invoice + financial-transaction cascade (atomic)
        const res = await executeTransition({
          machine: 'ORDER', entityId: order.id, action: 'MARK_PAID', actor,
          payload: {
            paymentCode: inv?.code || order.code,
            paymentAmount: order.total,
            paymentActorId: auth.user.id,
            paymentSource: 'تأیید دستی پرداخت',
          }, req,
        })
        if (!res.ok) return fail(res.error, res.httpStatus, res.details)
      }
      break
    }

    case 'START_SHIPPING': {
      const invS = await db.invoice.findFirst({ where: { caseId: id }, orderBy: { createdAt: 'desc' } })
      const order = invS ? await db.order.findUnique({ where: { id: invS.orderId }, include: { shipment: true } }) : null
      if (!order) return fail('سفارشی برای ارسال وجود ندارد')
      // ensure a shipment row exists, then SHIPMENT machine drives the state
      if (!order.shipment) {
        await db.shipment.create({
          data: {
            orderId: order.id, method: 'MOTORCYCLE', status: 'PREPARING',
            driverName: String(body.driverName || '') || null, driverPhone: String(body.driverPhone || '') || null,
            receiverPhone: String(body.receiverPhone || '') || null, trackingCode: String(body.trackingCode || '') || null,
            cost: body.cost != null ? Number(body.cost) : 0,
          },
        })
      }
      const ship = await db.shipment.findUnique({ where: { orderId: order.id } })
      if (ship) {
        const res = await executeTransition({
          machine: 'SHIPMENT', entityId: ship.id, action: 'SHIP', actor,
          payload: body, req,
        })
        if (!res.ok) return fail(res.error, res.httpStatus, res.details)
      }
      break
    }

    case 'MARK_DELIVERED': {
      const invD = await db.invoice.findFirst({ where: { caseId: id }, orderBy: { createdAt: 'desc' } })
      const order = invD ? await db.order.findUnique({ where: { id: invD.orderId }, include: { shipment: true } }) : null
      if (order?.shipment) {
        // shipment machine: DELIVER cascades ORDER + CASE (event + audit + notify)
        const res = await executeTransition({
          machine: 'SHIPMENT', entityId: order.shipment.id, action: 'DELIVER', actor,
          payload: {}, req,
        })
        if (!res.ok) return fail(res.error, res.httpStatus, res.details)
      } else if (order) {
        const res = await executeTransition({
          machine: 'ORDER', entityId: order.id, action: 'DELIVER', actor, payload: {}, req,
        })
        if (!res.ok) return fail(res.error, res.httpStatus, res.details)
      }
      break
    }

    case 'SCHEDULE_FOLLOWUP': {
      const days = Number(body.days || c.followUpDays || 40)
      const due = new Date(Date.now() + days * 864e5)
      await db.followUp.create({ data: { caseId: id, patientId: c.patientId, dueDate: due, note: String(body.note || '') || null } })
      await db.medicalCase.update({ where: { id }, data: { followUpAt: due } })
      break
    }

    case 'COMPLETE_FOLLOWUP':
    case 'REFER_AGAIN': {
      // follow-up machine: complete every open follow-up (audited per row)
      const open = await db.followUp.findMany({ where: { caseId: id, status: { in: ['PENDING', 'DUE', 'OVERDUE'] } } })
      for (const f of open) {
        await executeTransition({
          machine: 'FOLLOWUP', entityId: f.id, action: 'COMPLETE', actor,
          payload: { note: String(body.note || '') }, req,
        })
      }
      break
    }
  }

  // ── Case state transition (engine: guards + event + audit + notify) ──
  const result = await applyTransition(req, id, action, auth.user.id, auth.user.role, body)
  if (result.status !== 200) return result
  return result
}
