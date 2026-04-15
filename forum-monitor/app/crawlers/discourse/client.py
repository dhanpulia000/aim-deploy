from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

import httpx

from app.config import get_settings
from app.crawlers.base import ForumCategory, ForumCrawler, ForumTopicDetail, ForumTopicListItem
from app.crawlers.discourse import urls
from app.crawlers.discourse.mappers import (
    DiscourseCategoriesResponse,
    DiscourseTopicListResponse,
    map_category,
    map_topic_detail,
    map_topic_list_item,
)
from app.logging_setup import get_logger
from app.utils.retry import RetryPolicy, RetryableHttpError, with_retry


@dataclass(frozen=True)
class RobotsTxt:
    text: str
    fetched_from: str


class DiscourseClient(ForumCrawler):
    def __init__(self) -> None:
        self.settings = get_settings()
        self.log = get_logger(component="discourse_client")
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.settings.http_timeout_seconds),
            headers={
                "Accept": "application/json",
                "User-Agent": self.settings.discourse_user_agent,
            },
            follow_redirects=True,
        )
        self._request_delay = self.settings.request_delay_ms / 1000.0
        self._rate_lock = asyncio.Lock()
        self._robots: RobotsTxt | None = None

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _sleep_between_requests(self) -> None:
        if self._request_delay > 0:
            await asyncio.sleep(self._request_delay)

    async def _get_json(self, url: str) -> dict[str, Any]:
        async with self._rate_lock:
            async def once() -> dict[str, Any]:
                r = await self._client.get(url)
                if r.status_code == 429 or 500 <= r.status_code <= 599:
                    raise RetryableHttpError(r.status_code, f"HTTP {r.status_code} {url}")
                if r.status_code == 404:
                    raise httpx.HTTPStatusError("404", request=r.request, response=r)
                if r.status_code == 403:
                    raise httpx.HTTPStatusError("403", request=r.request, response=r)
                r.raise_for_status()
                return r.json()

            try:
                data = await with_retry(
                    once,
                    policy=RetryPolicy(max_attempts=6, base_delay_seconds=1.0, max_delay_seconds=60.0),
                    retry_on_status={429, 500, 502, 503, 504},
                )
                assert isinstance(data, dict)
                return data
            finally:
                await self._sleep_between_requests()

    async def fetch_robots_txt(self) -> RobotsTxt:
        base = str(self.settings.discourse_base_url)
        robots_url = urljoin(base.rstrip("/") + "/", "robots.txt")
        r = await self._client.get(robots_url, headers={"Accept": "text/plain"})
        r.raise_for_status()
        rt = RobotsTxt(text=r.text, fetched_from=robots_url)
        self._robots = rt
        self.log.info("robots_fetched", url=robots_url, size=len(rt.text))
        return rt

    async def _ensure_robots_logged(self) -> None:
        if self._robots is not None:
            return
        try:
            await self.fetch_robots_txt()
        except Exception as e:
            # robots.txt fetch 실패는 치명적이지 않게 처리하되, 운영 시 반드시 로그로 확인.
            self.log.warning("robots_fetch_failed", error=str(e))

    async def fetch_categories(self) -> list[ForumCategory]:
        await self._ensure_robots_logged()
        base = str(self.settings.discourse_base_url)
        data = await self._get_json(urls.categories_json(base))
        parsed = DiscourseCategoriesResponse.model_validate(data)
        cats = [map_category(c) for c in parsed.categories() if not c.read_restricted]
        cats.sort(key=lambda c: (c.position if c.position is not None else 10**9, c.external_id))
        return cats

    async def fetch_category_latest_topics(
        self, *, category_slug: str, category_id: int, page: int
    ) -> tuple[list[ForumTopicListItem], str | None]:
        await self._ensure_robots_logged()
        base = str(self.settings.discourse_base_url)
        data = await self._get_json(
            urls.category_latest_json(base, slug=category_slug, category_id=category_id, page=page)
        )
        parsed = DiscourseTopicListResponse.model_validate(data)
        items = [map_topic_list_item(base, t) for t in parsed.topics()]
        more = parsed.more_topics_url()
        # more_topics_url is a path, not full URL
        more_abs = urljoin(base.rstrip("/") + "/", more.lstrip("/")) if more else None
        return items, more_abs

    async def fetch_topic_detail(self, *, topic_id: int) -> ForumTopicDetail:
        await self._ensure_robots_logged()
        base = str(self.settings.discourse_base_url)
        data = await self._get_json(urls.topic_json(base, topic_id=topic_id))
        return map_topic_detail(base, data)

