"""FinDost AI - FastAPI application.

Interactive API docs: /docs (Swagger UI) and /redoc. All business endpoints
live under /api/v1 and require a Supabase access token.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from .auth import _jwks_client
from .config import get_settings
from .db import get_engine, init_db
from .errors import install_error_handlers
from .routers import account, analytics, imports, internal, inventory, ledger, planning, scenarios, team, workflow

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("findost")

settings = get_settings()

app = FastAPI(
    title="FinDost AI API",
    version="1.0.0",
    description=(
        "Financial intelligence for Pakistani micro-businesses, students and households: ledger (digital khata), "
        "CSV import, cash-flow forecasting, early warnings, shock simulation, recovery strategies, inventory "
        "analytics, reports, an evidence-grounded copilot and an SDG impact benchmark. "
        "All amounts are integer paisa (1 PKR = 100 paisa)."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Workspace-Id"],
)
install_error_handlers(app)

for module in (account, ledger, analytics, scenarios, inventory, imports, internal, planning, workflow, team):
    app.include_router(module.router, prefix="/api/v1")


@app.on_event("startup")
def _startup() -> None:
    # SQLite (local/tests) creates tables automatically; Postgres uses scripts/init_db.py.
    if settings.database_url.startswith("sqlite"):
        init_db()


@app.get("/", tags=["meta"])
def root():
    return {"name": "FinDost AI API", "version": app.version, "docs": "/docs", "health": "/api/v1/health"}


@app.get("/api/v1/health", tags=["meta"])
def health():
    # Booleans only: never expose keys, model quotas or anything user-specific on this public endpoint.
    current = get_settings()
    ai = {"groq": bool(current.groq_api_key), "gemini": bool(current.gemini_api_key)}
    return {"status": "ok", "environment": current.environment, "llm_configured": any(ai.values()), "ai": ai}


@app.get("/api/v1/warmup", tags=["meta"], status_code=204)
def warmup() -> Response:
    """Prepare a cold serverless instance before the user needs it: the public and sign-in pages call this once,
    so the database connection pool and the token-signing keys are ready by the time the dashboard loads.
    Returns no data; failures are logged (type only) and only mean the first real request does this work."""
    try:
        with get_engine().connect() as conn:
            conn.exec_driver_sql("SELECT 1")
    except Exception as exc:  # the real request will surface any database problem with a proper error
        log.warning("warmup: database not ready (%s)", type(exc).__name__)
    current = get_settings()
    if current.supabase_url:
        try:
            _jwks_client(current.supabase_url).get_signing_keys()
        except Exception as exc:
            log.warning("warmup: signing keys not loaded (%s)", type(exc).__name__)
    return Response(status_code=204)
