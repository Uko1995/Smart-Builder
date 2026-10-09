"""Single-user session tokens. The password is compared from server-side settings."""

import hashlib
import hmac
from datetime import UTC, datetime, timedelta

import jwt

from app.config import Settings


def _digest(value: str) -> bytes:
    return hashlib.sha256(value.encode("utf-8")).digest()


def secrets_match(left: str, right: str) -> bool:
    return hmac.compare_digest(_digest(left), _digest(right))


def create_token(settings: Settings, username: str, now: datetime | None = None) -> str:
    issued = now or datetime.now(UTC)
    payload = {
        "sub": username,
        "iat": int(issued.timestamp()),
        "exp": int((issued + timedelta(hours=settings.session_hours)).timestamp()),
    }
    return jwt.encode(payload, settings.auth_secret, algorithm="HS256")


def decode_token(settings: Settings, token: str) -> str:
    try:
        payload = jwt.decode(token, settings.auth_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise PermissionError("invalid session") from exc
    subject = payload.get("sub")
    if not isinstance(subject, str) or not secrets_match(subject, settings.dashboard_username):
        raise PermissionError("invalid session")
    return subject
