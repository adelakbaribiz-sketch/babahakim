// ── BabaHakim Application Service · Jobs/DLQ Ops (PHASE 17, ED-190) ────────
// Admin operations over the durable job queue: live listing (any status),
// queue stats, and DEAD-letter replay. All state writes are audited.
import { db } from '@/lib/db'
import { AppError, NotFoundError, ConflictError, ErrorCode } from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import { queueHealth, refreshMirrorFromDb, ensureWorker } from '@/server/infrastructure/jobs'
import type { RequestContext } from '@/server/core/context'

const MAX_LIMIT = 100

export interface JobsListResult {
  jobs: Array<{
    id: string; type: string; status: string; attempts: number; maxAttempts: number
    nextRunAt: string | null; claimedAt: string | null; lastError: string | null
    createdAt: string; finishedAt: string | null
  }>
  meta: { page: number; limit: number; total: number; pages: number }
  stats: Record<string, number>
  queue: ReturnType<typeof queueHealth>
}

/** GET /api/v1/admin/jobs — live queue + DLQ listing (paginated, bounded). */
export async function listJobs(input: { status?: string; type?: string; page?: number; limit?: number }): Promise<JobsListResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1))
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? 20)))
  const where: Record<string, unknown> = {}
  if (input.status && ['PENDING', 'RUNNING', 'DONE', 'DEAD'].includes(input.status)) where.status = input.status
  if (input.type) where.type = input.type

  const [rows, total, groups] = await Promise.all([
    db.durableJob.findMany({
      where, orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit, take: limit,
    }),
    db.durableJob.count({ where }),
    db.durableJob.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const stats: Record<string, number> = { PENDING: 0, RUNNING: 0, DONE: 0, DEAD: 0 }
  for (const grp of groups) stats[grp.status] = grp._count._all

  return {
    jobs: rows.map((r) => ({
      id: r.id, type: r.type, status: r.status,
      attempts: r.attempts, maxAttempts: r.maxAttempts,
      nextRunAt: r.nextRunAt?.toISOString() ?? null,
      claimedAt: r.claimedAt?.toISOString() ?? null,
      lastError: r.lastError, createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
    meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    stats,
    queue: queueHealth(),
  }
}

/**
 * POST /api/v1/admin/jobs/[id]/replay — reset a DEAD job to PENDING with a
 * clean attempt counter. Audited (JOB_REPLAY). The worker picks it up ≤1s.
 */
export async function replayJob(id: string, ctx: RequestContext, actorId: string) {
  const job = await db.durableJob.findUnique({ where: { id } })
  if (!job) throw new NotFoundError('شغل یافت نشد')
  if (job.status !== 'DEAD') {
    throw new AppError('CONFLICT' as ErrorCode, 'فقط شغل‌های مرده (Dead Letter) قابل اجرای مجدد هستند', 409, { status: job.status })
  }
  await db.durableJob.update({
    where: { id },
    data: {
      status: 'PENDING', attempts: 0, claimedAt: null, finishedAt: null,
      lastError: null, ownerPid: null, nextRunAt: new Date(),
    },
  })
  await writeAudit(ctx, {
    userId: actorId,
    action: 'JOB_REPLAY',
    entity: 'DurableJob',
    entityId: id,
    newValues: { type: job.type, previousAttempts: job.attempts },
  })
  await refreshMirrorFromDb()
  ensureWorker()
  return { ok: true, message: 'شغل برای اجرای مجدد در صف قرار گرفت', jobId: id, type: job.type }
}
