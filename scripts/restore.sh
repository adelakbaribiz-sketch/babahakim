#!/bin/bash
# PHASE 19 · restore.sh — restore DB (+ media) from a backup (spec §75).
# A backup strategy without a tested restore is decoration — this script IS
# the tested restore path (drill: scripts/rollback-drill.sh style, see
# DEPLOYMENT.md §8 for the full incident runbook).
# Usage:
#   scripts/restore.sh                          → restore the LATEST backup
#   scripts/restore.sh backups/bh-20260906T094447Z.db [storage-20260906T094447Z.tar.gz]
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${BH_DB_PATH:-db/custom.db}"
DEST="${BH_BACKUP_DIR:-backups}"
STORAGE_DIR="storage"

if [ $# = "0" ]; then
  DB_B=$(ls -1t "${DEST}"/bh-*.db 2>/dev/null | head -1 || true)
  ST_B=$(ls -1t "${DEST}"/storage-*.tar.gz 2>/dev/null | head -1 || true)
else
  DB_B="$1"; ST_B="${2:-}"
fi
[ -n "${DB_B:-}" ] && [ -f "${DB_B}" ] || { echo "✗ no backup db found (looked in ${DEST})" >&2; exit 1; }

echo "── restore ────────────────────────────────────────────"
echo "  db backup : ${DB_B}"
echo "  storage   : ${ST_B:-<not restoring>}"

# 1 · STOP the server first (never restore under a live writer)
PORT_PID=$(ss -tlnpH 'sport = :3000' 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1 || true)
if [ -n "${PORT_PID}" ]; then
  echo "  stopping server (pid ${PORT_PID}) — never restore under a live writer"
  kill "${PORT_PID}" 2>/dev/null || true; sleep 2; kill -9 "${PORT_PID}" 2>/dev/null || true; sleep 1
fi

# 2 · integrity check BEFORE touching the live db
python3 - "${DB_B}" <<'PY'
import sqlite3, sys
c = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
tables = c.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
c.close()
assert tables > 30, f'backup incomplete: {tables} tables'
print(f'  ✓ backup integrity: {tables} tables')
PY

# 3 · swap with a safety copy of the current db
[ -f "${DB}" ] && cp "${DB}" "${DB}.pre-restore.$(date -u +%Y%m%dT%H%M%SZ)"
cp "${DB_B}" "${DB}"
python3 - "${DB}" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
c.close()
print('  ✓ db restored + WAL quiesced')
PY

# 4 · media storage
if [ -n "${ST_B:-}" ] && [ -f "${ST_B}" ]; then
  [ -d "${STORAGE_DIR}" ] && mv "${STORAGE_DIR}" "${STORAGE_DIR}.pre-restore.$(date -u +%Y%m%dT%H%M%SZ)" || true
  tar -xzf "${ST_B}"
  echo "  ✓ storage restored from ${ST_B}"
fi

echo "  done — restart with: bash scripts/deploy.sh --target local   (or docker compose up -d)"
