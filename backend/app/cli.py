"""Local commands. Heavy evaluation stays here rather than on a free web request."""

import argparse
import json
from datetime import date

from app.config import assert_runtime_secrets, get_settings
from app.db import get_session_factory, reset_engine
from app.services.demo import seed_demo
from app.services.predictions import create_prediction_run
from app.services.reference import seed_reference


def main() -> None:
    parser = argparse.ArgumentParser(description="Soccer Prediction Lab local runner")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed-reference")
    sub.add_parser("seed-demo")
    predict = sub.add_parser("predict")
    predict.add_argument("--date", required=True)
    predict.add_argument("--budget", type=int, default=60)
    args = parser.parse_args()
    settings = get_settings()
    assert_runtime_secrets(settings)
    reset_engine()
    session = get_session_factory()()
    try:
        if args.command == "seed-reference":
            seed_reference(session, settings)
            session.commit()
            print("Reference data is ready.")
        elif args.command == "seed-demo":
            print(json.dumps(seed_demo(session, settings), indent=2))
        elif args.command == "predict":
            batch, _created = create_prediction_run(
                session,
                settings,
                scope_date=date.fromisoformat(args.date),
                league_id=None,
                idempotency_key=f"cli-{args.date}-{date.today().isoformat()}",
                refresh=False,
                time_budget_seconds=args.budget,
            )
            print(json.dumps({"public_id": batch.public_id, "status": batch.status, "warnings": batch.warnings}, indent=2))
    finally:
        session.close()


if __name__ == "__main__":
    main()
