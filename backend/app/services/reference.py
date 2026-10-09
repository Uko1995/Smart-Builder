"""Idempotent reference data for providers, markets and bookmakers."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.markets.registry import (
    BOOKMAKERS,
    FEATURE_VERSION,
    MAPPINGS,
    MARKET_BY_KEY,
    MARKETS,
    MODEL_DESCRIPTION,
    MODEL_VERSION_KEY,
    PROVIDERS,
)
from app.models import (
    AppSetting,
    Bookmaker,
    BookmakerMarketMapping,
    MarketDefinition,
    ModelVersion,
    Provider,
)


def settings_payload(settings: Settings) -> dict:
    return {
        "odds_freshness_minutes": settings.odds_freshness_minutes,
        "min_probability_a": settings.min_probability_a,
        "min_probability_b": settings.min_probability_b,
        "min_probability_c": settings.min_probability_c,
        "min_data_quality": settings.min_data_quality,
        "min_team_matches": settings.min_team_matches,
        "target_odds_min": settings.target_odds_min,
        "target_odds_max": settings.target_odds_max,
        "max_slip_legs": settings.max_slip_legs,
        "beam_width": settings.beam_width,
        "rho_min_matches": settings.rho_min_matches,
        "prediction_time_budget_seconds": settings.prediction_time_budget_seconds,
        "allow_synthetic": settings.allow_synthetic,
        "fixture_refetch_minutes": settings.fixture_refetch_minutes,
        "odds_refetch_minutes": settings.odds_refetch_minutes,
    }


def effective_settings(session: Session, settings: Settings) -> dict:
    row = session.get(AppSetting, 1)
    defaults = settings_payload(settings)
    if row is None:
        session.add(AppSetting(id=1, payload=defaults))
        session.flush()
        return defaults
    merged = {**defaults, **(row.payload or {})}
    return merged


def update_settings(session: Session, settings: Settings, changes: dict) -> dict:
    bounds = {
        "odds_freshness_minutes": (15, 7 * 24 * 60),
        "min_probability_a": (0.05, 0.95),
        "min_probability_b": (0.05, 0.95),
        "min_probability_c": (0.05, 0.95),
        "min_data_quality": (0.0, 1.0),
        "min_team_matches": (3, 50),
        "target_odds_min": (2.0, 50.0),
        "target_odds_max": (3.0, 100.0),
        "max_slip_legs": (1, 8),
        "beam_width": (5, 100),
        "rho_min_matches": (20, 5000),
        "prediction_time_budget_seconds": (5, 60),
        "fixture_refetch_minutes": (30, 7 * 24 * 60),
        "odds_refetch_minutes": (15, 24 * 60),
    }
    current = effective_settings(session, settings)
    for key, value in changes.items():
        if key not in bounds and key != "allow_synthetic":
            raise ValueError(f"unknown setting: {key}")
        if key == "allow_synthetic":
            current[key] = bool(value)
            continue
        low, high = bounds[key]
        number = float(value) if isinstance(low, float) else int(value)
        if number < low or number > high:
            raise ValueError(f"{key} is outside {low}..{high}")
        current[key] = number
    if current["target_odds_min"] >= current["target_odds_max"]:
        raise ValueError("target_odds_min must be below target_odds_max")
    if not (
        current["min_probability_a"] >= current["min_probability_b"] >= current["min_probability_c"]
    ):
        raise ValueError("strategy probability floors must be A >= B >= C")
    row = session.get(AppSetting, 1)
    assert row is not None
    row.payload = current
    session.flush()
    return current


def seed_reference(session: Session, settings: Settings) -> None:
    providers = {}
    for item in PROVIDERS:
        row = session.scalar(select(Provider).where(Provider.key == item["key"]))
        if row is None:
            row = Provider(key=item["key"], name=item["name"], kind=item["kind"], health_status="not_configured")
            session.add(row)
            session.flush()
        providers[item["key"]] = row
    _mark_configured(providers["api_football"], bool(settings.api_football_key))
    _mark_configured(providers["the_odds_api"], bool(settings.odds_api_key))
    _mark_configured(providers["football_data_org"], bool(settings.football_data_api_key))
    providers["manual"].configured = True
    providers["manual"].health_status = "ok"
    providers["synthetic_demo"].configured = True
    providers["synthetic_demo"].health_status = "synthetic"

    bookmakers = {}
    for item in BOOKMAKERS:
        row = session.scalar(select(Bookmaker).where(Bookmaker.key == item.key))
        if row is None:
            row = Bookmaker(key=item.key, name=item.name, is_synthetic=item.is_synthetic, notes=item.notes)
            session.add(row)
            session.flush()
        bookmakers[item.key] = row

    markets = {}
    for item in MARKETS:
        row = session.scalar(select(MarketDefinition).where(MarketDefinition.key == item.key))
        if row is None:
            row = MarketDefinition(
                key=item.key,
                display_name=item.display_name,
                family=item.family,
                period=item.period,
                line_required=item.line_required,
                selections=list(item.selections),
                settlement=item.settlement,
                required_data=item.required_data,
                implementation_status=item.implementation_status,
                enabled=item.enabled,
            )
            session.add(row)
            session.flush()
        else:
            row.display_name = item.display_name
            row.implementation_status = item.implementation_status
            row.settlement = item.settlement
            row.required_data = item.required_data
        markets[item.key] = row

    for item in MAPPINGS:
        market = markets[item.market_key]
        bookmaker = bookmakers[item.bookmaker_key]
        existing = session.scalar(
            select(BookmakerMarketMapping).where(
                BookmakerMarketMapping.bookmaker_id == bookmaker.id,
                BookmakerMarketMapping.market_definition_id == market.id,
                BookmakerMarketMapping.provider_market_key == item.provider_market_key,
            )
        )
        if existing is None:
            session.add(
                BookmakerMarketMapping(
                    bookmaker_id=bookmaker.id,
                    market_definition_id=market.id,
                    provider_market_key=item.provider_market_key,
                    status=item.status,
                    notes=item.notes,
                )
            )
    if session.scalar(select(ModelVersion).where(ModelVersion.version_key == MODEL_VERSION_KEY)) is None:
        session.add(
            ModelVersion(
                version_key=MODEL_VERSION_KEY,
                feature_version=FEATURE_VERSION,
                description=MODEL_DESCRIPTION,
            )
        )
    effective_settings(session, settings)
    session.flush()


def _mark_configured(provider: Provider, configured: bool) -> None:
    provider.configured = configured
    if not configured:
        provider.health_status = "not_configured"
    elif provider.health_status == "not_configured":
        provider.health_status = "unknown"


def market_catalog() -> list[dict]:
    return [
        {
            "key": item.key,
            "display_name": item.display_name,
            "family": item.family,
            "period": item.period,
            "line_required": item.line_required,
            "selections": list(item.selections),
            "settlement": item.settlement,
            "required_data": item.required_data,
            "implementation_status": item.implementation_status,
            "enabled": item.enabled,
        }
        for item in MARKETS
    ]


def require_market(key: str) -> None:
    if key not in MARKET_BY_KEY:
        raise ValueError(f"unknown market: {key}")
