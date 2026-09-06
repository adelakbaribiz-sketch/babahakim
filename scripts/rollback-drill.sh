#!/bin/bash
# PHASE 19 · rollback-drill.sh — prove the rollback path WORKS (spec §76).
# A rollback procedure that was never executed is a wish, not a runbook.
# Drill: deploy current HEAD → verify → rollback to previous release →
# verify readiness on the OLD release → redeploy HEAD (leave the system on
# the newest release, drill evidence in the logs).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── rollback drill ─────────────────────────────────────"
CUR=$(readlink current 2>/dev/null || echo "")
echo "  current: ${CUR:-<none>}"

# 1 · deploy HEAD (creates a NEW release; health-gated)
bash scripts/deploy.sh --target local --wait-secs 90 2>&1 | tail -3

# 2 · there must now be a release OLDER than current to roll back to
PREV=$(ls -1dt releases/*/ | grep -v "^$(readlink current)/$" | head -1 || true)
if [ -z "$PREV" ]; then
  echo "  ⚠ only one release exists — drill needs two; deploying a second time…"
  bash scripts/deploy.sh --target local --wait-secs 90 2>&1 | tail -2
  PREV=$(ls -1dt releases/*/ | grep -v "^$(readlink current)/$" | head -1)
fi

# 3 · ROLL BACK to the previous release (health-gated, atomic)
bash scripts/rollback.sh 2>&1 | tail -3
ROLLED=$(readlink current)
if [ "$ROLLED" != "${PREV%/}" ]; then
  echo "✗ rollback did not switch to the previous release ($ROLLED ≠ ${PREV%/})" >&2; exit 1
fi

# 4 · the OLD release must serve readiness
R=$(curl -s --max-time 3 http://localhost:3000/readiness | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))')
[ "$R" = "ready" ] || { echo "✗ rolled-back release failed readiness ($R)" >&2; exit 1; }
echo "  ✓ previous release serves readiness after rollback"

# 5 · restore the newest state (leave the system better than we found it)
bash scripts/deploy.sh --target local --wait-secs 90 2>&1 | tail -2
echo "── rollback drill: PASS (rollback + recovery both proven) ──"
