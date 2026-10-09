#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../backend"
if [[ ! -d .venv ]]; then
  echo "Create backend/.venv and install backend/requirements-dev.txt first." >&2
  exit 1
fi
# shellcheck disable=SC1091
source .venv/bin/activate
export DATABASE_URL="${TEST_DATABASE_URL:-postgresql+psycopg://spl:spl@127.0.0.1:5432/soccer_prediction_lab_test}"
export AUTH_SECRET="${AUTH_SECRET:-test-secret-key-with-32-characters-min}"
export DASHBOARD_USERNAME="${DASHBOARD_USERNAME:-analyst}"
export DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-test-password-123}"
export ENVIRONMENT=test
export ALLOW_SYNTHETIC=true
ruff check app tests alembic
pytest
