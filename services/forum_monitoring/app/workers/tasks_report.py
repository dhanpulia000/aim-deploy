from __future__ import annotations

import asyncio
from typing import Any, Coroutine

from app.db.session import get_sessionmaker
from app.repositories.crawl_runs import finish_run, start_run
from app.services.report_daily import DailyReportService
from app.workers.celery_app import celery_app


def run_coro(coro: Coroutine[Any, Any, Any]):
    # reuse loop created in tasks.py via celery_app on_after_fork; fallback for safety
    loop = asyncio.get_event_loop_policy().get_event_loop()
    if loop.is_closed():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


@celery_app.task(name="forum_monitoring.generate_daily_trend_report")
def generate_daily_trend_report(date_kst: str | None = None) -> dict:
    async def run() -> dict:
        SessionLocal = get_sessionmaker()
        async with SessionLocal() as session:
            crawl_run = await start_run(session, source="DISCOURSE_PLAYINZOI", run_type="report")
            svc = DailyReportService()
            report = await svc.generate(session, date_kst=date_kst)
            await finish_run(
                session,
                run=crawl_run,
                fetched_count=0,
                error_count=0,
                stats={"report_id": report.id, "date_kst": report.date_kst},
            )
            await session.commit()
            return {"report_id": report.id, "date_kst": report.date_kst}

    return run_coro(run())

