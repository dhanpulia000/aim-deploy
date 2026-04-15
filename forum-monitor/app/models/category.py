from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class Category(Base, TimestampMixin):
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("external_id", name="uq_categories_external_id"),
        UniqueConstraint("slug", name="uq_categories_slug"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    external_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    read_restricted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    topics = relationship("Topic", back_populates="category")

