"""BabaHakim database test-suite — pytest configuration.

Strategy:
- Session engine against a dedicated `babahakim_test` database (never dev).
- Migrations are applied by Alembic itself (upgrade head) — tests always run
  against the *real* migration chain, not `create_all()`.
- Every test starts from clean tables (TRUNCATE ... RESTART IDENTITY CASCADE).
- Raw SQL by default: tests must validate the DATABASE, not the ORM.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

DB_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(DB_DIR))

from models import Base  # noqa: E402


def _test_uri() -> str:
    """Derive the test DB URI from the dev .pgurl.

    pgserver URI shape: postgresql://postgres:@/<dbname>?host=<socket_dir> —
    the db name must be swapped BEFORE the query string, so plain rsplit('/'…)
    would corrupt the socket path.
    """
    uri = os.environ.get("PGDATABASE_TEST_URL")
    if uri:
        return uri
    dev = DB_DIR / ".pgurl"
    if dev.exists():
        uri = dev.read_text().strip()
        base, _, query = uri.partition("?")
        base = base[: base.rfind("/")] + "/babahakim_test"
        return base + (f"?{query}" if query else "")
    return "postgresql://postgres@localhost:5432/babahakim_test"


TEST_URI = _test_uri()


@pytest.fixture(scope="session")
def engine():
    # Run the real migration chain (no-op when already current)
    subprocess.run(
        [str(DB_DIR / ".venv" / "bin" / "alembic"), "upgrade", "head"],
        cwd=str(DB_DIR),
        env={**os.environ, "PGDATABASE_URL": TEST_URI},
        check=True,
        capture_output=True,
    )
    eng = create_engine(TEST_URI)
    yield eng
    eng.dispose()


@pytest.fixture()
def conn(engine):
    with eng_connection(engine) as c:
        try:
            c.rollback()  # defensive: clear any inherited aborted txn
        except Exception:
            pass
        # clean slate — TRUNCATE bypasses row triggers by design (tooling path)
        all_tables = ", ".join(
            f'"{t.schema}"."{t.name}"' for t in Base.metadata.sorted_tables
        )
        c.execute(text(f"TRUNCATE {all_tables} RESTART IDENTITY CASCADE"))
        c.commit()
        yield c
        try:
            c.rollback()
        except Exception:
            pass


@pytest.fixture()
def expect_violation(conn):
    """Assert a statement raises IntegrityError, then rollback the aborted txn —
    PostgreSQL requires ROLLBACK before the connection accepts new statements."""
    import contextlib
    import pytest as _pytest
    from sqlalchemy.exc import IntegrityError as _IE

    @contextlib.contextmanager
    def _expect(match):
        with _pytest.raises(_IE, match=match):
            yield
        try:
            conn.rollback()
        except Exception:
            pass

    return _expect


def eng_connection(engine):
    from contextlib import contextmanager

    @contextmanager
    def _conn():
        with engine.connect() as c:
            yield c

    return _conn()


# ── shared fixtures: minimal valid rows for FK chains ───────────────────

@pytest.fixture()
def seed_role(conn):
    def _role(code="PATIENT"):
        conn.execute(
            text("INSERT INTO identity.roles (code, name_fa, name_en) "
                 "SELECT :c, 'بیمار', 'Patient' "
                 "WHERE NOT EXISTS (SELECT 1 FROM identity.roles WHERE code = :c)"),
            {"c": code},
        )
        conn.commit()
        return code

    return _role


@pytest.fixture()
def seed_user(conn, seed_role):
    counter = {"n": 0}

    def _user(phone="09120000001", role="PATIENT", **extra):
        counter["n"] += 1
        seed_role(role)  # self-sufficient: role always exists
        defaults = {
            "phone": phone,
            "password_hash": "scrypt$x",
            "first_name": "کاربر",
            "last_name": "تست",
            "referral_code": f"RCTEST{counter['n']:06d}",
        }
        defaults.update(extra)
        defaults["_role"] = role
        cols = ", ".join(k for k in defaults if k != "_role")
        params = ", ".join(f":{k}" for k in defaults if k != "_role")
        row = conn.execute(
            text(f"INSERT INTO identity.users ({cols}, role_id) "
                 f"SELECT {params}, id FROM identity.roles WHERE code = :_role RETURNING id"),
            defaults,
        ).fetchone()
        conn.commit()
        assert row is not None, "user insert produced no row (role missing?)"
        return row[0]

    return _user
