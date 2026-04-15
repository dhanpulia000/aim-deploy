from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.crawl_run import CrawlRun


async def start_run(session: AsyncSession, *, source: str, run_type: str) -> CrawlRun:
    now = datetime.now(timezone.utc)
    row = CrawlRun(source=source, run_type=run_type, started_at=now, ended_at=None)
    session.add(row)
    await session.flush()
    return row


async def finish_run(
    session: AsyncSession,
    *,
    run: CrawlRun,
    fetched_count: int,
    error_count: int,
    http_429_count: int = 0,
    stats: dict | None = None,
) -> None:
    run.ended_at = datetime.now(timezone.utc)
    run.fetched_count = int(fetched_count)
    run.error_count = int(error_count)
    run.http_429_count = int(http_429_count)
    if stats is not None:
        run.stats = stats

