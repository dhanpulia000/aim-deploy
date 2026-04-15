from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, JSON, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DailyTrendReport(Base):
    __tablename__ = "daily_trend_reports"
    __table_args__ = (UniqueConstraint("report_date", name="uq_daily_trend_reports_report_date"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    report_date: Mapped[date] = mapped_column(Date, nullable=False)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

