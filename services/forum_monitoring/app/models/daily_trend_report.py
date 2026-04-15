from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class DailyTrendReport(Base, TimestampMixin):
    __tablename__ = "daily_trend_reports"
    __table_args__ = (UniqueConstraint("source", "date_kst", name="uq_daily_trend_reports_source_date"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="DISCOURSE_PLAYINZOI")

    date_kst: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    window_start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    category_summary: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    hot_topics: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    new_topics: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    reactivated_topics: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    tag_trends: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)

