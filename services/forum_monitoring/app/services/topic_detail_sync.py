from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.crawlers.discourse.client import DiscourseClient
from app.models.topic import Topic
from app.repositories.posts import upsert_post_from_discourse
from app.repositories.snapshots import create_snapshot
from app.repositories.topics import apply_topic_detail


@dataclass(frozen=True)
class TopicDetailSyncStats:
    topics_processed: int
    snapshots_created: int
    errors: int


class TopicDetailSyncService:
    def __init__(self, crawler: DiscourseClient) -> None:
        self.crawler = crawler
        self.settings = get_settings()
        self.log = get_logger(service="topic_detail_sync")

    async def run(self, session: AsyncSession) -> TopicDetailSyncStats:
        # Candidate selection: recently active topics first (last_activity_at)
        q = (
            select(Topic)
            .order_by(Topic.last_activity_at.desc().nullslast(), Topic.id.desc())
            .limit(self.settings.max_detail_fetches_per_run)
        )
        topics = (await session.execute(q)).scalars().all()

        processed = 0
        snapshots = 0
        errors = 0

        for t in topics:
            processed += 1
            try:
                detail = await self.crawler.fetch_topic_detail(topic_id=t.external_topic_id)
                await apply_topic_detail(session, source="DISCOURSE_PLAYINZOI", topic=t, detail=detail)

                # Upsert first post (MVP), plus keep hook for comments later
                first = detail.posts[0] if detail.posts else None
                if first is not None:
                    await upsert_post_from_discourse(session, source="DISCOURSE_PLAYINZOI", topic=t, p=first)

                await create_snapshot(
                    session,
                    topic=t,
                    captured_at=datetime.now(timezone.utc),
                    bucket_minutes=self.settings.snapshot_bucket_minutes,
                )
                snapshots += 1
                await session.commit()
            except httpx.HTTPStatusError as e:
                errors += 1
                status = e.response.status_code if e.response is not None else None
                self.log.warning("topic_detail_http_error", topic_external_id=t.external_topic_id, status=status)
                await session.rollback()
            except Exception as e:
                errors += 1
                self.log.warning("topic_detail_error", topic_external_id=t.external_topic_id, error=str(e))
                await session.rollback()

        self.log.info(
            "topic_detail_synced",
            topics_processed=processed,
            snapshots_created=snapshots,
            errors=errors,
        )
        return TopicDetailSyncStats(
            topics_processed=processed, snapshots_created=snapshots, errors=errors
        )

