-- PHASE 16: Performance Engineering (ED-181).
-- Indexes for MEASURED hot paths (perf-db-baseline.json: 24/27 full-scan).
-- Compound column order mirrors the service-layer WHERE + ORDER BY shapes:
--   patient dashboards (patientId/userId + createdAt desc), staff queues
--   (status + createdAt), timelines (caseId + createdAt), audit trail
--   (createdAt / userId+createdAt / action+createdAt), financial windows
--   (status + createdAt). Additive only — no table data is touched.
-- Prisma db push is the applier (schema.prisma is single source of truth).

CREATE INDEX "MedicalCase_patientId_createdAt_idx" ON MedicalCase ("patientId", "createdAt");
CREATE INDEX "MedicalCase_status_createdAt_idx" ON MedicalCase ("status", "createdAt");
CREATE INDEX "Order_userId_createdAt_idx" ON "Order" ("userId", "createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order" ("status", "createdAt");
CREATE INDEX "Payment_status_createdAt_idx" ON Payment ("status", "createdAt");
CREATE INDEX "Payment_orderId_idx" ON Payment ("orderId");
CREATE INDEX "Ticket_userId_updatedAt_idx" ON Ticket ("userId", "updatedAt");
CREATE INDEX "Ticket_status_updatedAt_idx" ON Ticket ("status", "updatedAt");
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON TicketMessage ("ticketId", "createdAt");
CREATE INDEX "CaseEvent_caseId_createdAt_idx" ON CaseEvent ("caseId", "createdAt");
CREATE INDEX "CaseEvent_createdAt_idx" ON CaseEvent ("createdAt");
CREATE INDEX "AIAnalysis_caseId_idx" ON AIAnalysis ("caseId");
CREATE INDEX "MedicalImage_caseId_createdAt_idx" ON MedicalImage ("caseId", "createdAt");
CREATE INDEX "Invoice_orderId_idx" ON Invoice ("orderId");
CREATE INDEX "OrderItem_orderId_idx" ON OrderItem ("orderId");
CREATE INDEX "Notification_userId_read_createdAt_idx" ON Notification ("userId", "read", "createdAt");
CREATE INDEX "FollowUp_status_idx" ON FollowUp ("status");
CREATE INDEX "FollowUp_patientId_dueDate_idx" ON FollowUp ("patientId", "dueDate");
CREATE INDEX "AuditLog_createdAt_idx" ON AuditLog ("createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON AuditLog ("userId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON AuditLog ("action", "createdAt");
CREATE INDEX "SMSLog_sentAt_idx" ON SMSLog ("sentAt");
CREATE INDEX "QuestionnaireResponse_userId_createdAt_idx" ON QuestionnaireResponse ("userId", "createdAt");
CREATE INDEX "Diagnosis_caseId_idx" ON Diagnosis ("caseId");
CREATE INDEX "Prescription_caseId_createdAt_idx" ON Prescription ("caseId", "createdAt");
CREATE INDEX "FinancialTransaction_type_createdAt_idx" ON FinancialTransaction ("type", "createdAt");
CREATE INDEX "MedicalCase_createdAt_idx" ON MedicalCase ("createdAt");
CREATE INDEX "Order_createdAt_idx" ON "Order" ("createdAt");
