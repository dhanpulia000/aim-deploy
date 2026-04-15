from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.topic import Topic
from app.models.topic_snapshot import TopicSnapshot


async def get_latest_snapshot(session: AsyncSession, *, topic_id: int) -> TopicSnapshot | None:
    return (
        await session.execute(
            select(TopicSnapshot)
            .where(TopicSnapshot.topic_id == topic_id)
            .order_by(TopicSnapshot.captured_at.desc(), TopicSnapshot.id.desc())
            .limit(1)
        )
    ).scalars().first()


async def create_snapshot(
    session: AsyncSession,
    *,
    topic: Topic,
    change_flags: dict,
    raw_json: dict | None,
) -> TopicSnapshot:
    snap = TopicSnapshot(
        topic_id=topic.id,
        title=topic.title,
        slug=topic.slug,
        url=topic.url,
        author_username=topic.author_username,
        created_at=topic.created_at,
        last_posted_at=topic.last_posted_at,
        bumped_at=topic.bumped_at,
        reply_count=topic.reply_count,
        views=topic.views,
        posts_count=topic.posts_count,
        closed=topic.closed,
        archived=topic.archived,
        pinned=topic.pinned,
        body_hash=topic.body_hash,
        excerpt=topic.excerpt,
        access_state=topic.access_state,
        change_flags=change_flags,
        raw_json=raw_json,
    )
    session.add(snap)
    return snap

