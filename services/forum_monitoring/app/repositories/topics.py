from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crawlers.discourse.mappers import ForumTopicDetailDTO, ForumTopicListItemDTO
from app.models.category import Category
from app.models.topic import Topic
from app.models.topic_tag import TopicTag
from app.repositories.tags import get_or_create_tags, normalize_tag
from app.utils.hashing import sha256_hex


def compute_tags_hash(tag_names: list[str]) -> str:
    normalized = sorted({normalize_tag(t) for t in tag_names if t and t.strip()})
    return sha256_hex(",".join(normalized))


def compute_status_hash(*, closed: bool, archived: bool, pinned: bool, visible: bool, deleted: bool) -> str:
    key = f"c={int(closed)};a={int(archived)};p={int(pinned)};v={int(visible)};d={int(deleted)}"
    return sha256_hex(key)


def compute_last_activity_at(*, last_posted_at: datetime | None, bumped_at: datetime | None) -> datetime | None:
    if last_posted_at and bumped_at:
        return max(last_posted_at, bumped_at)
    return last_posted_at or bumped_at


async def get_topic_by_external_id(
    session: AsyncSession, *, source: str, external_topic_id: int
) -> Topic | None:
    q = (
        select(Topic)
        .where(Topic.source == source, Topic.external_topic_id == external_topic_id)
        .limit(1)
    )
    return (await session.execute(q)).scalars().first()


async def upsert_topic_from_list_item(
    session: AsyncSession,
    *,
    source: str,
    item: ForumTopicListItemDTO,
    category_by_external_id: dict[int, Category],
) -> Topic:
    now = datetime.now(timezone.utc)
    topic = await get_topic_by_external_id(session, source=source, external_topic_id=item.external_id)
    cat_row = category_by_external_id.get(item.category_external_id or -1)

    if topic is None:
        topic = Topic(
            source=source,
            external_topic_id=item.external_id,
            category_id=cat_row.id if cat_row else None,
            url=item.url,
            title=item.title,
            slug=item.slug,
            author_username=None,
            first_seen_at=now,
            topic_created_at=item.created_at,
            last_posted_at=item.last_posted_at,
            bumped_at=item.bumped_at,
            views=item.views,
            like_count=item.like_count,
            reply_count=item.reply_count,
            posts_count=item.posts_count,
            closed=bool(item.closed) if item.closed is not None else False,
            archived=bool(item.archived) if item.archived is not None else False,
            pinned=bool(item.pinned) if item.pinned is not None else False,
            visible=True,
            deleted=False,
            last_activity_at=compute_last_activity_at(
                last_posted_at=item.last_posted_at, bumped_at=item.bumped_at
            ),
            tags_hash=compute_tags_hash(item.tags),
            status_hash=compute_status_hash(
                closed=bool(item.closed) if item.closed is not None else False,
                archived=bool(item.archived) if item.archived is not None else False,
                pinned=bool(item.pinned) if item.pinned is not None else False,
                visible=True,
                deleted=False,
            ),
            last_list_seen_at=now,
        )
        session.add(topic)
    else:
        if cat_row:
            topic.category_id = cat_row.id
        topic.url = item.url or topic.url
        topic.title = item.title or topic.title
        topic.slug = item.slug or topic.slug
        topic.topic_created_at = item.created_at or topic.topic_created_at
        topic.last_posted_at = item.last_posted_at or topic.last_posted_at
        topic.bumped_at = item.bumped_at or topic.bumped_at
        if item.views is not None:
            topic.views = item.views
        if item.like_count is not None:
            topic.like_count = item.like_count
        if item.reply_count is not None:
            topic.reply_count = item.reply_count
        if item.posts_count is not None:
            topic.posts_count = item.posts_count
        if item.closed is not None:
            topic.closed = bool(item.closed)
        if item.archived is not None:
            topic.archived = bool(item.archived)
        if item.pinned is not None:
            topic.pinned = bool(item.pinned)
        topic.last_activity_at = compute_last_activity_at(
            last_posted_at=topic.last_posted_at, bumped_at=topic.bumped_at
        )
        topic.tags_hash = compute_tags_hash(item.tags)
        topic.status_hash = compute_status_hash(
            closed=topic.closed,
            archived=topic.archived,
            pinned=topic.pinned,
            visible=topic.visible,
            deleted=topic.deleted,
        )
        topic.last_list_seen_at = now
        if topic.first_seen_at is None:
            topic.first_seen_at = now

    await sync_topic_tags(session, topic=topic, source=source, tag_names=item.tags, seen_at=now)
    return topic


async def apply_topic_detail(
    session: AsyncSession,
    *,
    source: str,
    topic: Topic,
    detail: ForumTopicDetailDTO,
) -> Topic:
    now = datetime.now(timezone.utc)
    topic.url = detail.url
    topic.title = detail.title
    topic.slug = detail.slug
    topic.author_username = detail.author_username
    topic.topic_created_at = detail.created_at
    topic.last_posted_at = detail.last_posted_at
    topic.bumped_at = detail.bumped_at
    topic.views = detail.views
    topic.like_count = detail.like_count
    topic.reply_count = detail.reply_count
    topic.posts_count = detail.posts_count
    if detail.closed is not None:
        topic.closed = bool(detail.closed)
    if detail.archived is not None:
        topic.archived = bool(detail.archived)
    if detail.pinned is not None:
        topic.pinned = bool(detail.pinned)
    if detail.visible is not None:
        topic.visible = bool(detail.visible)
    topic.deleted = bool(detail.deleted)

    topic.last_activity_at = compute_last_activity_at(
        last_posted_at=topic.last_posted_at, bumped_at=topic.bumped_at
    )
    topic.tags_hash = compute_tags_hash(detail.tags)
    topic.status_hash = compute_status_hash(
        closed=topic.closed,
        archived=topic.archived,
        pinned=topic.pinned,
        visible=topic.visible,
        deleted=topic.deleted,
    )

    topic.last_detail_crawled_at = now
    await sync_topic_tags(session, topic=topic, source=source, tag_names=detail.tags, seen_at=now)
    return topic


async def sync_topic_tags(
    session: AsyncSession,
    *,
    topic: Topic,
    source: str,
    tag_names: list[str],
    seen_at: datetime,
) -> None:
    tag_map = await get_or_create_tags(session, source=source, names=tag_names)
    # Ensure newly-created Tag rows have primary keys before we create TopicTag rows.
    # Without this flush, Tag.id can still be None, leading to NOT NULL violations.
    if tag_map:
        await session.flush()
    desired = {normalize_tag(n) for n in tag_names if n and n.strip()}
    desired_ids = {tag_map[n].id for n in desired if n in tag_map}

    # IMPORTANT: In async SQLAlchemy, lazy-loading relationship attributes can raise MissingGreenlet.
    # Fetch existing rows explicitly.
    existing_rows = (
        await session.execute(select(TopicTag).where(TopicTag.topic_id == topic.id))
    ).scalars().all()
    existing_ids = {tt.tag_id for tt in existing_rows}
    to_add = desired_ids - existing_ids
    to_remove = existing_ids - desired_ids

    if to_remove:
        # mark inactive rather than delete for optional analysis
        for tt in existing_rows:
            if tt.tag_id in to_remove:
                tt.is_active = False
                tt.last_seen_at = seen_at

    for tag_id in to_add:
        session.add(
            TopicTag(
                topic_id=topic.id,
                tag_id=tag_id,
                first_seen_at=seen_at,
                last_seen_at=seen_at,
                is_active=True,
            )
        )

    # update active tags last_seen_at
    for tt in existing_rows:
        if tt.tag_id in desired_ids:
            tt.is_active = True
            tt.last_seen_at = seen_at

