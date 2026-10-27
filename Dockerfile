# syntax=docker/dockerfile:1
# ═══════════════════════════════════════════════════════════════════════════
# BabaHakim (باباحکیم) — production image (PHASE 19 · spec §50/§75)
# Multi-stage: deps → build → runner. Next.js standalone output (ADR: single
# deployable: API + in-process DurableJob worker + samplers live in ONE
# process — splitting worker/scheduler containers is the multi-instance
# growth path D-17-1, not a v1 requirement).
# Run: non-root (bh:1001), tini PID1 (signal forwarding → graceful shutdown),
# migrations at boot (idempotent `prisma migrate deploy`), healthcheck via
# the DB-free /liveness probe (PHASE 15).
# ═══════════════════════════════════════════════════════════════════════════

FROM oven/bun:1.2-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# 'build' doubles as the tools image (one-shot production seed: see
# docker-compose.prod.yml service 'bootstrap') — it has the full source tree
FROM oven/bun:1.2-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma client generate — no live DB needed
RUN bunx prisma generate
# build never contacts the DB (all routes dynamic); placeholder keeps prisma happy
ENV DATABASE_URL=file:/tmp/build-placeholder.db
RUN bun run build

FROM oven/bun:1.2-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=file:/data/bh.db \
    BH_STORAGE_PATH=/data/storage

# tini (PID 1 signal forwarding → graceful shutdown: in-flight jobs finish),
# openssl + certs (prisma engines / TLS), curl (container healthcheck)
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends tini openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1001 bh

# prisma CLI + engines only (schema engine for `migrate deploy` — no network at boot)
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.bin ./node_modules/.bin
COPY prisma ./prisma
# safe migrator: handles fresh / db-push / history databases, backs up before writes
COPY scripts/db-migrate-safe.mjs ./scripts/db-migrate-safe.mjs

# standalone runtime — SELECTIVE (Next 16 snapshots the whole project into
# .next/standalone; shipping it would bake the repo into the image). Only
# what server.js resolves: entry, config, traced node_modules, build output.
COPY --from=build --chown=1001:1001 /app/.next/standalone/server.js ./.next/standalone/server.js
COPY --from=build --chown=1001:1001 /app/.next/standalone/package.json ./.next/standalone/package.json
COPY --from=build --chown=1001:1001 /app/.next/standalone/next.config.ts ./.next/standalone/next.config.ts
COPY --from=build --chown=1001:1001 /app/.next/standalone/node_modules ./.next/standalone/node_modules
COPY --from=build --chown=1001:1001 /app/.next/standalone/.next ./.next/standalone/.next
COPY --from=build --chown=1001:1001 /app/public ./.next/standalone/public

COPY --chown=1001:1001 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data/storage \
 && chown -R 1001:1001 /data /app

USER bh
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD curl -fsS http://localhost:3000/liveness || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
