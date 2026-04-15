from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, JSON, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class CrawlLog(Base):
    __tablename__ = "crawl_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    crawl_job_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("crawl_jobs.id", ondelete="CASCADE"), nullable=False
    )
    job = relationship("CrawlJob", back_populates="logs")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[dict] = mapped_column(JSON, nullable=False, server_default=text("'{}'::json"))

