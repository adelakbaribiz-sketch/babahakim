-- PHASE 15: Logging, Monitoring & Observability (ED-171).
-- Three append-only operational tables (hard-purge retention, ED-172):
--   ServiceLog  searchable structured logs, PII redacted before persist
--   MetricPoint periodic metric snapshots (7-day durable window)
--   AlertEvent  alert lifecycle with dedup + cooldown (unique rule key)
-- Additive only: no existing table is touched.

-- CreateTable
CREATE TABLE "ServiceLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "t" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lvl" TEXT NOT NULL,
    "svc" TEXT NOT NULL,
    "msg" TEXT NOT NULL,
    "route" TEXT,
    "method" TEXT,
    "status" INTEGER,
    "reqId" TEXT,
    "corrId" TEXT,
    "traceId" TEXT,
    "actorId" TEXT,
    "actorRole" TEXT,
    "ipHash" TEXT,
    "fields" TEXT
);

-- CreateIndex
CREATE INDEX "ServiceLog_t_idx" ON "ServiceLog"("t");
CREATE INDEX "ServiceLog_lvl_t_idx" ON "ServiceLog"("lvl", "t");
CREATE INDEX "ServiceLog_svc_t_idx" ON "ServiceLog"("svc", "t");
CREATE INDEX "ServiceLog_reqId_idx" ON "ServiceLog"("reqId");
CREATE INDEX "ServiceLog_corrId_t_idx" ON "ServiceLog"("corrId", "t");

-- CreateTable
CREATE TABLE "MetricPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "MetricPoint_at_idx" ON "MetricPoint"("at");

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "msgFa" TEXT NOT NULL,
    "msgEn" TEXT NOT NULL,
    "payload" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "fireCount" INTEGER NOT NULL DEFAULT 1,
    "lastNotifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertEvent_key_key" ON "AlertEvent"("key");
CREATE INDEX "AlertEvent_status_lastSeenAt_idx" ON "AlertEvent"("status", "lastSeenAt");
CREATE INDEX "AlertEvent_severity_status_idx" ON "AlertEvent"("severity", "status");
