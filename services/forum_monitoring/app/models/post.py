from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class Post(Base, TimestampMixin):
    __tablename__ = "posts"
    __table_args__ = (UniqueConstraint("source", "external_post_id", name="uq_posts_source_external_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="DISCOURSE_PLAYINZOI")
    external_post_id: Mapped[int] = mapped_column(BigInteger, nullable=False)

    topic_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("topics.id", ondelete="CASCADE"))
    topic = relationship("Topic", back_populates="posts")

    post_number: Mapped[int] = mapped_column(Integer, nullable=False)
    author_username: Mapped[str | None] = mapped_column(String(255), nullable=True)

    post_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    post_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    edit_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    cooked_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    cooked_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    normalized_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    normalize_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    has_images: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_links: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_code_block: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

