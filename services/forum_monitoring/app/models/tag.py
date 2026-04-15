from __future__ import annotations

from typing import Literal

from sqlalchemy import BigInteger, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


TagType = Literal["DOMAIN", "STATUS"]


class Tag(Base, TimestampMixin):
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("source", "name", name="uq_tags_source_name"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="DISCOURSE_PLAYINZOI")

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tag_type: Mapped[str] = mapped_column(String(16), nullable=False, default="DOMAIN")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    topic_tags = relationship("TopicTag", back_populates="tag", cascade="all, delete-orphan")

