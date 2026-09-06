#!/bin/bash
# PHASE 19 · self-signed TLS cert for dev/staging nginx (spec §75).
# PRODUCTION: use Let's Encrypt — DEPLOYMENT.md §6 (never ship these certs).
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${1:-localhost}"
OUT="certs"
mkdir -p "$OUT"

openssl req -x509 -nodes -newkey rsa:2048 -days 397 \
  -keyout "$OUT/privkey.pem" -out "$OUT/fullchain.pem" \
  -subj "/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN},DNS:*.${DOMAIN},DNS:localhost" \
  -addext "basicConstraints=critical,CA:FALSE"

chmod 600 "$OUT/privkey.pem"
echo "✓ self-signed pair written to deploy/nginx/$OUT (valid 397 days)"
echo "  mount: ./deploy/nginx/certs:/etc/nginx/certs:ro"
