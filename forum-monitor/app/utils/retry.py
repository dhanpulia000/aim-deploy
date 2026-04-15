from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 6
    base_delay_seconds: float = 1.0
    max_delay_seconds: float = 60.0
    jitter_seconds: float = 0.25


class RetryableHttpError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


async def with_retry(
    fn: Callable[[], Awaitable[object]],
    *,
    policy: RetryPolicy | None = None,
    retry_on_status: set[int] | None = None,
) -> object:
    p = policy or RetryPolicy()
    retry_status = retry_on_status or {429, 500, 502, 503, 504}

    attempt = 0
    while True:
        attempt += 1
        try:
            return await fn()
        except RetryableHttpError as e:
            if e.status_code not in retry_status or attempt >= p.max_attempts:
                raise
        except (TimeoutError, OSError):
            if attempt >= p.max_attempts:
                raise

        backoff = min(p.max_delay_seconds, p.base_delay_seconds * (2 ** (attempt - 1)))
        jitter = random.random() * p.jitter_seconds
        await asyncio.sleep(backoff + jitter)

