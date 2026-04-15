from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class ForumCategory:
    external_id: int
    slug: str
    name: str
    position: int | None
    read_restricted: bool


@dataclass(frozen=True)
class ForumTopicListItem:
    external_id: int
    slug: str | None
    title: str
    url: str
    category_external_id: int | None
    tags: list[str]
    created_at: datetime | None
    last_posted_at: datetime | None
    bumped_at: datetime | None
    reply_count: int | None
    views: int | None
    posts_count: int | None
    closed: bool | None
    archived: bool | None
    pinned: bool | None
    excerpt: str | None


@dataclass(frozen=True)
class ForumTopicDetail:
    external_id: int
    slug: str | None
    title: str
    url: str
    author_username: str | None
    created_at: datetime | None
    last_posted_at: datetime | None
    bumped_at: datetime | None
    reply_count: int | None
    views: int | None
    posts_count: int | None
    closed: bool | None
    archived: bool | None
    pinned: bool | None
    tags: list[str]
    body_text: str
    body_hash: str
    excerpt: str | None
    raw_json: dict


class ForumCrawler(ABC):
    @abstractmethod
    async def fetch_categories(self) -> list[ForumCategory]: ...

    @abstractmethod
    async def fetch_category_latest_topics(
        self, *, category_slug: str, category_id: int, page: int
    ) -> tuple[list[ForumTopicListItem], str | None]: ...

    @abstractmethod
    async def fetch_topic_detail(self, *, topic_id: int) -> ForumTopicDetail: ...

