from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.crawlers.discourse.client import DiscourseClient
from app.logging_setup import get_logger
from app.repositories.categories import upsert_categories


class CategorySyncService:
    def __init__(self, crawler: DiscourseClient) -> None:
        self.crawler = crawler
        self.log = get_logger(service="category_sync")

    async def run(self, session: AsyncSession) -> int:
        cats = await self.crawler.fetch_categories()
        await upsert_categories(session, cats)
        await session.commit()
        self.log.info("categories_upserted", count=len(cats))
        return len(cats)

