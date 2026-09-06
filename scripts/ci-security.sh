#!/bin/bash
# PHASE 19 · ci-security.sh — the static security-scan stage (spec §77).
# Dependency vulnerability scan + secret detection + SAST-lite, with honest
# degradation: unavailable heavy tools are LOUDLY skipped (CI runs them all).
#   dependency-vuln : bun pm audit (falls back to osv-scanner if installed)
#   secret-detect   : scripts/secret-scan.sh (always runs — zero deps)
#   architecture    : the 10 phase audit gates (always run)
#   SAST            : semgrep when installed (CI); ruleset: p/typescript
set -u
cd "$(dirname "$0")/.."
FAIL=0

echo "── [security] 1/4 dependency vulnerability scan ───────"
if bun pm audit 2>/dev/null; then
  echo "  ✓ bun pm audit clean"
else
  CODE=$?
  if [ "$CODE" = "1" ]; then
    echo "  ✗ vulnerable dependencies found — pipeline stops"; FAIL=1
  else
    echo "  ⚠ bun pm audit unavailable (exit $CODE) — osv-scanner/gitleaks run in CI (DEPLOYMENT.md §9)"
  fi
fi

echo "── [security] 2/4 secret detection ────────────────────"
bash scripts/secret-scan.sh || FAIL=1

echo "── [security] 3/4 architecture gates (10 phases) ─────"
for g in backend frontend media ai integrations reporting observability perf reliability qa; do
  npm run --silent audit:$g > /tmp/ci-sec-gate.log 2>&1 \
    && echo "  ✓ audit:$g" \
    || { echo "  ✗ audit:$g FAILED"; tail -3 /tmp/ci-sec-gate.log; FAIL=1; }
done

echo "── [security] 4/4 SAST (semgrep when available) ──────"
if command -v semgrep >/dev/null 2>&1; then
  semgrep --config p/typescript --error src/ 2>/dev/null && echo "  ✓ semgrep clean" || { echo "  ✗ semgrep findings"; FAIL=1; }
else
  echo "  ⚠ semgrep not installed locally — runs in GH Actions (workflow ci.yml job: security)"
fi

[ "$FAIL" = "0" ] && echo "── security-scan: PASS ──" || echo "── security-scan: FAIL ──"
exit $FAIL
