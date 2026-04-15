from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class CrawlRun(Base, TimestampMixin):
    __tablename__ = "crawl_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="DISCOURSE_PLAYINZOI")
    run_type: Mapped[str] = mapped_column(String(64), nullable=False)  # topic_list|topic_detail|report

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    fetched_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    http_429_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    stats: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

