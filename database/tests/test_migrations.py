"""Migration lifecycle tests — forward-only discipline (charter rule 8).

- The test database is provisioned exclusively through Alembic (conftest).
- Full cycle: downgrade base → upgrade head → schema contract restored.
- `alembic check`: zero drift between models and database.
- `alembic history`: linear chain, one head.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import text

from conftest import _test_uri  # noqa: E402

DB_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(DB_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

ALEMBIC = str(DB_DIR / ".venv" / "bin" / "alembic")


def _alembic(*args, check=True):
    env = {**os.environ, "PGDATABASE_TEST_URL": "", "PGDATABASE_URL": _test_uri()}
    return subprocess.run([ALEMBIC, *args], cwd=str(DB_DIR), env=env,
                          capture_output=True, text=True, check=check)


def _test_uri() -> str:
    """Delegates to conftest._test_uri (query-string-safe db swap)."""
    from conftest import _test_uri as _impl
    return _impl()


def _run_sql(sql: str):
    import psycopg2
    conn = psycopg2.connect(_test_uri())
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            try:
                return cur.fetchall()
            except Exception:
                return None
    finally:
        conn.close()


def _table_count() -> int:
    return _run_sql("""
        SELECT count(*) FROM information_schema.tables
        WHERE table_schema IN ('identity','patients','medical_records','ai',
            'clinical_review','products','prescriptions','commerce','payments',
            'shipping','notifications','tickets','finance','administration','reporting')
          AND table_type = 'BASE TABLE'
    """)[0][0]


class TestMigrationChain:
    def test_history_is_linear_single_head(self):
        result = _alembic("history")
        assert result.returncode == 0
        out = result.stdout
        revisions = [l for l in out.splitlines() if " -> " in l or "(head)" in l]
        assert len(revisions) >= 4, "expected >= 4 migrations in chain"
        heads = _alembic("heads").stdout.strip().splitlines()
        assert len(heads) == 1, f"multiple heads: {heads}"

    def test_current_is_head(self, engine):
        with engine.connect() as c:
            version = c.execute(text("SELECT version_num FROM public.alembic_version")).fetchone()[0]
        heads_out = _alembic("heads").stdout
        assert version in heads_out

    def test_full_downgrade_upgrade_cycle(self, engine):
        """The strongest migration guarantee: base → head restores the full contract."""
        from models import Base
        expected_tables = len(Base.metadata.sorted_tables)

        assert _table_count() == expected_tables
        _alembic("downgrade", "base")
        assert _table_count() == 0, "downgrade base must drop all bounded-context tables"
        _alembic("upgrade", "head")
        assert _table_count() == expected_tables

        # trigger guards survive the round-trip
        triggers = _run_sql("""
            SELECT count(*) FROM information_schema.triggers
            WHERE trigger_name LIKE 'trg%'
        """)[0][0]
        assert triggers >= 44, f"guards lost after cycle: {triggers}"
        # server defaults survive
        default = _run_sql("""
            SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'clinical_review' AND table_name = 'medical_files'
              AND column_name = 'status' AND column_default IS NOT NULL
        """)[0][0]
        assert default == 1

    def test_alembic_check_no_drift(self):
        result = _alembic("check", check=False)
        assert result.returncode == 0, f"models vs DB drift: {result.stdout} {result.stderr}"

    def test_identity_sequences_restarted(self, conn, seed_role, seed_user):
        uid = seed_user()
        assert uid == 1, "RESTART IDENTITY must reset sequences between tests"
