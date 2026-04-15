from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Iterable, Literal

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import get_settings
from app.crawlers.discourse.client import DiscourseClient
from app.db.session import AsyncSessionLocal
from app.logging_setup import get_logger
from app.services.category_sync import CategorySyncService
from app.services.report_daily import DailyReportService
from app.services.topic_detail_sync import TopicDetailSyncService
from app.services.topic_list_sync import TopicListSyncService


@dataclass(frozen=True)
class SchedulerHandle:
    scheduler: AsyncIOScheduler


JobType = Literal["categories", "topic_list", "topic_detail", "daily_report"]

_job_lock = asyncio.Lock()


async def _run_job(job_type: JobType, *, trigger: str) -> None:
    """
    Single-process MVP runner: DB session + Discourse client created per run.
    """
    log = get_logger(component="job_runner", job_type=job_type, trigger=trigger)
    async with _job_lock:
        crawler = DiscourseClient()
        try:
            async with AsyncSessionLocal() as session:
                if job_type == "categories":
                    await CategorySyncService(crawler).run(session)
                elif job_type == "topic_list":
                    await TopicListSyncService(crawler).run(session)
                elif job_type == "topic_detail":
                    await TopicDetailSyncService(crawler).run(session)
                elif job_type == "daily_report":
                    await DailyReportService().build_and_store(session)
                else:
                    log.warning("unknown_job_type")
        except Exception as e:
            log.error("job_failed", error=str(e))
        finally:
            await crawler.aclose()


async def trigger_jobs(job_types: Iterable[JobType]) -> list[str]:
    """
    Manual trigger: fire-and-forget tasks (still serialized by _job_lock).
    """
    queued: list[str] = []
    for jt in job_types:
        queued.append(jt)
        asyncio.create_task(_run_job(jt, trigger="manual"))
    return queued


async def start_scheduler() -> SchedulerHandle:
    settings = get_settings()
    log = get_logger(component="scheduler")
    scheduler = AsyncIOScheduler(timezone="UTC")

    log.info(
        "scheduler_config",
        category_poll_seconds=settings.category_poll_seconds,
        topic_list_poll_seconds=settings.topic_list_poll_seconds,
        hot_detail_refresh_seconds=settings.hot_detail_refresh_seconds,
        daily_report_interval_seconds=settings.daily_report_interval_seconds,
    )

    # Category / list are frequent; detail is slower; daily_report is hourly rolling window.
    scheduler.add_job(
        lambda: asyncio.create_task(_run_job("categories", trigger="scheduler")),
        "interval",
        seconds=settings.category_poll_seconds,
        id="categories_poll",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        lambda: asyncio.create_task(_run_job("topic_list", trigger="scheduler")),
        "interval",
        seconds=settings.topic_list_poll_seconds,
        id="topic_list_poll",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        lambda: asyncio.create_task(_run_job("topic_detail", trigger="scheduler")),
        "interval",
        seconds=settings.hot_detail_refresh_seconds,
        id="topic_detail_refresh",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        lambda: asyncio.create_task(_run_job("daily_report", trigger="scheduler")),
        "interval",
        seconds=settings.daily_report_interval_seconds,
        id="daily_report",
        max_instances=1,
        coalesce=True,
    )

    scheduler.start()
    return SchedulerHandle(scheduler=scheduler)


async def stop_scheduler(handle: SchedulerHandle) -> None:
    handle.scheduler.shutdown(wait=False)

