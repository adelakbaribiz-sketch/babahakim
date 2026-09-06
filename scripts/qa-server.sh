#!/bin/bash
# PHASE 18 QA server boot — production standalone + BH_CHAOS=1 (runbook D-17 /
# RELIABILITY.md §runbook). Uses the deterministic dev-derived secrets so the
# QA server can read sessions/data written by the dev environment (dev
# fallbacks in src/lib/security/env.ts are sha256-derived and stable).
# Survives shell-exit reaping via the setsid wrapper (documented D-17).
set -u
cd /home/z/my-project

JWT=$(python3 -c "import hashlib;print(hashlib.sha256(b'babahakim-dev:JWT_SECRET').hexdigest())")
ENC=$(python3 -c "import hashlib,base64;print(base64.b64encode(hashlib.sha256(b'babahakim-dev:FIELD_ENC_KEY').digest()).decode())")

export DATABASE_URL="file:/home/z/my-project/db/custom.db"
export BH_CHAOS=1
export JWT_SECRET="$JWT"
export FIELD_ENC_KEY="$ENC"
export PORT=3000
export NODE_ENV=production
export HOSTNAME=0.0.0.0

exec bun .next/standalone/server.js
