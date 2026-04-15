from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class Topic(Base, TimestampMixin):
    __tablename__ = "topics"
    __table_args__ = (UniqueConstraint("source", "external_topic_id", name="uq_topics_source_external_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="DISCOURSE_PLAYINZOI")
    external_topic_id: Mapped[int] = mapped_column(BigInteger, nullable=False)

    category_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("categories.id"), nullable=True)
    category = relationship("Category", back_populates="topics")

    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str | None] = mapped_column(String(255), nullable=True)
    author_username: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # first time this system observed this topic in list scans
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    topic_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bumped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # latest stats cache (current state)
    views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    like_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reply_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    posts_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # latest status flags
    closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # derived convenience fields
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tags_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # crawl bookkeeping
    last_list_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_detail_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_snapshot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    snapshots = relationship("TopicSnapshot", back_populates="topic", cascade="all, delete-orphan")
    topic_tags = relationship("TopicTag", back_populates="topic", cascade="all, delete-orphan")
    posts = relationship("Post", back_populates="topic", cascade="all, delete-orphan")

