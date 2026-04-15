from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import get_logger, setup_logging


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    setup_logging(settings.log_level)
    log = get_logger(component="lifespan")
    log.info("startup", scheduler_enabled=settings.scheduler_enabled)
    yield
    log.info("shutdown")


def create_app() -> FastAPI:
    app = FastAPI(title="AIMFORPH Forum Monitoring", lifespan=lifespan)
    app.include_router(api_router, prefix="/v1")
    return app


app = create_app()

