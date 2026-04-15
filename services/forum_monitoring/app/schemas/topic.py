from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TopicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    external_topic_id: int
    category_id: int | None
    url: str
    title: str
    slug: str | None
    author_username: str | None
    first_seen_at: datetime | None
    topic_created_at: datetime | None
    last_posted_at: datetime | None
    bumped_at: datetime | None
    last_activity_at: datetime | None
    views: int | None
    like_count: int | None
    reply_count: int | None
    posts_count: int | None
    closed: bool
    archived: bool
    pinned: bool
    visible: bool
    deleted: bool
    last_list_seen_at: datetime | None
    last_detail_crawled_at: datetime | None
    last_snapshot_at: datetime | None


class TopicSnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    topic_id: int
    captured_at: datetime
    views: int | None
    like_count: int | None
    reply_count: int | None
    posts_count: int | None
    last_posted_at: datetime | None
    bumped_at: datetime | None
    closed: bool
    archived: bool
    pinned: bool
    visible: bool
    deleted: bool
    tags_hash: str | None
    status_hash: str | None

