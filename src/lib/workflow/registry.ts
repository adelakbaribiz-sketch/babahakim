// Machine registry — the ONLY place machines are wired into the engine.
// Extensibility contract (PHASE 02): to add a new workflow entity,
// create machines/<entity>.ts exporting a MachineDef and register it
// here. No engine change is ever required.
import { MachineDef, EntityType, WorkflowError } from './types'
import { CASE_MACHINE } from './machines/case'
import { PRESCRIPTION_MACHINE } from './machines/prescription'
import { ORDER_MACHINE } from './machines/order'
import { PAYMENT_MACHINE } from './machines/payment'
import { SHIPMENT_MACHINE } from './machines/shipment'
import { TICKET_MACHINE } from './machines/ticket'
import { FOLLOWUP_MACHINE } from './machines/followup'
import { AI_REVIEW_MACHINE } from './machines/aiReview'

const REGISTRY: Record<EntityType, MachineDef> = {
  CASE: CASE_MACHINE,
  PRESCRIPTION: PRESCRIPTION_MACHINE,
  ORDER: ORDER_MACHINE,
  PAYMENT: PAYMENT_MACHINE,
  SHIPMENT: SHIPMENT_MACHINE,
  TICKET: TICKET_MACHINE,
  FOLLOWUP: FOLLOWUP_MACHINE,
  AI_REVIEW: AI_REVIEW_MACHINE,
}

/** Fetch a machine definition by entity type. */
export function getMachine(entity: string): MachineDef {
  const m = REGISTRY[entity as EntityType]
  if (!m) {
    throw new WorkflowError('NOT_FOUND', `ماشین وضعیت «${entity}» ثبت نشده است | Unknown machine`, 500)
  }
  return m
}

/** All registered machines (docs, tests, admin introspection). */
export function allMachines(): MachineDef[] {
  return Object.values(REGISTRY)
}

/** Optional runtime registration (future admin-managed workflows). */
export function registerMachine(def: MachineDef) {
  REGISTRY[def.entity] = def
}
