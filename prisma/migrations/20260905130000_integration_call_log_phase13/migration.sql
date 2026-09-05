-- PHASE 13: External Integration call log / idempotency store.
-- One row per external call through the integration core (attempt detail on
-- the final attempt, retries counted). Requests/responses are stored
-- REDACTED (secrets masked before persistence — ED-137).
-- Idempotency: unique(provider, operation, idempotencyKey) enables cached
-- SUCCESS replay instead of double-charging / double-sending (BR-INT-03).
-- Additive only: no existing table is touched.
-- Prisma: `integrationCallLog` delegate.

-- CreateTable
CREATE TABLE "IntegrationCallLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "latencyMs" INTEGER,
    "httpStatus" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestRedacted" TEXT,
    "responseRedacted" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCallLog_provider_operation_idempotencyKey_key" ON "IntegrationCallLog"("provider", "operation", "idempotencyKey");

-- CreateIndex
CREATE INDEX "IntegrationCallLog_kind_createdAt_idx" ON "IntegrationCallLog"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationCallLog_kind_provider_status_idx" ON "IntegrationCallLog"("kind", "provider", "status");

-- CreateIndex
CREATE INDEX "IntegrationCallLog_createdAt_idx" ON "IntegrationCallLog"("createdAt");
