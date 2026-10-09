"""Environment configuration. Secrets stay in the process environment."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_REPO_DIR = _BACKEND_DIR.parent

PLACEHOLDER_VALUES = {
    "replace-with-a-long-password",
    "change-me",
    "replace-with-32-plus-random-chars",
    "replace-me",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(_REPO_DIR / ".env"), str(_BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    database_url: str = Field(alias="DATABASE_URL")
    auth_secret: str = Field(alias="AUTH_SECRET")
    dashboard_username: str = Field(alias="DASHBOARD_USERNAME")
    dashboard_password: str = Field(alias="DASHBOARD_PASSWORD")
    environment: str = Field(default="development", alias="ENVIRONMENT")
    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")
    allow_synthetic: bool = Field(default=False, alias="ALLOW_SYNTHETIC")
    enable_docs: bool | None = Field(default=None, alias="ENABLE_DOCS")
    odds_freshness_minutes: int = Field(default=180, alias="ODDS_FRESHNESS_MINUTES")
    fixture_refetch_minutes: int = Field(default=360, alias="FIXTURE_REFETCH_MINUTES")
    odds_refetch_minutes: int = Field(default=60, alias="ODDS_REFETCH_MINUTES")
    prediction_time_budget_seconds: int = Field(default=25, alias="PREDICTION_TIME_BUDGET_SECONDS")
    prediction_time_budget_cap_seconds: int = Field(default=60, alias="PREDICTION_TIME_BUDGET_CAP_SECONDS")
    min_probability_a: float = Field(default=0.40, alias="MIN_PROBABILITY_A")
    min_probability_b: float = Field(default=0.28, alias="MIN_PROBABILITY_B")
    min_probability_c: float = Field(default=0.18, alias="MIN_PROBABILITY_C")
    min_data_quality: float = Field(default=0.25, alias="MIN_DATA_QUALITY")
    min_team_matches: int = Field(default=5, alias="MIN_TEAM_MATCHES")
    target_odds_min: float = Field(default=10.0, alias="TARGET_ODDS_MIN")
    target_odds_max: float = Field(default=30.0, alias="TARGET_ODDS_MAX")
    max_slip_legs: int = Field(default=5, alias="MAX_SLIP_LEGS")
    beam_width: int = Field(default=30, alias="BEAM_WIDTH")
    rho_min_matches: int = Field(default=80, alias="RHO_MIN_MATCHES")
    api_football_key: str | None = Field(default=None, alias="API_FOOTBALL_KEY")
    odds_api_key: str | None = Field(default=None, alias="ODDS_API_KEY")
    football_data_api_key: str | None = Field(default=None, alias="FOOTBALL_DATA_API_KEY")
    odds_api_sports: str = Field(default="soccer_epl", alias="ODDS_API_SPORTS")
    odds_api_bookmakers: str = Field(default="onexbet", alias="ODDS_API_BOOKMAKERS")
    api_football_league_ids: str = Field(default="", alias="API_FOOTBALL_LEAGUE_IDS")
    football_data_competitions: str = Field(default="PL", alias="FOOTBALL_DATA_COMPETITIONS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    session_hours: int = Field(default=12, alias="SESSION_HOURS")

    @property
    def docs_enabled(self) -> bool:
        if self.enable_docs is None:
            return self.environment != "production"
        return self.enable_docs

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    def split_csv(self, raw: str | None) -> list[str]:
        if not raw:
            return []
        return [item.strip() for item in raw.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def assert_runtime_secrets(settings: Settings) -> None:
    """Refuse to boot a non-test process that is still using placeholders."""
    if settings.environment == "test":
        return
    problems: list[str] = []
    if len(settings.auth_secret) < 32 or settings.auth_secret in PLACEHOLDER_VALUES:
        problems.append("AUTH_SECRET must be at least 32 characters and not a placeholder")
    if (
        len(settings.dashboard_password) < 12
        or settings.dashboard_password in PLACEHOLDER_VALUES
    ):
        problems.append("DASHBOARD_PASSWORD must be at least 12 characters and not a placeholder")
    if settings.dashboard_username.strip() == "":
        problems.append("DASHBOARD_USERNAME is required")
    if problems:
        raise RuntimeError("; ".join(problems))
