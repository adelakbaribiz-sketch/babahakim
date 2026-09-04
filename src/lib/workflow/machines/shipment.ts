// SHIPMENT state machine — delivery lifecycle with ORDER + CASE cascades.
import { TransitionDef, MachineDef, WorkflowError } from '../types'

export const SHIPMENT_STATUSES = [
  'PREPARING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'FAILED',
] as const

const t = (def: TransitionDef): TransitionDef => def

export const SHIPMENT_MACHINE: MachineDef = {
  entity: 'SHIPMENT',
  prismaKey: 'shipment',
  statuses: SHIPMENT_STATUSES,
  initial: 'PREPARING',
  transitions: [
    t({
      action: 'SHIP', from: ['PREPARING', 'SHIPPED'], to: 'SHIPPED',
      roles: ['OPERATOR', 'EXPERT_2'], permission: 'manage_shipments', descFa: 'مرسوله ارسال شد',
      dataEffects: (c) => ({
        method: ['MOTORCYCLE', 'CAR', 'POST'].includes(String(c.payload.method)) ? c.payload.method : (c.entity as { method?: string }).method ?? 'MOTORCYCLE',
        driverName: String(c.payload.driverName || '') || ((c.entity as { driverName?: string }).driverName ?? null),
        driverPhone: String(c.payload.driverPhone || '') || ((c.entity as { driverPhone?: string }).driverPhone ?? null),
        receiverPhone: String(c.payload.receiverPhone || '') || ((c.entity as { receiverPhone?: string }).receiverPhone ?? null),
        trackingCode: String(c.payload.trackingCode || '') || ((c.entity as { trackingCode?: string }).trackingCode ?? null),
        cost: c.payload.cost != null ? Number(c.payload.cost) : (c.entity as { cost?: number }).cost ?? 0,
        shippingDate: (c.entity as { shippingDate?: Date }).shippingDate ?? c.now,
      }),
      txEffects: async (c) => {
        // cascade: ORDER → SHIPPED
        const tx = (c as { tx: unknown }).tx as {
          order: { update: (a: { where: { id: string }; data: unknown }) => Promise<unknown> }
        }
        const orderId = String((c.entity as { orderId?: string }).orderId || '')
        if (orderId) await tx.order.update({ where: { id: orderId }, data: { status: 'SHIPPED' } })
      },
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        const db = (c as unknown as { db: { order: { findUnique: (a: unknown) => Promise<{ userId: string } | null> } } }).db
        const orderId = String((c.entity as { orderId?: string }).orderId || '')
        const order = orderId ? await db.order.findUnique({ where: { id: orderId } }) : null
        if (order) await notify(order.userId, 'ORDER_SHIPPED', { link: '/orders', sms: true })
      },
    }),
    t({
      action: 'IN_TRANSIT', from: ['SHIPPED'], to: 'IN_TRANSIT',
      roles: ['OPERATOR'], permission: 'manage_shipments', descFa: 'مرسوله در مسیر است',
    }),
    t({
      action: 'DELIVER', from: ['SHIPPED', 'IN_TRANSIT'], to: 'DELIVERED',
      roles: ['OPERATOR', 'EXPERT_2'], permission: 'manage_shipments', descFa: 'تحویل ثبت شد',
      dataEffects: (c) => ({ deliveryDate: c.now }),
      txEffects: async (c) => {
        // cascade ORDER → DELIVERED only. The CASE progression is always driven
        // by the CASE machine (single writer per entity — no double transitions).
        const tx = (c as { tx: unknown }).tx as {
          order: { update: (a: { where: { id: string }; data: unknown }) => Promise<unknown> }
        }
        const orderId = String((c.entity as { orderId?: string }).orderId || '')
        if (orderId) await tx.order.update({ where: { id: orderId }, data: { status: 'DELIVERED' } })
      },
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        const db = (c as unknown as { db: { order: { findUnique: (a: unknown) => Promise<{ userId: string } | null> } } }).db
        const orderId = String((c.entity as { orderId?: string }).orderId || '')
        const order = orderId ? await db.order.findUnique({ where: { id: orderId } }) : null
        if (order) await notify(order.userId, 'ORDER_DELIVERED', { link: '/orders', sms: true })
      },
    }),
    t({
      action: 'FAIL', from: ['PREPARING', 'SHIPPED', 'IN_TRANSIT'], to: 'FAILED',
      roles: ['OPERATOR', 'ADMIN'], permission: 'manage_shipments', descFa: 'ارسال ناموفق بود',
      validate: (c) => {
        if (!String(c.payload.reason || '').trim()) {
          throw new WorkflowError('VALIDATION', 'علت شکست ارسال الزامی است | Reason required', 422)
        }
      },
      dataEffects: (c) => ({ note: String(c.payload.reason || '') }),
    }),
  ],
}
