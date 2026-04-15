from __future__ import annotations

from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.crawlers.discourse.client import DiscourseClient
from app.logging_setup import get_logger
from app.models.topic import Topic
from app.repositories.snapshots import create_snapshot, get_latest_snapshot
from app.repositories.topics import apply_topic_detail, mark_topic_access_state
from app.services.change_detection import diff_topic


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
        """
        MVP: 최근 활동 토픽 중심으로 상세 갱신.
        """
        # pick candidates: recent last_posted_at first
        q = (
            select(Topic)
            .order_by(Topic.last_posted_at.desc().nullslast(), Topic.id.desc())
            .limit(self.settings.max_detail_fetches_per_run)
        )
        topics = (await session.execute(q)).scalars().all()

        processed = 0
        snapshots = 0
        errors = 0

        for t in topics:
            processed += 1
            try:
                detail = await self.crawler.fetch_topic_detail(topic_id=t.external_id)
                await apply_topic_detail(session, topic=t, detail=detail, access_state="ok")

                prev = await get_latest_snapshot(session, topic_id=t.id)
                diff = diff_topic(prev, t, is_new=False)
                if diff.has_changes:
                    await create_snapshot(session, topic=t, change_flags=diff.change_flags, raw_json=detail.raw_json)
                    snapshots += 1

                await session.commit()
            except httpx.HTTPStatusError as e:
                # 403/404 처리
                status = e.response.status_code if e.response is not None else None
                if status == 404:
                    await mark_topic_access_state(session, topic=t, access_state="gone")
                    prev = await get_latest_snapshot(session, topic_id=t.id)
                    diff = diff_topic(prev, t, is_new=False)
                    await create_snapshot(session, topic=t, change_flags=diff.change_flags, raw_json=None)
                    snapshots += 1
                    await session.commit()
                elif status == 403:
                    await mark_topic_access_state(session, topic=t, access_state="forbidden")
                    prev = await get_latest_snapshot(session, topic_id=t.id)
                    diff = diff_topic(prev, t, is_new=False)
                    await create_snapshot(session, topic=t, change_flags=diff.change_flags, raw_json=None)
                    snapshots += 1
                    await session.commit()
                else:
                    errors += 1
                    self.log.warning("topic_detail_http_error", topic_id=t.external_id, status=status)
                    await session.rollback()
            except Exception as e:
                errors += 1
                self.log.warning("topic_detail_error", topic_id=t.external_id, error=str(e))
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

