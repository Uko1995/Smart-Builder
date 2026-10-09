"""Relational schema. Decimal odds and probabilities are numeric, not floats."""

from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _ts() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Provider(Base):
    __tablename__ = "providers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    configured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    health_status: Mapped[str] = mapped_column(String(32), nullable=False, default="not_configured")
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    quota_remaining: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = _ts()


class League(Base):
    __tablename__ = "leagues"
    __table_args__ = (UniqueConstraint("provider_id", "external_id", name="uq_league_external"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    country: Mapped[str | None] = mapped_column(String(80))
    data_origin: Mapped[str] = mapped_column(String(32), nullable=False, default="provider")
    created_at: Mapped[datetime] = _ts()


class Season(Base):
    __tablename__ = "seasons"
    __table_args__ = (UniqueConstraint("league_id", "name", name="uq_season_name"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = _ts()


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (UniqueConstraint("provider_id", "external_id", name="uq_team_external"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(160), nullable=False)
    data_origin: Mapped[str] = mapped_column(String(32), nullable=False, default="provider")
    created_at: Mapped[datetime] = _ts()


class Player(Base):
    __tablename__ = "players"
    __table_args__ = (UniqueConstraint("provider_id", "external_id", name="uq_player_external"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), nullable=False)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"))
    external_id: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = _ts()


class Fixture(Base):
    __tablename__ = "fixtures"
    __table_args__ = (
        UniqueConstraint("provider_id", "external_id", name="uq_fixture_external"),
        Index("ix_fixtures_kickoff", "kickoff_at"),
        CheckConstraint(
            "status IN ('scheduled','completed','postponed','cancelled','unknown')",
            name="ck_fixture_status",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(80), nullable=False)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"), nullable=False)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), nullable=False)
    home_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    away_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    kickoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="scheduled")
    home_goals: Mapped[int | None] = mapped_column(Integer)
    away_goals: Mapped[int | None] = mapped_column(Integer)
    ht_home_goals: Mapped[int | None] = mapped_column(Integer)
    ht_away_goals: Mapped[int | None] = mapped_column(Integer)
    data_origin: Mapped[str] = mapped_column(String(32), nullable=False, default="provider")
    provenance: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class MatchStatistics(Base):
    __tablename__ = "match_statistics"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    fixture_id: Mapped[int] = mapped_column(ForeignKey("fixtures.id"), unique=True, nullable=False)
    home_corners: Mapped[int | None] = mapped_column(Integer)
    away_corners: Mapped[int | None] = mapped_column(Integer)
    home_cards: Mapped[int | None] = mapped_column(Integer)
    away_cards: Mapped[int | None] = mapped_column(Integer)
    home_xg: Mapped[Decimal | None] = mapped_column(Numeric(6, 3))
    away_xg: Mapped[Decimal | None] = mapped_column(Numeric(6, 3))
    home_shots: Mapped[int | None] = mapped_column(Integer)
    away_shots: Mapped[int | None] = mapped_column(Integer)
    home_shots_on_target: Mapped[int | None] = mapped_column(Integer)
    away_shots_on_target: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = _ts()


class PlayerMatchStatistics(Base):
    __tablename__ = "player_match_statistics"
    __table_args__ = (UniqueConstraint("fixture_id", "player_id", name="uq_player_fixture"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    fixture_id: Mapped[int] = mapped_column(ForeignKey("fixtures.id"), nullable=False)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), nullable=False)
    minutes: Mapped[int | None] = mapped_column(Integer)
    goals: Mapped[int | None] = mapped_column(Integer)
    assists: Mapped[int | None] = mapped_column(Integer)
    shots: Mapped[int | None] = mapped_column(Integer)
    shots_on_target: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = _ts()


class Bookmaker(Base):
    __tablename__ = "bookmakers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = _ts()


class MarketDefinition(Base):
    __tablename__ = "market_definitions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    family: Mapped[str] = mapped_column(String(32), nullable=False)
    period: Mapped[str] = mapped_column(String(32), nullable=False)
    line_required: Mapped[bool] = mapped_column(Boolean, nullable=False)
    selections: Mapped[list] = mapped_column(JSONB, nullable=False)
    settlement: Mapped[str] = mapped_column(Text, nullable=False)
    required_data: Mapped[str] = mapped_column(Text, nullable=False)
    implementation_status: Mapped[str] = mapped_column(String(32), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = _ts()


class BookmakerMarketMapping(Base):
    __tablename__ = "bookmaker_market_mappings"
    __table_args__ = (
        UniqueConstraint(
            "bookmaker_id",
            "market_definition_id",
            "provider_market_key",
            name="uq_bookmaker_market_map",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    bookmaker_id: Mapped[int] = mapped_column(ForeignKey("bookmakers.id"), nullable=False)
    market_definition_id: Mapped[int] = mapped_column(
        ForeignKey("market_definitions.id"), nullable=False
    )
    provider_market_key: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = _ts()


class OddsSnapshot(Base):
    """Immutable captured price. Updates and deletes are rejected by a database trigger."""

    __tablename__ = "odds_snapshots"
    __table_args__ = (
        CheckConstraint("decimal_odds > 1", name="ck_odds_gt_one"),
        Index("ix_odds_fixture", "fixture_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    fixture_id: Mapped[int] = mapped_column(ForeignKey("fixtures.id"), nullable=False)
    bookmaker_id: Mapped[int] = mapped_column(ForeignKey("bookmakers.id"), nullable=False)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), nullable=False)
    market_key: Mapped[str] = mapped_column(String(64), nullable=False)
    selection: Mapped[str] = mapped_column(String(40), nullable=False)
    line: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    decimal_odds: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mapping_status: Mapped[str] = mapped_column(String(32), nullable=False)
    data_origin: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = _ts()


class ModelVersion(Base):
    __tablename__ = "model_versions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    version_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    feature_version: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _ts()


class FeatureSnapshot(Base):
    __tablename__ = "feature_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    model_version_id: Mapped[int] = mapped_column(ForeignKey("model_versions.id"), nullable=False)
    fixture_id: Mapped[int] = mapped_column(ForeignKey("fixtures.id"), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    training_cutoff: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = _ts()


class PredictionBatch(Base):
    __tablename__ = "prediction_batches"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_prediction_idempotency"),
        CheckConstraint(
            "status IN ('running','succeeded','succeeded_with_warnings',"
            "'failed','insufficient_data','no_qualifying_slips')",
            name="ck_batch_status",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    public_id: Mapped[str] = mapped_column(UUID(as_uuid=False), unique=True, nullable=False, default=lambda: str(uuid4()))
    scope_date: Mapped[date] = mapped_column(Date, nullable=False)
    league_id: Mapped[int | None] = mapped_column(ForeignKey("leagues.id"))
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    request_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    model_version_id: Mapped[int | None] = mapped_column(ForeignKey("model_versions.id"))
    warnings: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    diagnostics: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)
    time_budget_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    source_data_cutoff: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _ts()


class Prediction(Base):
    __tablename__ = "predictions"
    __table_args__ = (
        CheckConstraint("probability >= 0 AND probability <= 1", name="ck_prediction_probability"),
        Index("ix_predictions_batch", "batch_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("prediction_batches.id"), nullable=False)
    fixture_id: Mapped[int] = mapped_column(ForeignKey("fixtures.id"), nullable=False)
    market_key: Mapped[str] = mapped_column(String(64), nullable=False)
    selection: Mapped[str] = mapped_column(String(40), nullable=False)
    line: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    probability: Mapped[Decimal] = mapped_column(Numeric(12, 8), nullable=False)
    fair_odds: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    model_version_id: Mapped[int] = mapped_column(ForeignKey("model_versions.id"), nullable=False)
    feature_snapshot_id: Mapped[int] = mapped_column(ForeignKey("feature_snapshots.id"), nullable=False)
    odds_snapshot_id: Mapped[int | None] = mapped_column(ForeignKey("odds_snapshots.id"))
    data_quality: Mapped[Decimal] = mapped_column(Numeric(6, 4), nullable=False)
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False)
    implementation_status: Mapped[str] = mapped_column(String(32), nullable=False)
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    outcome: Mapped[str | None] = mapped_column(String(16))
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _ts()


class Slip(Base):
    __tablename__ = "slips"
    __table_args__ = (
        CheckConstraint(
            "joint_probability IS NULL OR (joint_probability >= 0 AND joint_probability <= 1)",
            name="ck_slip_joint_probability",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    public_id: Mapped[str] = mapped_column(UUID(as_uuid=False), unique=True, nullable=False, default=lambda: str(uuid4()))
    batch_id: Mapped[int] = mapped_column(ForeignKey("prediction_batches.id"), nullable=False)
    strategy: Mapped[str] = mapped_column(String(40), nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    combined_odds: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    selection_count: Mapped[int] = mapped_column(Integer, nullable=False)
    joint_probability: Mapped[Decimal | None] = mapped_column(Numeric(12, 8))
    joint_probability_method: Mapped[str] = mapped_column(String(48), nullable=False)
    expected_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 6))
    ev_status: Mapped[str] = mapped_column(String(24), nullable=False)
    preparation_status: Mapped[str] = mapped_column(String(32), nullable=False)
    review_status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    review_note: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    booking_code: Mapped[str | None] = mapped_column(String(64))
    booking_bookmaker: Mapped[str | None] = mapped_column(String(64))
    warnings: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    diagnostics: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = _ts()


class SlipSelection(Base):
    __tablename__ = "slip_selections"
    __table_args__ = (UniqueConstraint("slip_id", "position", name="uq_slip_position"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    slip_id: Mapped[int] = mapped_column(ForeignKey("slips.id"), nullable=False)
    prediction_id: Mapped[int] = mapped_column(ForeignKey("predictions.id"), nullable=False)
    odds_snapshot_id: Mapped[int] = mapped_column(ForeignKey("odds_snapshots.id"), nullable=False)
    decimal_odds: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = _ts()


class SlipEvaluation(Base):
    __tablename__ = "slip_evaluations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    slip_id: Mapped[int] = mapped_column(ForeignKey("slips.id"), unique=True, nullable=False)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    profit_units: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = _ts()


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    provider_id: Mapped[int | None] = mapped_column(ForeignKey("providers.id"))
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    records_written: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _ts()


class EvaluationRun(Base):
    __tablename__ = "evaluation_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    model_version_id: Mapped[int | None] = mapped_column(ForeignKey("model_versions.id"))
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    metrics: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    sample_sizes: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _ts()


class AppSetting(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
