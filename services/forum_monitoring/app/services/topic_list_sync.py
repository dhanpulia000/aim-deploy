from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.crawlers.discourse.client import DiscourseClient
from app.models.category import Category
from app.repositories.categories import list_categories, upsert_categories
from app.repositories.topics import upsert_topic_from_list_item


@dataclass(frozen=True)
class TopicListSyncStats:
    categories_scanned: int
    topics_seen: int


class TopicListSyncService:
    def __init__(self, crawler: DiscourseClient) -> None:
        self.crawler = crawler
        self.settings = get_settings()
        self.log = get_logger(service="topic_list_sync")

    async def run(self, session: AsyncSession) -> TopicListSyncStats:
        # Ensure categories exist; if empty, fetch once
        cats: list[Category] = await list_categories(session)
        if not cats:
            fetched = await self.crawler.fetch_categories()
            await upsert_categories(session, source="DISCOURSE_PLAYINZOI", items=fetched)
            await session.commit()
            cats = await list_categories(session)

        category_by_external = {c.external_category_id: c for c in cats}
        topics_seen = 0
        now = datetime.now(timezone.utc)

        # Scan enabled categories; cap pages for safety
        enabled = [c for c in cats if c.enabled and not c.is_restricted]
        for c in enabled:
            pages = 0
            page = 1
            more_url = None
            while pages < self.settings.max_pages_per_category:
                pages += 1
                items, more = await self.crawler.fetch_category_latest_topics(
                    category_slug=c.slug, category_id=c.external_category_id, page=page
                )
                if not items:
                    break

                for it in items:
                    await upsert_topic_from_list_item(
                        session,
                        source="DISCOURSE_PLAYINZOI",
                        item=it,
                        category_by_external_id=category_by_external,
                    )
                    topics_seen += 1

                await session.commit()
                more_url = more
                page += 1
                if more_url is None and pages >= self.settings.max_pages_per_category:
                    break

        self.log.info("topic_list_synced", categories=len(enabled), topics_seen=topics_seen, at=str(now))
        return TopicListSyncStats(categories_scanned=len(enabled), topics_seen=topics_seen)

