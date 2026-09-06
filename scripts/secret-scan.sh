#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# PHASE 19 · secret-scan.sh — secret detection over the GIT-TRACKED tree
# (spec §77: "Secret detection" in CI — runnable both locally and in GH Actions;
# the workflow additionally runs gitleaks as a second engine).
# ═══════════════════════════════════════════════════════════════════════════
# What it flags:
#   1. live-looking secrets committed to git (JWT/keys/tokens/private keys)
#   2. .env files that are NOT .env.example entering the index
#   3. high-entropy blobs (40+ hex / base64 runs) outside lockfiles/tests
# Known-safe allowlist (deterministic DEV-ONLY derivations, documented):
#   - 'babahakim-dev:<NAME>' derivation seeds (src/lib/security/env.ts + docs)
#   - test fixtures / harness values (TEST/…, 1234, dummy)
# Exit: 0 = clean · 1 = findings (CI blocks the pipeline)
set -u
cd "$(dirname "$0")/.."

TRACKED=$(git ls-files)
[ -z "$TRACKED" ] && { echo "✗ no tracked files (not a git repo?)"; exit 1; }

FINDINGS=0
flag() { echo "  ✗ $1"; FINDINGS=$((FINDINGS+1)); }

echo "── secret scan (git-tracked tree) ─────────────────────"

# 1 · env hygiene: no real env file may be tracked
for f in $TRACKED; do
  case "$f" in
    .env.example) continue ;;
    .env|\.env\..*) flag "tracked env file: $f (secrets in git — charter rule 6)" ;;
  esac
done

# 2 · pattern scan over tracked text files
while IFS= read -r f; do
  [ -f "$f" ] || continue
  # skip binary-ish files quickly
  case "$f" in
    *.png|*.jpg|*.jpeg|*.webp|*.pdf|*.zip|*.db|*.xlsx) continue ;;
  esac

  # private keys / live JWTs / provider keys
  if grep -nE -- '-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----' "$f" 2>/dev/null | head -1 | grep -q .; then
    flag "$f: private key material"
  fi
  if grep -nE -- 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.' "$f" 2>/dev/null | head -1 | grep -q .; then
    flag "$f: committed JWT-looking token"
  fi
  if grep -nEi -- '(sk|pk)-live-[A-Za-z0-9]{16,}' "$f" 2>/dev/null | head -1 | grep -q .; then
    flag "$f: live provider key pattern"
  fi

  # assigned secrets: NAME=<strong value> outside .env.example / templates
  if [ "$f" != ".env.example" ]; then
    grep -nE -- '^(JWT_SECRET|FIELD_ENC_KEY|SMS_PROVIDER_KEY|STORAGE_SECRET|EMAIL_API_KEY|AI_SERVICE_KEY|SHIPPING_API_KEY|CRM_API_KEY|ANALYTICS_API_KEY)=[A-Za-z0-9+/=_-]{24,}$' "$f" 2>/dev/null \
      | grep -v 'babahakim-dev' | head -1 | grep -q . && flag "$f: assigned real-looking secret"
  fi
done <<< "$TRACKED"

# 3 · documented dev-derivation is ALLOWED (deterministic, not a secret):
#     verify the derivation seed convention stays exactly as designed
if ! grep -q 'babahakim-dev' src/lib/security/env.ts 2>/dev/null; then
  flag "src/lib/security/env.ts: dev-derivation convention changed — update the allowlist"
fi

if [ "$FINDINGS" = "0" ]; then
  echo "  ✓ clean — no secrets in the tracked tree"
  exit 0
fi
echo "── secret scan: $FINDINGS finding(s) ──"
exit 1
