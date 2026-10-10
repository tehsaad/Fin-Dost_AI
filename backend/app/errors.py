"""Uniform error responses: {"error": {"code", "message", "details"}}."""
from __future__ import annotations

import logging
import traceback
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"{what} not found")


def _body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details}}


log = logging.getLogger("findost.errors")


def install_error_handlers(app: FastAPI) -> None:
    @app.middleware("http")
    async def _request_id(request: Request, call_next):
        request.state.request_id = request.headers.get("x-request-id", "")[:64] or uuid.uuid4().hex[:16]
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @app.exception_handler(ApiError)
    async def _api_error(_req: Request, exc: ApiError):
        return JSONResponse(_body(exc.code, exc.message, exc.details), status_code=exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_req: Request, exc: StarletteHTTPException):
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}
        return JSONResponse(
            _body(code.get(exc.status_code, f"http_{exc.status_code}"), str(exc.detail)),
            status_code=exc.status_code,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_req: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(str(p) for p in err.get("loc", []) if p != "body"), "message": err.get("msg")}
            for err in exc.errors()
        ]
        return JSONResponse(_body("validation_error", "Request validation failed", details), status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(req: Request, exc: Exception):
        # Log the exception type and route only: messages can contain financial values or SQL.
        rid = getattr(req.state, "request_id", "")
        where = " <- ".join(f"{f.filename.rsplit('/', 1)[-1]}:{f.lineno}" for f in traceback.extract_tb(exc.__traceback__)[-4:][::-1])
        log.error("Unhandled %s on %s %s at %s (request %s)", type(exc).__name__, req.method, req.url.path, where, rid)
        return JSONResponse(_body("internal_error", "Something went wrong on our side. Please try again.",
                                  {"request_id": rid}), status_code=500, headers={"X-Request-ID": rid})
