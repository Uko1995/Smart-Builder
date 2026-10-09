from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select, text

from app.models import OddsSnapshot, PredictionBatch
from app.services.demo import seed_demo
from app.services.reference import seed_reference


def test_health_and_ready(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/ready").json()["database"] == "ok"


def test_private_routes_require_auth(client):
    response = client.get("/api/v1/overview")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_login_rejects_a_wrong_password(client):
    response = client.post("/api/v1/auth/login", json={"username": "analyst", "password": "wrong-password"})
    assert response.status_code == 401


def test_prediction_without_fixtures_is_not_a_success(client, auth):
    response = client.post(
        "/api/v1/prediction-runs",
        headers={**auth, "Idempotency-Key": "empty-run-001"},
        json={"scope_date": "2026-10-11", "refresh": False},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "insufficient_data"
    replay = client.post(
        "/api/v1/prediction-runs",
        headers={**auth, "Idempotency-Key": "empty-run-001"},
        json={"scope_date": "2026-10-11", "refresh": False},
    )
    assert replay.status_code == 200
    assert replay.json()["created"] is False


def test_failed_refresh_does_not_create_a_successful_batch(client, auth, monkeypatch):
    class FailedRun:
        status = "failed"
        id = 1

    monkeypatch.setattr("app.services.predictions.refresh_providers", lambda *args, **kwargs: [FailedRun()])
    response = client.post(
        "/api/v1/prediction-runs",
        headers={**auth, "Idempotency-Key": "refresh-fail-001"},
        json={"scope_date": "2026-10-11", "refresh": True},
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "ingestion_failed"


def test_demo_run_is_labelled_and_respects_slip_limits(client, auth, session):
    seeded = seed_demo(session, __import__("app.config", fromlist=["get_settings"]).get_settings(), datetime(2026, 10, 9, tzinfo=UTC).date())
    response = client.post(
        "/api/v1/prediction-runs",
        headers={**auth, "Idempotency-Key": "demo-run-001"},
        json={"scope_date": seeded["scope_date"], "refresh": False},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] in {"succeeded", "succeeded_with_warnings", "no_qualifying_slips"}
    detail = client.get(f"/api/v1/prediction-runs/{body['public_id']}", headers=auth)
    slips = detail.json()["slips"]
    assert len(slips) <= 3
    for slip in slips:
        odds = Decimal(slip["combined_odds"])
        assert Decimal("10") <= odds <= Decimal("30")
        assert slip["preparation_status"] == "synthetic_demo"
        assert "synthetic" in " ".join(slip["warnings"]).lower()


def test_odds_snapshots_are_immutable(session):
    seed_reference(session, __import__("app.config", fromlist=["get_settings"]).get_settings())
    session.commit()
    from app.services.demo import seed_demo as _seed

    _seed(session, __import__("app.config", fromlist=["get_settings"]).get_settings())
    snapshot = session.scalar(select(OddsSnapshot).limit(1))
    assert snapshot is not None
    try:
        session.execute(text("UPDATE odds_snapshots SET decimal_odds = 9 WHERE id = :id"), {"id": snapshot.id})
        session.commit()
        raised = False
    except Exception:
        session.rollback()
        raised = True
    assert raised


def test_duplicate_click_does_not_start_a_second_logical_run(client, auth, session):
    from app.config import get_settings

    seed_demo(session, get_settings(), datetime(2026, 10, 9, tzinfo=UTC).date())
    headers = {**auth, "Idempotency-Key": "demo-run-dup"}
    body = {"scope_date": "2026-10-10", "refresh": False}
    first = client.post("/api/v1/prediction-runs", headers=headers, json=body)
    second = client.post("/api/v1/prediction-runs", headers=headers, json=body)
    assert first.status_code == 200
    assert second.json()["public_id"] == first.json()["public_id"]
    assert second.json()["created"] is False
    count = session.query(PredictionBatch).count()
    assert count == 1


def test_manual_import_and_market_catalog(client, auth):
    fixtures = """external_id,league,season,kickoff_utc,home_team,away_team,status,data_origin,home_goals,away_goals
m1,Premier Research,2026,2026-08-01T15:00:00Z,Alpha,Beta,completed,manual,1,0
m2,Premier Research,2026,2026-10-11T15:00:00Z,Alpha,Gamma,scheduled,manual,,
""".encode()
    created = client.post("/api/v1/imports/fixtures", headers={**auth, "Content-Type": "text/csv"}, content=fixtures)
    assert created.status_code == 200, created.text
    odds = """fixture_external_id,bookmaker_key,market_key,selection,line,decimal_odds,captured_at_utc,data_origin
m2,bet9ja,match_result,home,,2.10,2026-10-09T12:00:00Z,manual
""".encode()
    priced = client.post("/api/v1/imports/odds", headers={**auth, "Content-Type": "text/csv"}, content=odds)
    assert priced.status_code == 200, priced.text
    markets = client.get("/api/v1/markets", headers=auth)
    keys = {item["key"] for item in markets.json()["markets"]}
    assert "match_result" in keys
    assert "player_goals" in keys
    player = next(item for item in markets.json()["markets"] if item["key"] == "player_goals")
    assert player["implementation_status"] == "insufficient_data"
    bet9ja = next(item for item in markets.json()["mappings"] if item["bookmaker"] == "bet9ja")
    assert bet9ja["status"] == "mapping_required"
