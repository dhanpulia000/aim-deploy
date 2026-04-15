from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.topic import Topic
from app.models.topic_snapshot import TopicSnapshot


def bucket_time(dt: datetime, *, bucket_minutes: int = 5) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    epoch = int(dt.timestamp())
    bucket = bucket_minutes * 60
    floored = epoch - (epoch % bucket)
    return datetime.fromtimestamp(floored, tz=timezone.utc)


async def get_latest_snapshot(session: AsyncSession, *, topic_id: int) -> TopicSnapshot | None:
    q = (
        select(TopicSnapshot)
        .where(TopicSnapshot.topic_id == topic_id)
        .order_by(TopicSnapshot.captured_at.desc())
        .limit(1)
    )
    return (await session.execute(q)).scalars().first()


async def create_snapshot(
    session: AsyncSession,
    *,
    topic: Topic,
    captured_at: datetime | None = None,
    bucket_minutes: int = 5,
) -> TopicSnapshot:
    now = captured_at or datetime.now(timezone.utc)
    bucket_at = bucket_time(now, bucket_minutes=bucket_minutes)

    # idempotency: one snapshot per topic per bucket
    existing = (
        await session.execute(
            select(TopicSnapshot)
            .where(TopicSnapshot.topic_id == topic.id, TopicSnapshot.captured_bucket_at == bucket_at)
            .limit(1)
        )
    ).scalars().first()
    if existing is not None:
        return existing

    snap = TopicSnapshot(
        topic_id=topic.id,
        captured_at=now,
        captured_bucket_at=bucket_at,
        category_id=topic.category_id,
        views=topic.views,
        like_count=topic.like_count,
        reply_count=topic.reply_count,
        posts_count=topic.posts_count,
        last_posted_at=topic.last_posted_at,
        bumped_at=topic.bumped_at,
        closed=topic.closed,
        archived=topic.archived,
        pinned=topic.pinned,
        visible=topic.visible,
        deleted=topic.deleted,
        tags_hash=topic.tags_hash,
        status_hash=topic.status_hash,
    )
    session.add(snap)
    topic.last_snapshot_at = now
    return snap

