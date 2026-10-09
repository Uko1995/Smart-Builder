"""Timeouts, bounded retries and backoff for documented provider APIs."""

import time
from dataclasses import dataclass
from typing import Callable

import httpx

from app.logging_config import redact


class ProviderRequestError(Exception):
    def __init__(self, message: str, status_code: int | None = None, retryable: bool = False):
        super().__init__(redact(message))
        self.status_code = status_code
        self.retryable = retryable


@dataclass
class HttpResponse:
    status_code: int
    payload: object
    headers: dict[str, str]
    url: str


class ProviderHttpClient:
    def __init__(
        self,
        timeout: float = 15.0,
        max_retries: int = 3,
        backoff_seconds: float = 0.4,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] | None = None,
    ):
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds
        self._sleep = sleep or time.sleep
        self._client = httpx.Client(timeout=timeout, transport=transport)

    def close(self) -> None:
        self._client.close()

    def get(self, url: str, headers: dict | None = None, params: dict | None = None) -> HttpResponse:
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                response = self._client.get(url, headers=headers, params=params)
            except httpx.TimeoutException as exc:
                last_error = ProviderRequestError(f"timeout contacting provider: {exc}", retryable=True)
                self._pause(attempt, None)
                continue
            except httpx.TransportError as exc:
                last_error = ProviderRequestError(f"provider connection failed: {exc}", retryable=True)
                self._pause(attempt, None)
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt >= self.max_retries:
                    return self._pack(response)
                self._pause(attempt, response.headers.get("Retry-After"))
                continue
            return self._pack(response)
        assert last_error is not None
        raise last_error

    def _pause(self, attempt: int, retry_after: str | None) -> None:
        if attempt >= self.max_retries:
            return
        delay = self.backoff_seconds * (2**attempt)
        if retry_after:
            try:
                delay = max(delay, float(retry_after))
            except ValueError:
                pass
        self._sleep(min(delay, 30))

    def _pack(self, response: httpx.Response) -> HttpResponse:
        try:
            payload = response.json()
        except ValueError:
            payload = {"raw": response.text[:500]}
        return HttpResponse(
            status_code=response.status_code,
            payload=payload,
            headers={key.lower(): value for key, value in response.headers.items()},
            url=redact(str(response.request.url)),
        )
