#!/usr/bin/env python3
"""BabaHakim — Embedded PostgreSQL server manager (no root required).

Usage:
    python scripts/pg_server.py start   # init + start detached server, write .pgurl
    python scripts/pg_server.py stop    # stop the server (data preserved)
    python scripts/pg_server.py status  # check if running

The server runs via pgserver (zonky embedded binaries) as user `postgres`
with trust auth on localhost TCP. Data lives in <database>/pgdata (gitignored).
Connection URI is persisted in <database>/.pgurl for Alembic / pytest / apps.
"""
from __future__ import annotations

import sys
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent.parent
PGDATA = DB_DIR / "pgdata"
PGURL_FILE = DB_DIR / ".pgurl"

DEV_DB = "babahakim_dev"
TEST_DB = "babahakim_test"


def _postmaster_pid() -> int | None:
    pid_file = PGDATA / "postmaster.pid"
    if not pid_file.exists():
        return None
    try:
        return int(pid_file.read_text().splitlines()[0])
    except (ValueError, IndexError):
        return None


def _is_running() -> bool:
    pid = _postmaster_pid()
    if pid is None:
        return False
    try:
        import psutil
        return psutil.pid_exists(pid)
    except Exception:
        import os
        return os.path.exists(f"/proc/{pid}")


def _ensure_databases(server) -> None:
    """Create dev/test databases if missing (idempotent)."""
    import psycopg2
    conn = psycopg2.connect(server.get_uri(database="postgres"))
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            for db in (DEV_DB, TEST_DB):
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db,))
                if cur.fetchone() is None:
                    cur.execute(f'CREATE DATABASE "{db}"')
                    print(f"created database: {db}")
                else:
                    print(f"database exists:  {db}")
    finally:
        conn.close()
    # sanity: connect to the dev database directly
    uri = server.get_uri(database=DEV_DB)
    import psycopg2
    with psycopg2.connect(uri) as c, c.cursor() as cur:
        cur.execute("SELECT version()")
        print("dev db:", cur.fetchone()[0][:60])


def start() -> None:
    if _is_running():
        print("server already running, pid =", _postmaster_pid())
    else:
        import pgserver
        # cleanup_mode=None -> server stays up after this process exits
        server = pgserver.get_server(pgdata=str(PGDATA), cleanup_mode=None)
        print("server started, pid =", server.get_pid())
    # Re-attach to write URI and ensure databases exist
    import pgserver
    server = pgserver.get_server(pgdata=str(PGDATA), cleanup_mode=None)
    uri = server.get_uri(database=DEV_DB)
    PGURL_FILE.write_text(uri + "\n")
    print("uri:", uri)
    _ensure_databases(server)
    print("wrote", PGURL_FILE)


def stop() -> None:
    if not _is_running():
        print("server not running")
        return
    from pgserver._commands import pg_ctl
    pg_ctl(["stop", "-m", "fast"], pgdata=str(PGDATA))
    print("server stopped (data preserved in", PGDATA, ")")


def status() -> None:
    if _is_running():
        print("RUNNING pid =", _postmaster_pid())
        if PGURL_FILE.exists():
            print("uri:", PGURL_FILE.read_text().strip())
    else:
        print("NOT RUNNING")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    {"start": start, "stop": stop, "status": status}[cmd]()
