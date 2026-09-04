// BabaHakim Workflow Engine — public API.
// PHASE 02 deliverable: 8 declarative state machines driven by one engine.
// See docs/WORKFLOW.md for the full specification per state.
export * from './types'
export {
  resolveTransition, assertGuards, hasPermission, ownsEntity,
  reachableFrom, terminalStatuses, executeTransition,
} from './engine'
export type { ExecuteInput } from './engine'
export { getMachine, allMachines, registerMachine } from './registry'
export { CASE_MACHINE, CASE_STATUSES } from './machines/case'
export { PRESCRIPTION_MACHINE, PRESCRIPTION_STATUSES } from './machines/prescription'
export { ORDER_MACHINE, ORDER_STATUSES, cascadePaid } from './machines/order'
export { PAYMENT_MACHINE, PAYMENT_STATUSES } from './machines/payment'
export { SHIPMENT_MACHINE, SHIPMENT_STATUSES } from './machines/shipment'
export { TICKET_MACHINE, TICKET_STATUSES } from './machines/ticket'
export { FOLLOWUP_MACHINE, FOLLOWUP_STATUSES } from './machines/followup'
export { AI_REVIEW_MACHINE, AI_REVIEW_STATUSES } from './machines/aiReview'
