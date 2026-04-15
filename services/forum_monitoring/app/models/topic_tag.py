from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class TopicTag(Base, TimestampMixin):
    __tablename__ = "topic_tags"
    __table_args__ = (UniqueConstraint("topic_id", "tag_id", name="uq_topic_tags_topic_tag"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    topic_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("topics.id", ondelete="CASCADE"))
    tag_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tags.id", ondelete="CASCADE"))

    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    topic = relationship("Topic", back_populates="topic_tags")
    tag = relationship("Tag", back_populates="topic_tags")

