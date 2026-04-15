from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.crawlers.base import ForumCategory, ForumTopicDetail, ForumTopicListItem
from app.crawlers.discourse.urls import topic_url
from app.utils.hashing import sha256_hex


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    # Discourse uses ISO8601, often with Z
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


_RE_STRIP_SCRIPT = re.compile(r"<script[\s\S]*?</script>", re.IGNORECASE)
_RE_STRIP_STYLE = re.compile(r"<style[\s\S]*?</style>", re.IGNORECASE)
_RE_TAGS = re.compile(r"<[^>]+>")
_RE_WS = re.compile(r"\s+")


def strip_html(html: str) -> str:
    if not html:
        return ""
    s = _RE_STRIP_SCRIPT.sub(" ", html)
    s = _RE_STRIP_STYLE.sub(" ", s)
    s = _RE_TAGS.sub(" ", s)
    s = (
        s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    return _RE_WS.sub(" ", s).strip()


class DiscourseCategoryModel(BaseModel):
    id: int
    slug: str
    name: str
    position: int | None = None
    read_restricted: bool = False


class DiscourseCategoriesResponse(BaseModel):
    category_list: dict[str, Any]

    def categories(self) -> list[DiscourseCategoryModel]:
        cats = self.category_list.get("categories") or []
        return [DiscourseCategoryModel.model_validate(c) for c in cats]


class DiscourseTopicListItemModel(BaseModel):
    id: int
    slug: str | None = None
    title: str | None = None
    fancy_title: str | None = None
    category_id: int | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: str | None = None
    last_posted_at: str | None = None
    bumped_at: str | None = None
    reply_count: int | None = None
    views: int | None = None
    posts_count: int | None = None
    closed: bool | None = None
    archived: bool | None = None
    pinned: bool | None = None
    excerpt: str | None = None


class DiscourseTopicListResponse(BaseModel):
    topic_list: dict[str, Any]

    def topics(self) -> list[DiscourseTopicListItemModel]:
        topics = (self.topic_list.get("topics") or []) if isinstance(self.topic_list, dict) else []
        return [DiscourseTopicListItemModel.model_validate(t) for t in topics]

    def more_topics_url(self) -> str | None:
        val = self.topic_list.get("more_topics_url")
        return str(val) if val else None


class DiscoursePostModel(BaseModel):
    post_number: int | None = None
    username: str | None = None
    created_at: str | None = None
    cooked: str | None = None


class DiscourseTopicDetailResponse(BaseModel):
    id: int
    slug: str | None = None
    title: str | None = None
    fancy_title: str | None = None
    created_at: str | None = None
    last_posted_at: str | None = None
    bumped_at: str | None = None
    views: int | None = None
    like_count: int | None = None
    reply_count: int | None = None
    posts_count: int | None = None
    closed: bool | None = None
    archived: bool | None = None
    pinned: bool | None = None
    tags: list[str] = Field(default_factory=list)
    excerpt: str | None = None
    post_stream: dict[str, Any] = Field(default_factory=dict)

    def first_post(self) -> DiscoursePostModel | None:
        posts = self.post_stream.get("posts") or []
        if not isinstance(posts, list):
            return None
        parsed = [DiscoursePostModel.model_validate(p) for p in posts]
        for p in parsed:
            if p.post_number == 1:
                return p
        return parsed[0] if parsed else None


def map_category(m: DiscourseCategoryModel) -> ForumCategory:
    return ForumCategory(
        external_id=m.id,
        slug=m.slug,
        name=m.name,
        position=m.position,
        read_restricted=bool(m.read_restricted),
    )


def map_topic_list_item(base_url: str, m: DiscourseTopicListItemModel) -> ForumTopicListItem:
    title = m.fancy_title or m.title or "Untitled"
    url = topic_url(base_url, slug=m.slug, topic_id=m.id)
    excerpt = None
    if isinstance(m.excerpt, str) and m.excerpt:
        excerpt = strip_html(m.excerpt)[:400] or None

    return ForumTopicListItem(
        external_id=m.id,
        slug=m.slug,
        title=title,
        url=url,
        category_external_id=m.category_id,
        tags=list(m.tags or []),
        created_at=parse_dt(m.created_at),
        last_posted_at=parse_dt(m.last_posted_at),
        bumped_at=parse_dt(m.bumped_at),
        reply_count=m.reply_count,
        views=m.views,
        posts_count=m.posts_count,
        closed=m.closed,
        archived=m.archived,
        pinned=m.pinned,
        excerpt=excerpt,
    )


def map_topic_detail(base_url: str, raw: dict[str, Any]) -> ForumTopicDetail:
    m = DiscourseTopicDetailResponse.model_validate(raw)
    title = m.fancy_title or m.title or "Untitled"
    url = topic_url(base_url, slug=m.slug, topic_id=m.id)

    first = m.first_post()
    author = first.username if first else None
    cooked_html = first.cooked if first and first.cooked else ""
    body_text = strip_html(cooked_html)
    body_hash = sha256_hex(body_text)

    excerpt = None
    if isinstance(m.excerpt, str) and m.excerpt:
        excerpt = strip_html(m.excerpt)[:400] or None

    created_at = parse_dt(m.created_at) or parse_dt(first.created_at if first else None)

    return ForumTopicDetail(
        external_id=m.id,
        slug=m.slug,
        title=title,
        url=url,
        author_username=author,
        created_at=created_at,
        last_posted_at=parse_dt(m.last_posted_at),
        bumped_at=parse_dt(m.bumped_at),
        reply_count=m.reply_count if m.reply_count is not None else None,
        views=m.views,
        posts_count=m.posts_count,
        closed=m.closed,
        archived=m.archived,
        pinned=m.pinned,
        tags=list(m.tags or []),
        body_text=body_text,
        body_hash=body_hash,
        excerpt=excerpt,
        raw_json=raw,
    )

