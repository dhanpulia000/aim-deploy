from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class TimeWindow:
    start: datetime
    end: datetime


def rolling_24h(now: datetime | None = None) -> TimeWindow:
    n = now or datetime.now(timezone.utc)
    return TimeWindow(start=n - timedelta(hours=24), end=n)

