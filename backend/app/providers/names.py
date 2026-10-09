"""Team-name matching across providers. This is a match key, not a new identity."""

import re

_TOKENS = {"fc", "afc", "cf", "sc", "club", "the"}


def normalize_team_name(name: str) -> str:
    cleaned = re.sub(r"[^a-z0-9 ]", " ", name.lower())
    parts = [part for part in cleaned.split() if part not in _TOKENS]
    return " ".join(parts) or cleaned.strip()
