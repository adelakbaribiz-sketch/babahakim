#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# PHASE 19 · backup.sh — consistent DB + media backup (spec §75 «Backup»)
# ═══════════════════════════════════════════════════════════════════════════
# SQLite: the sqlite3 CLI .backup API takes a consistent snapshot EVEN while
# the server is writing (WAL-aware) — no downtime. Media: tar with the same
# timestamp tag. Rotation: keep N days (MEDIA_BACKUP_RETENTION_DAYS, default 7).
# Cron (production host, root):  15 3 * * *  bhuser /srv/babahakim/scripts/backup.sh
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${BH_DB_PATH:-db/custom.db}"
STORAGE="${BH_STORAGE_DIR:-storage}"
DEST="${BH_BACKUP_DIR:-backups}"
RETAIN_DAYS="${MEDIA_BACKUP_RETENTION_DAYS:-7}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

mkdir -p "${DEST}"
echo "── backup ${STAMP} ─────────────────────────────────────"

# 1 · database — consistent snapshot via the backup API (WAL-aware, online)
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB}" ".backup '${DEST}/bh-${STAMP}.db'"
  echo "  ✓ db → ${DEST}/bh-${STAMP}.db ($(du -h "${DEST}/bh-${STAMP}.db" | cut -f1))"
else
  # fallback: Prisma-level checkpoint + copy (still WAL-safe: TRUNCATE quiesces the WAL)
  python3 - "$DB" "${DEST}/bh-${STAMP}.db" <<'PY'
import sqlite3, shutil, sys
src, dst = sys.argv[1], sys.argv[2]
c = sqlite3.connect(src)
c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
c.close()
shutil.copy2(src, dst)
print('  ✓ db (checkpoint+copy fallback)')
PY
fi

# 2 · media storage (tar, gzip) — the PHASE-07 media backup script also exists
#     for zone-level ops; this is the whole-storage deployment backup
if [ -d "${STORAGE}" ]; then
  tar -czf "${DEST}/storage-${STAMP}.tar.gz" -C "$(dirname "${STORAGE}")" "$(basename "${STORAGE}")" 2>/dev/null \
    && echo "  ✓ storage → ${DEST}/storage-${STAMP}.tar.gz ($(du -h "${DEST}/storage-${STAMP}.tar.gz" | cut -f1))" \
    || echo "  ⚠ storage backup skipped (no storage dir or tar failed)"
fi

# 3 · release manifest snapshot (what was current at backup time)
[ -e current ] && readlink current > "${DEST}/current-at-${STAMP}.txt" 2>/dev/null || true

# 4 · rotation — oldest first
find "${DEST}" -name 'bh-*.db' -mtime +${RETAIN_DAYS} -delete 2>/dev/null || true
find "${DEST}" -name 'storage-*.tar.gz' -mtime +${RETAIN_DAYS} -delete 2>/dev/null || true
echo "  rotation: >${RETAIN_DAYS}d pruned · $(ls "${DEST}" | wc -l) backup file(s) retained"

# 5 · integrity self-check (a backup that can't restore is decoration)
python3 - "${DEST}/bh-${STAMP}.db" <<'PY'
import sqlite3, sys
c = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
tables = c.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
c.close()
assert tables > 30, f'backup looks incomplete: only {tables} tables'
print(f'  ✓ integrity: {tables} tables readable')
PY
