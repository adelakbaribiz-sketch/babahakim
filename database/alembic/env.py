"""Alembic environment — BabaHakim PostgreSQL (schema-per-context, ADR-0004).

Connection URL resolution order:
    1. PGDATABASE_URL environment variable (CI / docker)
    2. database/.pgurl file (written by scripts/pg_server.py)
    3. postgresql://postgres@localhost:5432/babahakim_dev fallback
"""
from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# make `models` importable when alembic runs from database/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Base  # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

BOUNDED_CONTEXT_SCHEMAS = {
    "identity", "patients", "medical_records", "ai", "clinical_review", "products",
    "prescriptions", "commerce", "payments", "shipping", "notifications", "tickets",
    "finance", "administration", "reporting",
}


def _resolve_url() -> str:
    url = os.environ.get("PGDATABASE_URL")
    if url:
        return url
    pgurl = Path(__file__).resolve().parent.parent / ".pgurl"
    if pgurl.exists():
        return pgurl.read_text().strip()
    return "postgresql://postgres@localhost:5432/babahakim_dev"


config.set_main_option("sqlalchemy.url", _resolve_url())
target_metadata = Base.metadata


def include_name(name, type_, parent_names):
    """Restrict autogenerate to our 15 bounded-context schemas (+ alembic_version)."""
    if type_ == "schema":
        return name in BOUNDED_CONTEXT_SCHEMAS or name == "public"
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema="public",
        include_schemas=True,
        include_name=include_name,
        compare_type=True,
        compare_server_default=True,
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema="public",
            include_schemas=True,
            include_name=include_name,
            compare_type=True,
            compare_server_default=True,
            transaction_per_migration=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
