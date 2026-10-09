"""Create tables in the configured database (run once per environment).

For Supabase Postgres this also enables Row Level Security on every table.
No policies are added, so the public anon/authenticated API roles cannot read
or write these tables directly; only the FastAPI backend (database owner
connection) can, and it enforces per-user ownership itself.

Usage: DATABASE_URL=postgresql://... python scripts/init_db.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.db import get_engine  # noqa: E402
from app.models import Base  # noqa: E402

engine = get_engine()
Base.metadata.create_all(engine)
if engine.dialect.name == "postgresql":
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            conn.execute(text(f'ALTER TABLE public."{table.name}" ENABLE ROW LEVEL SECURITY'))
print(f"Tables ready on {engine.dialect.name}: {', '.join(t.name for t in Base.metadata.sorted_tables)}")
