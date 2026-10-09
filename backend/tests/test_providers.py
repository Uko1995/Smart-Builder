import httpx

from app.config import Settings
from app.providers.clients import fetch_odds
from app.providers.http import ProviderHttpClient, ProviderRequestError
from app.providers.parsing import parse_api_football_fixtures, parse_odds_api_payload


def test_retries_then_returns_server_error():
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(503, json={"error": "busy"})

    delays = []
    client = ProviderHttpClient(max_retries=2, backoff_seconds=0.2, transport=httpx.MockTransport(handler), sleep=delays.append)
    response = client.get("https://example.test/fixtures")
    assert response.status_code == 503
    assert calls["count"] == 3
    assert delays[0] == 0.2
    assert delays[1] == 0.4


def test_timeout_raises_after_retries():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out")

    client = ProviderHttpClient(max_retries=1, backoff_seconds=0.1, transport=httpx.MockTransport(handler), sleep=lambda _seconds: None)
    try:
        client.get("https://example.test/fixtures?apiKey=secret")
        raised = False
    except ProviderRequestError as exc:
        raised = True
        assert "secret" not in str(exc)
    assert raised


def test_api_football_parser_does_not_invent_scores():
    fixtures = parse_api_football_fixtures(
        {
            "response": [
                {
                    "fixture": {"id": 10, "date": "2026-10-10T15:00:00+00:00", "status": {"short": "NS"}},
                    "league": {"id": 39, "name": "Premier League", "season": 2026, "country": "England"},
                    "teams": {"home": {"id": 1, "name": "Arsenal"}, "away": {"id": 2, "name": "Chelsea"}},
                    "goals": {"home": None, "away": None},
                    "score": {"halftime": {"home": None, "away": None}},
                }
            ]
        }
    )
    assert fixtures[0].status == "scheduled"
    assert fixtures[0].home_goals is None


def test_odds_api_maps_1xbet_h2h_and_leaves_unknown_markets_unmapped():
    rows = parse_odds_api_payload(
        [
            {
                "id": "evt",
                "home_team": "Arsenal",
                "away_team": "Chelsea",
                "commence_time": "2026-10-10T15:00:00Z",
                "bookmakers": [
                    {
                        "key": "onexbet",
                        "title": "1xBet",
                        "markets": [
                            {
                                "key": "h2h",
                                "last_update": "2026-10-09T12:00:00Z",
                                "outcomes": [
                                    {"name": "Arsenal", "price": 1.8},
                                    {"name": "Draw", "price": 3.6},
                                    {"name": "Chelsea", "price": 4.4},
                                ],
                            },
                            {
                                "key": "spreads",
                                "last_update": "2026-10-09T12:00:00Z",
                                "outcomes": [{"name": "Arsenal", "price": 1.9, "point": -0.5}],
                            },
                        ],
                    }
                ],
            }
        ],
        {"onexbet"},
    )
    verified = [row for row in rows if row.mapping_status == "verified"]
    assert [row.selection for row in verified] == ["home", "draw", "away"]
    assert any(row.mapping_status == "mapping_required" and row.market_key is None for row in rows)


def test_missing_odds_key_is_reported(monkeypatch):
    settings = Settings(
        DATABASE_URL="postgresql+psycopg://spl:spl@127.0.0.1:5432/soccer_prediction_lab_test",
        AUTH_SECRET="test-secret-key-with-32-characters-min",
        DASHBOARD_USERNAME="analyst",
        DASHBOARD_PASSWORD="test-password-123",
        ENVIRONMENT="test",
        ODDS_API_KEY=None,
    )
    client = ProviderHttpClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=[])))
    try:
        fetch_odds(settings, client, "soccer_epl")
        raised = False
    except ProviderRequestError as exc:
        raised = True
        assert exc.retryable is False
    assert raised
