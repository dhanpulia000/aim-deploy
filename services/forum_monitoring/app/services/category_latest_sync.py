from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.crawlers.discourse.client import DiscourseClient
from app.models.category import Category
from app.repositories.scan_states import get_or_create_scan_state, mark_ran
from app.repositories.topics import upsert_topic_from_list_item


@dataclass(frozen=True)
class CategoryLatestSyncResult:
    topics_seen: int
    candidates: list[int]  # external_topic_id list


class CategoryLatestSyncService:
    def __init__(self, crawler: DiscourseClient) -> None:
        self.crawler = crawler
        self.settings = get_settings()
        self.log = get_logger(service="category_latest_sync")

    async def run(self, session: AsyncSession, *, category: Category) -> CategoryLatestSyncResult:
        """
        목록(latest) 수집을 카테고리 단위로 실행하고, 신규/재상승 토픽을 후보로 반환.
        watermark는 CategoryScanState.state_json에 저장.
        """
        now = datetime.now(timezone.utc)
        scan_state = await get_or_create_scan_state(session, source=category.source, category_id=category.id)

        category_by_external = {category.external_category_id: category}
        topics_seen = 0
        candidates: list[int] = []

        # For safety, cap pages. Typically P0 can use more, P2 less (추후 정책화).
        max_pages = self.settings.max_pages_per_category
        page = 1

        # watermark comparison (use bumped_at primarily)
        prev_bumped_at = scan_state.last_seen_bumped_at
        prev_topic_id = scan_state.last_seen_topic_id or 0
        max_bumped_at = prev_bumped_at
        max_topic_id = prev_topic_id

        for _ in range(max_pages):
            items, _more = await self.crawler.fetch_category_latest_topics(
                category_slug=category.slug, category_id=category.external_category_id, page=page
            )
            if not items:
                break
            page += 1
            for it in items:
                await upsert_topic_from_list_item(
                    session,
                    source=category.source,
                    item=it,
                    category_by_external_id=category_by_external,
                )
                topics_seen += 1

                # candidate selection: new or bumped since last run
                bumped = it.bumped_at or it.last_posted_at
                if bumped and (max_bumped_at is None or bumped > max_bumped_at):
                    max_bumped_at = bumped
                if it.external_id > max_topic_id:
                    max_topic_id = it.external_id

                is_newish = it.external_id > prev_topic_id
                is_bumped = bumped and prev_bumped_at and bumped > prev_bumped_at
                if is_newish or is_bumped:
                    candidates.append(it.external_id)

        # update watermark
        scan_state.last_seen_bumped_at = max_bumped_at
        scan_state.last_seen_topic_id = max_topic_id
        scan_state.last_page = 1
        mark_ran(scan_state, now)

        # dynamic boost (MVP): candidates 급증 시 임시로 interval 단축
        boost = self._compute_boost(category=category, candidate_count=len(candidates))
        if boost is not None:
            scan_state.state_json["boost_until"] = boost["boost_until"]
            scan_state.state_json["boost_interval_sec"] = boost["boost_interval_sec"]

        self.log.info(
            "category_latest_synced",
            category_id=category.id,
            topics_seen=topics_seen,
            candidates=len(candidates),
        )
        return CategoryLatestSyncResult(topics_seen=topics_seen, candidates=list(dict.fromkeys(candidates)))

    def _compute_boost(self, *, category: Category, candidate_count: int) -> dict | None:
        """
        급증 판단의 최소 구현.
        - 후보(신규/재상승)가 많으면 짧은 시간(2h) 동안 list 폴링을 더 촘촘히 한다.
        """
        if candidate_count < 10:
            return None
        # P0는 더 촘촘, P1/P2는 완만
        if category.priority == 0:
            interval = 120
        elif category.priority == 1:
            interval = 300
        else:
            interval = 600
        boost_until = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat().replace("+00:00", "Z")
        return {"boost_until": boost_until, "boost_interval_sec": interval}

