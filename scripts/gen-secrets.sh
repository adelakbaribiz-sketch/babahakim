#!/bin/bash
# PHASE 19 · gen-secrets.sh — generate production-grade secrets (spec §51).
# Emits ready-to-paste lines for .env.production / .env.staging.
# NEVER writes them into git; output goes to stdout only (caller redirects).
set -u

echo "# ── generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by scripts/gen-secrets.sh ──"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "FIELD_ENC_KEY=$(openssl rand -base64 32)"
echo "AI_DATASET_HASH_SALT=$(openssl rand -hex 16)"
echo ""
echo "# Optional rotation notes:"
echo "#   JWT rotation: users re-login after change (refresh tokens invalidate)"
echo "#   FIELD_ENC_KEY rotation: field-level re-encryption required BEFORE switch"
echo "#   (old key must stay configured until all PII fields are re-encrypted)"
