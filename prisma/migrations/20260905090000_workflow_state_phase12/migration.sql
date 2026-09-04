-- PHASE 12: Workflow Governance State table.
-- Tracks when each workflow instance entered its current status so the
-- governance runtime (src/lib/workflow/governance.ts) can evaluate
-- SLA/timeout policies, detect drift and backfill pre-phase rows.
-- Additive only: no existing table is touched.
-- Prisma: `workflowState` delegate, @@unique([entityType, entityId]).

-- CreateTable
CREATE TABLE "WorkflowState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "enteredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRemindedAt" DATETIME,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "escalatedAt" DATETIME,
    "lastDriftSyncAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowState_entityType_entityId_key" ON "WorkflowState"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "WorkflowState_entityType_status_enteredAt_idx" ON "WorkflowState"("entityType", "status", "enteredAt");
