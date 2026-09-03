import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, parseJSON, genCode } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { applyTransition } from '@/lib/caseService'
import { notify } from '@/lib/notify'
import { WorkflowAction } from '@/lib/constants'

// POST /api/v1/cases/[id]/action — unified workflow endpoint (state-machine guarded)
// Actions: CLAIM | SUBMIT_ASSESSMENT | USER_APPROVE | USER_DECLINE | SUBMIT_PRESCRIPTION |
// EXPERT2_REVIEW | DOCTOR_APPROVE | DOCTOR_REJECT | DOCTOR_REVISION | CREATE_PROFORMA |
// CONFIRM_PROFORMA | REJECT_PROFORMA | MARK_PAID | START_SHIPPING | MARK_DELIVERED |
// SCHEDULE_FOLLOWUP | COMPLETE_FOLLOWUP | REFER_AGAIN
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

  // ── Per-action side effects before transition ──────────────────────
  switch (action) {
    case 'SUBMIT_ASSESSMENT': {
      // create diagnosis records + expert summary
      const summary = String(body.summary || '').trim()
      const diseases: string[] = body.diseases || []
      if (!summary) return fail('متن ارزیابی اولیه الزامی است')
      // mark AI analysis as human-reviewed (dataset learning loop)
      await db.aIAnalysis.updateMany({ where: { caseId: id }, data: { humanReviewed: true } })
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
      await db.prescription.update({ where: { id: p.id }, data: { status: 'PENDING_EXPERT_2' } })
      body.prescriptionId = p.id
      await notify(c.patientId, 'PRESCRIPTION_CREATED', { link: `/cases/${id}` })
      await audit(req, auth.user.id, 'CREATE_PRESCRIPTION', 'Prescription', p.id, null, { version, items: items.length })
      break
    }

    case 'EXPERT2_REVIEW': {
      // review + availability + pricing + follow-up days
      const p = await db.prescription.findFirst({ where: { caseId: id }, orderBy: { version: 'desc' } })
      if (!p) return fail('نسخه‌ای برای بازبینی وجود ندارد')
      const items = (body.items as { id: string; available: boolean; missing: boolean; unitPrice: number }[] | undefined) || []
      for (const it of items) {
        await db.prescriptionItem.update({
          where: { id: it.id },
          data: { available: it.available !== false, missing: it.missing === true, unitPrice: it.unitPrice != null ? Number(it.unitPrice) : undefined },
        })
      }
      await db.prescription.update({
        where: { id: p.id },
        data: { status: 'PENDING_DOCTOR', expert2Notes: String(body.notes || '') || null },
      })
      body.prescriptionId = p.id
      break
    }

    case 'DOCTOR_APPROVE':
    case 'DOCTOR_REJECT':
    case 'DOCTOR_REVISION': {
      const p = await db.prescription.findFirst({ where: { caseId: id }, orderBy: { version: 'desc' } })
      if (p) {
        const status = action === 'DOCTOR_APPROVE' ? 'APPROVED' : action === 'DOCTOR_REJECT' ? 'REJECTED' : 'REVISION_REQUESTED'
        await db.prescription.update({
          where: { id: p.id },
          data: { status, doctorComment: String(body.comment || '') || null, approvedById: action === 'DOCTOR_APPROVE' ? auth.user.id : null, approvedAt: action === 'DOCTOR_APPROVE' ? new Date() : null },
        })
      }
      if (action === 'DOCTOR_REJECT') body.closingNote = String(body.comment || 'رد توسط پزشک')
      if (body.followUpDays) {
        await db.medicalCase.update({ where: { id }, data: { followUpDays: Number(body.followUpDays) } })
      }
      await notify(c.patientId, action === 'DOCTOR_APPROVE' ? 'DOCTOR_APPROVED' : 'DOCTOR_COMMENTED', { link: `/cases/${id}`, sms: true })
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
      await db.medicalCase.update({ where: { id }, data: { status: 'PROFORMA_CREATED' } })
      await db.caseEvent.create({
        data: { caseId: id, actorId: auth.user.id, action: 'STATUS_CHANGE', fromStatus: c.status, toStatus: 'PROFORMA_CREATED', comment: `پیش‌فاکتور ${invoice.code} صادر شد` },
      })
      await notify(c.patientId, 'PROFORMA_CREATED', { link: `/cases/${id}`, sms: true })
      await audit(req, auth.user.id, 'CREATE_INVOICE', 'Invoice', invoice.id, null, { total: invoice.total })
      return ok({ ok: true, order: { id: order.id, code: order.code }, invoice: { id: invoice.id, code: invoice.code } })
    }

    case 'MARK_PAID': {
      const inv = await db.invoice.findFirst({ where: { caseId: id }, orderBy: { createdAt: 'desc' } })
      const order = inv ? await db.order.findUnique({ where: { id: inv.orderId } }) : null
      if (order) {
        await db.order.update({ where: { id: order.id }, data: { status: 'PAID', verifiedById: auth.user.id } })
        await db.invoice.updateMany({ where: { orderId: order.id }, data: { status: 'PAID', paidAt: new Date() } })
      }
      break
    }

    case 'START_SHIPPING': {
      const invS = await db.invoice.findFirst({ where: { caseId: id }, orderBy: { createdAt: 'desc' } })
      const order = invS ? await db.order.findUnique({ where: { id: invS.orderId }, include: { shipment: true } }) : null
      if (!order) return fail('سفارشی برای ارسال وجود ندارد')
      const method = ['MOTORCYCLE', 'CAR', 'POST'].includes(body.method) ? body.method : 'MOTORCYCLE'
      if (order.shipment) {
        await db.shipment.update({
          where: { id: order.shipment.id },
          data: {
            method, driverName: String(body.driverName || '') || order.shipment.driverName,
            driverPhone: String(body.driverPhone || '') || order.shipment.driverPhone,
            trackingCode: String(body.trackingCode || '') || order.shipment.trackingCode,
            cost: body.cost != null ? Number(body.cost) : order.shipment.cost,
            status: 'SHIPPED', shippingDate: new Date(),
          },
        })
      } else {
        await db.shipment.create({
          data: {
            orderId: order.id, method, status: 'SHIPPED', shippingDate: new Date(),
            driverName: String(body.driverName || '') || null, driverPhone: String(body.driverPhone || '') || null,
            receiverPhone: String(body.receiverPhone || '') || null, trackingCode: String(body.trackingCode || '') || null,
            cost: body.cost != null ? Number(body.cost) : 0,
          },
        })
      }
      await db.order.update({ where: { id: order.id }, data: { status: 'SHIPPED' } })
      await notify(c.patientId, 'ORDER_SHIPPED', { link: `/cases/${id}`, sms: true })
      break
    }

    case 'MARK_DELIVERED': {
      const invD = await db.invoice.findFirst({ where: { caseId: id }, orderBy: { createdAt: 'desc' } })
      const order = invD ? await db.order.findUnique({ where: { id: invD.orderId }, include: { shipment: true } }) : null
      if (order?.shipment) {
        await db.shipment.update({ where: { id: order.shipment.id }, data: { status: 'DELIVERED', deliveryDate: new Date() } })
      }
      if (order) await db.order.update({ where: { id: order.id }, data: { status: 'DELIVERED' } })
      await notify(c.patientId, 'ORDER_DELIVERED', { link: `/cases/${id}`, sms: true })
      break
    }

    case 'SCHEDULE_FOLLOWUP': {
      const days = Number(body.days || c.followUpDays || 40)
      const due = new Date(Date.now() + days * 864e5)
      await db.followUp.create({ data: { caseId: id, patientId: c.patientId, dueDate: due, note: String(body.note || '') || null } })
      await db.medicalCase.update({ where: { id }, data: { followUpAt: due } })
      break
    }

    case 'COMPLETE_FOLLOWUP': {
      await db.followUp.updateMany({ where: { caseId: id, status: { in: ['PENDING', 'DUE', 'OVERDUE'] } }, data: { status: 'COMPLETED', completedById: auth.user.id, completedAt: new Date(), resultNote: String(body.note || '') || null } })
      break
    }

    case 'REFER_AGAIN': {
      await db.followUp.updateMany({ where: { caseId: id, status: { in: ['PENDING', 'DUE', 'OVERDUE'] } }, data: { status: 'COMPLETED', completedAt: new Date() } })
      break
    }
  }

  // ── Apply state transition (validates role/status/permission) ──────
  const result = await applyTransition(req, id, action, auth.user.id, auth.user.role, body)
  if (result.status !== 200) return result
  return result
}
