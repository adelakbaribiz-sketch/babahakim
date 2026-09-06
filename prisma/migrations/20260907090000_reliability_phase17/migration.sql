-- PHASE 17: Reliability Engineering (ED-190/191).
-- DurableJob: job queue durability — PENDING/RUNNING/DONE/DEAD lifecycle,
-- crash recovery (stale RUNNING claims), owner-pid claim optimization.
-- IdempotencyRecord: duplicate-request protection for mutation-critical
-- routes (checkout/payments/cases) — RUNNING→409, DONE→replay, FAILED→retry.
-- Additive only; both tables are hard-purge operational data (ED-172).
-- Prisma db push is the applier (schema.prisma is single source of truth).

-- Prisma Identifier(ObjectId) for DurableJob: TEXT PRIMARY KEY (assigned in code)
CREATE TABLE "DurableJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "backoffMs" INTEGER NOT NULL DEFAULT 2000,
    "nextRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" DATETIME,
    "ownerPid" INTEGER,
    "lastError" TEXT,
    "corrId" TEXT,
    "traceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
);
CREATE INDEX "DurableJob_status_nextRunAt_idx" ON "DurableJob" ("status", "nextRunAt");
CREATE INDEX "DurableJob_type_status_idx" ON "DurableJob" ("type", "status");
CREATE INDEX "DurableJob_status_updatedAt_idx" ON "DurableJob" ("status", "updatedAt");

CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "errorCode" TEXT,
    "requestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "IdempotencyRecord_userId_route_key_key" ON "IdempotencyRecord" ("userId", "route", "key");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord" ("expiresAt");
