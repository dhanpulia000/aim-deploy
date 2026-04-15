from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crawlers.base import ForumTopicDetail, ForumTopicListItem
from app.models.category import Category
from app.models.topic import Topic
from app.models.topic_tag import TopicTag
from app.repositories.tags import get_or_create_tags, normalize_tag


async def get_topic_by_external_id(session: AsyncSession, external_id: int) -> Topic | None:
    return (
        await session.execute(select(Topic).where(Topic.external_id == external_id).limit(1))
    ).scalars().first()


async def list_topics(session: AsyncSession, *, page: int, page_size: int) -> tuple[list[Topic], int]:
    # simple paging; total via separate count is omitted for MVP simplicity
    offset = (page - 1) * page_size
    items = (
        await session.execute(select(Topic).order_by(Topic.last_posted_at.desc().nullslast(), Topic.id).offset(offset).limit(page_size))
    ).scalars().all()
    total = (
        await session.execute(select(Topic.id))
    ).scalars().all()
    return items, len(total)


async def get_topic(session: AsyncSession, topic_id: int) -> Topic | None:
    return (await session.execute(select(Topic).where(Topic.id == topic_id).limit(1))).scalars().first()


async def upsert_topic_from_list_item(
    session: AsyncSession,
    *,
    item: ForumTopicListItem,
    category_by_external_id: dict[int, Category],
) -> Topic:
    now = datetime.now(timezone.utc)
    topic = await get_topic_by_external_id(session, item.external_id)
    cat_row = category_by_external_id.get(item.category_external_id or -1)

    if topic is None:
        topic = Topic(
            external_id=item.external_id,
            category_id=cat_row.id if cat_row else None,
            title=item.title,
            slug=item.slug,
            url=item.url,
            author_username=None,
            created_at=item.created_at,
            last_posted_at=item.last_posted_at,
            bumped_at=item.bumped_at,
            reply_count=item.reply_count,
            views=item.views,
            posts_count=item.posts_count,
            closed=bool(item.closed) if item.closed is not None else False,
            archived=bool(item.archived) if item.archived is not None else False,
            pinned=bool(item.pinned) if item.pinned is not None else False,
            excerpt=item.excerpt,
            access_state="ok",
            last_list_seen_at=now,
            last_detail_crawl_at=None,
            created_at_db=now,
            updated_at_db=now,
        )
        session.add(topic)
    else:
        if cat_row:
            topic.category_id = cat_row.id
        topic.title = item.title or topic.title
        topic.slug = item.slug or topic.slug
        topic.url = item.url or topic.url
        topic.created_at = item.created_at or topic.created_at
        topic.last_posted_at = item.last_posted_at or topic.last_posted_at
        topic.bumped_at = item.bumped_at or topic.bumped_at
        if item.reply_count is not None:
            topic.reply_count = item.reply_count
        if item.views is not None:
            topic.views = item.views
        if item.posts_count is not None:
            topic.posts_count = item.posts_count
        if item.closed is not None:
            topic.closed = bool(item.closed)
        if item.archived is not None:
            topic.archived = bool(item.archived)
        if item.pinned is not None:
            topic.pinned = bool(item.pinned)
        if item.excerpt is not None:
            topic.excerpt = item.excerpt
        topic.last_list_seen_at = now
        topic.updated_at_db = now

    # tags
    await _sync_topic_tags(session, topic=topic, tag_names=item.tags)
    return topic


async def apply_topic_detail(
    session: AsyncSession,
    *,
    topic: Topic,
    detail: ForumTopicDetail,
    access_state: str = "ok",
) -> Topic:
    now = datetime.now(timezone.utc)
    topic.title = detail.title
    topic.slug = detail.slug
    topic.url = detail.url
    topic.author_username = detail.author_username
    topic.created_at = detail.created_at
    topic.last_posted_at = detail.last_posted_at
    topic.bumped_at = detail.bumped_at
    topic.reply_count = detail.reply_count
    topic.views = detail.views
    topic.posts_count = detail.posts_count
    if detail.closed is not None:
        topic.closed = bool(detail.closed)
    if detail.archived is not None:
        topic.archived = bool(detail.archived)
    if detail.pinned is not None:
        topic.pinned = bool(detail.pinned)
    topic.body_hash = detail.body_hash
    topic.excerpt = detail.excerpt
    topic.access_state = access_state
    topic.last_detail_crawl_at = now
    topic.updated_at_db = now
    await _sync_topic_tags(session, topic=topic, tag_names=detail.tags)
    return topic


async def mark_topic_access_state(session: AsyncSession, *, topic: Topic, access_state: str) -> None:
    now = datetime.now(timezone.utc)
    topic.access_state = access_state
    topic.last_detail_crawl_at = now
    topic.updated_at_db = now


async def _sync_topic_tags(session: AsyncSession, *, topic: Topic, tag_names: list[str]) -> None:
    tag_map = await get_or_create_tags(session, tag_names)
    desired = {normalize_tag(n) for n in tag_names if n and n.strip()}
    desired_ids = {tag_map[n].id for n in desired if n in tag_map}

    existing = {tt.tag_id for tt in (topic.tags or [])}
    to_add = desired_ids - existing
    to_remove = existing - desired_ids

    if to_remove:
        topic.tags = [tt for tt in topic.tags if tt.tag_id not in to_remove]

    for tag_id in to_add:
        topic.tags.append(TopicTag(topic_id=topic.id, tag_id=tag_id))

