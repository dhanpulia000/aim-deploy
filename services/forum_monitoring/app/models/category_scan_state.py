from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class CategoryScanState(Base, TimestampMixin):
    __tablename__ = "category_scan_states"
    __table_args__ = (
        UniqueConstraint("source", "category_id", name="uq_category_scan_states_source_category"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="DISCOURSE_PLAYINZOI")

    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("categories.id", ondelete="CASCADE"))

    # watermark state for list pages
    last_seen_bumped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_topic_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_page: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    state_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

