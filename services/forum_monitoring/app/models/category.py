from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class Category(Base, TimestampMixin):
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("source", "external_category_id", name="uq_categories_source_external_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="DISCOURSE_PLAYINZOI")

    external_category_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_external_category_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    is_restricted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # polling policy knobs
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 0=P0,1=P1,2=P2
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    list_poll_interval_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=600)

    topics = relationship("Topic", back_populates="category")

