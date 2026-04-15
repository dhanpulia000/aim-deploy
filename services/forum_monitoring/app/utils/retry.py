from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass
from typing import Awaitable, Callable, Iterable, TypeVar


T = TypeVar("T")


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 6
    base_delay_seconds: float = 1.0
    max_delay_seconds: float = 60.0
    jitter_ratio: float = 0.2


class RetryableHttpError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


async def with_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    policy: RetryPolicy = RetryPolicy(),
    retry_on_status: Iterable[int] = (429, 500, 502, 503, 504),
) -> T:
    attempt = 0
    last_exc: Exception | None = None
    retry_set = set(retry_on_status)
    while attempt < policy.max_attempts:
        attempt += 1
        try:
            return await fn()
        except RetryableHttpError as e:
            last_exc = e
            if e.status_code not in retry_set or attempt >= policy.max_attempts:
                raise
        except Exception as e:
            last_exc = e
            if attempt >= policy.max_attempts:
                raise

        base = min(policy.max_delay_seconds, policy.base_delay_seconds * (2 ** (attempt - 1)))
        jitter = base * policy.jitter_ratio * random.random()
        await asyncio.sleep(base + jitter)

    assert last_exc is not None
    raise last_exc

