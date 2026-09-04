// BabaHakim Workflow Engine — public API.
// PHASE 02: 8 declarative state machines driven by one engine.
// PHASE 12: +3 machines (DELETION_REQUEST, MEDICAL_IMAGE, INVOICE), the
// policy layer (timeout/retry/failure/recovery) and the governance runtime.
// See docs/WORKFLOW.md for the full specification per state.
export * from './types'
export {
  resolveTransition, assertGuards, hasPermission, ownsEntity,
  reachableFrom, terminalStatuses, executeTransition,
  executeAdminRecovery, recoveryEnabled, ADMIN_RECOVERY_ACTION,
} from './engine'
export type { ExecuteInput, AdminRecoveryInput } from './engine'
export {
  applySubTransition, cascadeSubTransition, syncWorkflowStateTx, SYSTEM_ACTOR,
} from './subtransition'
export { getMachine, allMachines, registerMachine } from './registry'
export {
  TIMEOUT_POLICIES, RETRY_POLICIES, FAILURE_POLICIES, DEFAULT_RETRY_POLICY,
  timeoutPoliciesFor, timeoutPolicyStatuses, allTimeoutPolicies,
  retryPolicyFor, failurePolicyFor, governanceDecision, slaDeadline,
  breachMs, computeBackoffMs, slaLabel,
} from './policies'
export type {
  TimeoutPolicy, RetryPolicy, FailurePolicy, TimeoutLevel,
  GovernanceEntry, GovernanceDecision,
} from './policies'
export { CASE_MACHINE, CASE_STATUSES } from './machines/case'
export { PRESCRIPTION_MACHINE, PRESCRIPTION_STATUSES } from './machines/prescription'
export { ORDER_MACHINE, ORDER_STATUSES, cascadePaid } from './machines/order'
export { PAYMENT_MACHINE, PAYMENT_STATUSES } from './machines/payment'
export { SHIPMENT_MACHINE, SHIPMENT_STATUSES } from './machines/shipment'
export { TICKET_MACHINE, TICKET_STATUSES } from './machines/ticket'
export { FOLLOWUP_MACHINE, FOLLOWUP_STATUSES } from './machines/followup'
export { AI_REVIEW_MACHINE, AI_REVIEW_STATUSES } from './machines/aiReview'
export { DELETION_REQUEST_MACHINE, DELETION_REQUEST_STATUSES } from './machines/deletionRequest'
export { MEDICAL_IMAGE_MACHINE, MEDICAL_IMAGE_STATUSES } from './machines/medicalImage'
export { INVOICE_MACHINE, INVOICE_STATUSES } from './machines/invoice'
