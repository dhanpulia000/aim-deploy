from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.crawlers.discourse.client import DiscourseClient
from app.logging_setup import get_logger
from app.models.category import Category
from app.repositories.categories import list_categories
from app.repositories.categories import upsert_categories as upsert_categories_repo
from app.repositories.topics import upsert_topic_from_list_item


@dataclass(frozen=True)
class TopicListSyncStats:
    categories_scanned: int
    topics_seen: int


class TopicListSyncService:
    def __init__(self, crawler: DiscourseClient) -> None:
        self.crawler = crawler
        self.log = get_logger(service="topic_list_sync")

    async def run(self, session: AsyncSession, *, max_pages_per_category: int = 3) -> TopicListSyncStats:
        """
        MVP: 각 카테고리 latest를 최대 N페이지까지만 확인 (과도한 요청 방지).
        """
        # Ensure categories exist; if empty, fetch once
        cats: list[Category] = await list_categories(session)
        if not cats:
            fetched = await self.crawler.fetch_categories()
            cat_map = await upsert_categories_repo(session, fetched)
            await session.commit()
            cats = list(cat_map.values())

        category_by_external = {c.external_id: c for c in cats}
        topics_seen = 0
        now = datetime.now(timezone.utc)

        for c in cats:
            page = 1
            pages = 0
            more_url = None
            while pages < max_pages_per_category:
                pages += 1
                items, more = await self.crawler.fetch_category_latest_topics(
                    category_slug=c.slug, category_id=c.external_id, page=page
                )
                if not items:
                    break

                for it in items:
                    await upsert_topic_from_list_item(
                        session,
                        item=it,
                        category_by_external_id=category_by_external,
                    )
                    topics_seen += 1

                await session.commit()

                more_url = more
                if more_url is None:
                    page += 1
                else:
                    # Discourse provides more_topics_url; easiest is to use provided page param if possible.
                    # For MVP: keep incrementing page; client will still work for latest pages.
                    page += 1

        self.log.info("topic_list_synced", categories=len(cats), topics_seen=topics_seen, at=str(now))
        return TopicListSyncStats(categories_scanned=len(cats), topics_seen=topics_seen)

