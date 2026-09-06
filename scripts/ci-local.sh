#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# PHASE 19 · ci-local.sh — the FULL CI pipeline, locally (spec §76 mirror).
# ═══════════════════════════════════════════════════════════════════════════
# Stage order (spec §76 — any failure STOPS the pipeline):
#   1 lint            5 security-scan      9 deploy (health-gated, auto-rollback)
#   2 type-check      6 build             10 health-check
#   3 unit-tests      7 artifact          11 rollback (drill)
#   4 integration     8 docker-build (CI-only — needs a docker runtime)
#
# Usage:  bash scripts/ci-local.sh [stage …]   (no args = all runnable stages)
# Exit:   first failing stage's code.
# ═══════════════════════════════════════════════════════════════════════════
set -u
cd "$(dirname "$0")/.."

STAGES="${*:-lint type-check unit-tests integration security-scan build artifact deploy health-check rollback-drill}"
FAILED=0

stage() { # name, cmd…
  local name="$1"; shift
  echo ""
  echo "════════ [CI ${name}] ══════════════════════════════"
  if "$@"; then
    echo "════════ [CI ${name}] ✓ PASS ══════════════════════"
  else
    echo "════════ [CI ${name}] ✗ FAIL — pipeline STOPS (spec §76) ════════════════════"
    exit 1
  fi
}

for S in $STAGES; do
  case "$S" in
    lint)             stage "$S" bun run lint ;;
    type-check)       stage "$S" bunx tsc --noEmit ;;
    unit-tests)       stage "$S" bun test src/ ;;
    integration)      stage "$S" bash scripts/qa-run.sh ;;
    security-scan)    stage "$S" bash scripts/ci-security.sh ;;
    build)            stage "$S" bun run build ;;
    artifact)
      stage "$S" bash -c '
        set -e
        SHA=$(git rev-parse --short HEAD)
        mkdir -p dist
        TARBALL="dist/babahakim-${SHA}.tar.gz"
        tar -czf "$TARBALL" -C . .next/standalone .next/static public prisma docker-entrypoint.sh
        sha256sum "$TARBALL" > "${TARBALL}.sha256"
        echo "artifact: $TARBALL ($(du -h "$TARBALL" | cut -f1)) + sha256 checksum"
      ' ;;
    deploy)           stage "$S" bash scripts/deploy.sh --target local --wait-secs 90 ;;
    health-check)
      stage "$S" bash -c '
        set -e
        R=$(curl -s --max-time 3 http://localhost:3000/readiness | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get(\"status\",\"\"), all(d.get(\"checks\",{}).values()))")
        echo "readiness: $R"
        [ "$R" = "ready True" ]
      ' ;;
    rollback-drill)
      stage "$S" bash scripts/rollback-drill.sh ;;
    docker-build)
      if command -v docker >/dev/null 2>&1; then
        stage "$S" docker build -t babahakim/app:ci-"$(git rev-parse --short HEAD)" .
      else
        echo "════════ [CI docker-build] ⊘ SKIPPED (no docker runtime here — runs in GH Actions/registry) ════════════════════"
      fi ;;
    *) echo "unknown stage: $S" >&2; exit 2 ;;
  esac
done

echo ""
echo "════════ CI (local) COMPLETE — all requested stages green ════════════════════"
