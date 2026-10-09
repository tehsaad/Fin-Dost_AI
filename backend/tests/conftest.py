import os
import sys
import time
from datetime import date

os.environ.update(
    DATABASE_URL="sqlite://",
    DEV_AUTH_SECRET="test-secret-findost-unit-tests-000001",
    FINDOST_TODAY="2026-10-10",
    GEMINI_API_KEY="",
)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jwt  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import get_engine, get_sessionmaker  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402

TODAY = date(2026, 10, 10)


def token(uid: str, meta: dict | None = None) -> dict:
    claims = {"sub": uid, "aud": "authenticated", "role": "authenticated", "exp": int(time.time()) + 3600,
              "user_metadata": meta or {}}
    return {"Authorization": "Bearer " + jwt.encode(claims, "test-secret-findost-unit-tests-000001", algorithm="HS256")}


@pytest.fixture(autouse=True)
def fresh_db():
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture
def db():
    session = get_sessionmaker()()
    yield session
    session.close()


@pytest.fixture
def client():
    return TestClient(app)


def onboard(client: TestClient, uid: str, kind: str = "sme", demo: bool = False) -> dict:
    h = token(uid)
    r = client.post("/api/v1/onboarding", headers=h, json={"kind": kind, "business_name": f"{uid} biz", "load_demo": demo})
    assert r.status_code == 201, r.text
    return h
