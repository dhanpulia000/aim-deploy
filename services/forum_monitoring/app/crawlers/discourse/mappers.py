from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.crawlers.discourse.urls import topic_url
from app.utils.hashing import sha256_hex
from app.utils.text_normalize import strip_html


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


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
    # Some Discourse instances return tags as list[str], others as list[{"id","name","slug"}]
    tags: list[Any] = Field(default_factory=list)
    created_at: str | None = None
    last_posted_at: str | None = None
    bumped_at: str | None = None
    reply_count: int | None = None
    views: int | None = None
    like_count: int | None = None
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
    id: int | None = None
    post_number: int | None = None
    username: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    edit_count: int | None = None
    last_edited_at: str | None = None
    cooked: str | None = None
    raw: str | None = None


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
    # Discourse can return tags as list[str] or list[dict] depending on endpoint/settings.
    tags: list[Any] = Field(default_factory=list)
    excerpt: str | None = None
    category_id: int | None = None
    visible: bool | None = None
    deleted_by_id: int | None = None
    post_stream: dict[str, Any] = Field(default_factory=dict)

    def posts(self) -> list[DiscoursePostModel]:
        posts = self.post_stream.get("posts") or []
        if not isinstance(posts, list):
            return []
        return [DiscoursePostModel.model_validate(p) for p in posts]

    def first_post(self) -> DiscoursePostModel | None:
        parsed = self.posts()
        for p in parsed:
            if p.post_number == 1:
                return p
        return parsed[0] if parsed else None


class ForumCategoryDTO(BaseModel):
    external_id: int
    slug: str
    name: str
    position: int | None = None
    read_restricted: bool = False


class ForumTopicListItemDTO(BaseModel):
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
    like_count: int | None
    posts_count: int | None
    closed: bool | None
    archived: bool | None
    pinned: bool | None
    excerpt: str | None


class ForumTopicDetailDTO(BaseModel):
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
    like_count: int | None
    posts_count: int | None
    closed: bool | None
    archived: bool | None
    pinned: bool | None
    visible: bool | None
    deleted: bool
    tags: list[str]
    excerpt: str | None
    body_text: str
    body_hash: str
    raw_json: dict[str, Any]
    posts: list[DiscoursePostModel]


def map_category(m: DiscourseCategoryModel) -> ForumCategoryDTO:
    return ForumCategoryDTO(
        external_id=m.id,
        slug=m.slug,
        name=m.name,
        position=m.position,
        read_restricted=bool(m.read_restricted),
    )


def map_topic_list_item(base_url: str, m: DiscourseTopicListItemModel) -> ForumTopicListItemDTO:
    title = m.fancy_title or m.title or "Untitled"
    url = topic_url(base_url=base_url, slug=m.slug, topic_id=m.id)
    excerpt = None
    if isinstance(m.excerpt, str) and m.excerpt:
        excerpt = strip_html(m.excerpt)[:400] or None
    return ForumTopicListItemDTO(
        external_id=m.id,
        slug=m.slug,
        title=title,
        url=url,
        category_external_id=m.category_id,
        tags=_normalize_tags(m.tags),
        created_at=parse_dt(m.created_at),
        last_posted_at=parse_dt(m.last_posted_at),
        bumped_at=parse_dt(m.bumped_at),
        reply_count=m.reply_count,
        views=m.views,
        like_count=m.like_count,
        posts_count=m.posts_count,
        closed=m.closed,
        archived=m.archived,
        pinned=m.pinned,
        excerpt=excerpt,
    )


def map_topic_detail(base_url: str, raw: dict[str, Any]) -> ForumTopicDetailDTO:
    m = DiscourseTopicDetailResponse.model_validate(raw)
    title = m.fancy_title or m.title or "Untitled"
    url = topic_url(base_url=base_url, slug=m.slug, topic_id=m.id)

    first = m.first_post()
    author = first.username if first else None
    cooked_html = first.cooked if first and first.cooked else ""
    body_text = strip_html(cooked_html)
    body_hash = sha256_hex(body_text)

    excerpt = None
    if isinstance(m.excerpt, str) and m.excerpt:
        excerpt = strip_html(m.excerpt)[:400] or None

    created_at = parse_dt(m.created_at) or parse_dt(first.created_at if first else None)
    deleted = bool(m.deleted_by_id)

    return ForumTopicDetailDTO(
        external_id=m.id,
        slug=m.slug,
        title=title,
        url=url,
        author_username=author,
        created_at=created_at,
        last_posted_at=parse_dt(m.last_posted_at),
        bumped_at=parse_dt(m.bumped_at),
        reply_count=m.reply_count,
        views=m.views,
        like_count=m.like_count,
        posts_count=m.posts_count,
        closed=m.closed,
        archived=m.archived,
        pinned=m.pinned,
        visible=m.visible,
        deleted=deleted,
        tags=_normalize_tags(m.tags),
        excerpt=excerpt,
        body_text=body_text,
        body_hash=body_hash,
        raw_json=raw,
        posts=m.posts(),
    )


def _normalize_tags(tags: list[Any]) -> list[str]:
    out: list[str] = []
    for t in tags or []:
        if isinstance(t, str):
            s = t.strip()
            if s:
                out.append(s)
            continue
        if isinstance(t, dict):
            slug = t.get("slug") or t.get("name")
            if isinstance(slug, str) and slug.strip():
                out.append(slug.strip())
            continue
    # unique preserve order
    return list(dict.fromkeys(out))

