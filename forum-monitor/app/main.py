from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes_categories import router as categories_router
from app.api.routes_crawl import router as crawl_router
from app.api.routes_health import router as health_router
from app.api.routes_reports import router as reports_router
from app.api.routes_reports_generate import router as reports_generate_router
from app.api.routes_topics import router as topics_router
from app.config import get_settings
from app.logging_setup import get_logger, setup_logging
from app.scheduler.jobs import SchedulerHandle, start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    setup_logging(settings.log_level)
    log = get_logger(component="lifespan")
    handle: SchedulerHandle | None = None
    try:
        if settings.scheduler_enabled:
            handle = await start_scheduler()
            log.info("scheduler_started")
        yield
    finally:
        if handle is not None:
            await stop_scheduler(handle)
            log.info("scheduler_stopped")


def create_app() -> FastAPI:
    app = FastAPI(title="PlayInZOI Forum Monitor", lifespan=lifespan)
    app.include_router(health_router)
    app.include_router(categories_router, prefix="/categories", tags=["categories"])
    app.include_router(topics_router, prefix="/topics", tags=["topics"])
    app.include_router(reports_router, prefix="/reports", tags=["reports"])
    app.include_router(reports_generate_router, prefix="/reports", tags=["reports"])
    app.include_router(crawl_router, prefix="/crawl", tags=["crawl"])
    return app


app = create_app()

