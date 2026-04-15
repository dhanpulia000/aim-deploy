from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://forum:forum@localhost:55432/forum_monitoring"
    redis_url: str = "redis://localhost:56379/0"

    discourse_base_url: str = "https://forum.playinzoi.com"
    discourse_user_agent: str = "AIMFORPH-ForumMonitor/1.0"
    request_delay_ms: int = 600
    http_timeout_sec: int = 20
    max_pages_per_category: int = 3
    max_topic_fetches_per_run: int = 40
    max_detail_fetches_per_run: int = 40
    snapshot_bucket_minutes: int = 5

    scheduler_enabled: bool = True
    log_level: str = "INFO"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

