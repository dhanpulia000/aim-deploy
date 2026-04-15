from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AnyUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["local", "dev", "prod"] = Field(default="local", alias="APP_ENV")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    scheduler_enabled: bool = Field(default=True, alias="SCHEDULER_ENABLED")

    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/forum_monitor",
        alias="DATABASE_URL",
    )

    discourse_base_url: AnyUrl = Field(
        default="https://forum.playinzoi.com",
        alias="DISCOURSE_BASE_URL",
    )
    discourse_user_agent: str = Field(
        default="PlayInZOIForumMonitor/0.1 (+contact:admin@example.com; respectful crawl)",
        alias="DISCOURSE_USER_AGENT",
    )
    http_timeout_seconds: float = Field(default=20.0, alias="HTTP_TIMEOUT_SECONDS")
    request_delay_ms: int = Field(default=600, alias="REQUEST_DELAY_MS")
    max_detail_fetches_per_run: int = Field(default=60, alias="MAX_DETAIL_FETCHES_PER_RUN")

    category_poll_seconds: int = Field(default=600, alias="CATEGORY_POLL_SECONDS")
    topic_list_poll_seconds: int = Field(default=600, alias="TOPIC_LIST_POLL_SECONDS")
    hot_detail_refresh_seconds: int = Field(default=1200, alias="HOT_DETAIL_REFRESH_SECONDS")
    daily_report_interval_seconds: int = Field(default=3600, alias="DAILY_REPORT_INTERVAL_SECONDS")

    api_page_size_default: int = Field(default=50, alias="API_PAGE_SIZE_DEFAULT")
    api_page_size_max: int = Field(default=200, alias="API_PAGE_SIZE_MAX")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

