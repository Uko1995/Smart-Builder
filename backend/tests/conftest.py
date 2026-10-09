import os

os.environ["DATABASE_URL"] = "postgresql+psycopg://spl:spl@127.0.0.1:5432/soccer_prediction_lab_test"
os.environ["AUTH_SECRET"] = "test-secret-key-with-32-characters-min"
os.environ["DASHBOARD_USERNAME"] = "analyst"
os.environ["DASHBOARD_PASSWORD"] = "test-password-123"
os.environ["ENVIRONMENT"] = "test"
os.environ["ALLOW_SYNTHETIC"] = "true"
os.environ["API_FOOTBALL_KEY"] = ""
os.environ["ODDS_API_KEY"] = ""
os.environ["FOOTBALL_DATA_API_KEY"] = ""
os.environ["CORS_ORIGINS"] = "http://localhost:3000"

from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.config import get_settings
from app.db import get_session_factory, reset_engine
from app.rate_limit import limiter

get_settings.cache_clear()
reset_engine()
command.upgrade(Config("alembic.ini"), "head")

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def session():
    factory = get_session_factory()
    db = factory()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def clean_database(session):
    limiter._events.clear()
    yield
    session.execute(
        text(
            """
            TRUNCATE TABLE
                slip_selections,
                slip_evaluations,
                predictions,
                slips,
                prediction_batches,
                feature_snapshots,
                odds_snapshots,
                player_match_statistics,
                match_statistics,
                fixtures,
                players,
                seasons,
                teams,
                leagues,
                ingestion_runs,
                evaluation_runs,
                bookmaker_market_mappings,
                market_definitions,
                bookmakers,
                model_versions,
                providers,
                app_settings
            RESTART IDENTITY CASCADE
            """
        )
    )
    session.commit()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth(client):
    response = client.post("/api/v1/auth/login", json={"username": "analyst", "password": "test-password-123"})
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
