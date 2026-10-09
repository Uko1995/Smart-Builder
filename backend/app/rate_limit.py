"""In-memory limits for login and prediction generation.

A single free-tier instance does not have a shared cache. The limiter is
process-local, which matches one Render web service or a local process.
A future multi-instance deployment can replace this module without changing
the route contracts.
"""

from collections import defaultdict
from time import monotonic


class RateLimiter:
    def __init__(self, clock=monotonic):
        self._clock = clock
        self._events: dict[str, list[float]] = defaultdict(list)

    def allow(self, key: str, limit: int, window_seconds: float) -> tuple[bool, float]:
        now = self._clock()
        recent = [stamp for stamp in self._events[key] if now - stamp < window_seconds]
        if len(recent) >= limit:
            retry_after = window_seconds - (now - recent[0])
            self._events[key] = recent
            return False, max(0.0, retry_after)
        recent.append(now)
        self._events[key] = recent
        return True, 0.0


limiter = RateLimiter()
