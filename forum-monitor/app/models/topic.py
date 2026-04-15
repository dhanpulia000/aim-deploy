from __future__ import annotations

from datetime import datetime
from typing import Literal

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


AccessState = Literal["ok", "gone", "forbidden"]


class Topic(Base):
    __tablename__ = "topics"
    __table_args__ = (UniqueConstraint("external_id", name="uq_topics_external_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    external_id: Mapped[int] = mapped_column(BigInteger, nullable=False)

    category_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("categories.id"), nullable=True)
    category = relationship("Category", back_populates="topics")

    title: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str | None] = mapped_column(String(255), nullable=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    author_username: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bumped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    reply_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    posts_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    body_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_state: Mapped[str] = mapped_column(String(32), nullable=False, default="ok")

    last_list_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_detail_crawl_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # separate DB timestamps to avoid naming collision with discourse created_at
    created_at_db: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at_db: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    snapshots = relationship("TopicSnapshot", back_populates="topic", cascade="all, delete-orphan")
    tags = relationship("TopicTag", back_populates="topic", cascade="all, delete-orphan")

