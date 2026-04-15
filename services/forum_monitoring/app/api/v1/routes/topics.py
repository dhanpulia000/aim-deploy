from __future__ import annotations

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.topic import Topic
from app.models.topic_snapshot import TopicSnapshot
from app.schemas.topic import TopicOut, TopicSnapshotOut

router = APIRouter()


@router.get("", response_model=list[TopicOut])
async def list_topics(
    session: AsyncSession = Depends(get_session),
    category_id: int | None = None,
    active_hours: int | None = Query(default=None, ge=1, le=168),
    limit: int = Query(default=50, ge=1, le=200),
):
    q = select(Topic)
    if category_id is not None:
        q = q.where(Topic.category_id == category_id)
    if active_hours is not None:
        since = datetime.now(timezone.utc) - timedelta(hours=active_hours)
        q = q.where(Topic.last_activity_at.is_not(None), Topic.last_activity_at >= since)
    q = q.order_by(Topic.last_activity_at.desc().nullslast(), Topic.id.desc()).limit(limit)
    rows = (await session.execute(q)).scalars().all()
    return [
        TopicOut(
            id=t.id,
            source=t.source,
            external_topic_id=t.external_topic_id,
            category_id=t.category_id,
            url=t.url,
            title=t.title,
            slug=t.slug,
            author_username=t.author_username,
            first_seen_at=t.first_seen_at,
            topic_created_at=t.topic_created_at,
            last_posted_at=t.last_posted_at,
            bumped_at=t.bumped_at,
            last_activity_at=t.last_activity_at,
            views=t.views,
            like_count=t.like_count,
            reply_count=t.reply_count,
            posts_count=t.posts_count,
            closed=t.closed,
            archived=t.archived,
            pinned=t.pinned,
            visible=t.visible,
            deleted=t.deleted,
            last_list_seen_at=t.last_list_seen_at,
            last_detail_crawled_at=t.last_detail_crawled_at,
            last_snapshot_at=t.last_snapshot_at,
        )
        for t in rows
    ]


@router.get("/{topic_id}", response_model=TopicOut)
async def get_topic(topic_id: int, session: AsyncSession = Depends(get_session)):
    t = (await session.execute(select(Topic).where(Topic.id == topic_id).limit(1))).scalars().first()
    if t is None:
        raise HTTPException(status_code=404, detail="Topic not found")
    return TopicOut(
        id=t.id,
        source=t.source,
        external_topic_id=t.external_topic_id,
        category_id=t.category_id,
        url=t.url,
        title=t.title,
        slug=t.slug,
        author_username=t.author_username,
        first_seen_at=t.first_seen_at,
        topic_created_at=t.topic_created_at,
        last_posted_at=t.last_posted_at,
        bumped_at=t.bumped_at,
        last_activity_at=t.last_activity_at,
        views=t.views,
        like_count=t.like_count,
        reply_count=t.reply_count,
        posts_count=t.posts_count,
        closed=t.closed,
        archived=t.archived,
        pinned=t.pinned,
        visible=t.visible,
        deleted=t.deleted,
        last_list_seen_at=t.last_list_seen_at,
        last_detail_crawled_at=t.last_detail_crawled_at,
        last_snapshot_at=t.last_snapshot_at,
    )


@router.get("/{topic_id}/snapshots", response_model=list[TopicSnapshotOut])
async def list_snapshots(
    topic_id: int, session: AsyncSession = Depends(get_session), limit: int = Query(default=200, ge=1, le=1000)
):
    q = (
        select(TopicSnapshot)
        .where(TopicSnapshot.topic_id == topic_id)
        .order_by(TopicSnapshot.captured_at.desc())
        .limit(limit)
    )
    snaps = (await session.execute(q)).scalars().all()
    return [
        TopicSnapshotOut(
            id=s.id,
            topic_id=s.topic_id,
            captured_at=s.captured_at,
            views=s.views,
            like_count=s.like_count,
            reply_count=s.reply_count,
            posts_count=s.posts_count,
            last_posted_at=s.last_posted_at,
            bumped_at=s.bumped_at,
            closed=s.closed,
            archived=s.archived,
            pinned=s.pinned,
            visible=s.visible,
            deleted=s.deleted,
            tags_hash=s.tags_hash,
            status_hash=s.status_hash,
        )
        for s in snaps
    ]

