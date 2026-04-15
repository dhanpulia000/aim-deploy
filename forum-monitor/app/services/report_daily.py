from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.logging_setup import get_logger
from app.models.category import Category
from app.models.topic import Topic
from app.models.topic_snapshot import TopicSnapshot
from app.repositories.reports import upsert_daily_report
from app.services.similarity import find_candidates
from app.utils.time_windows import rolling_24h


@dataclass(frozen=True)
class DailyReportBuildResult:
    report_date: date
    window_start: datetime
    window_end: datetime


class DailyReportService:
    def __init__(self) -> None:
        self.log = get_logger(service="daily_report")

    async def build_and_store(self, session: AsyncSession) -> DailyReportBuildResult:
        window = rolling_24h()
        window_start, window_end = window.start, window.end
        report_date = window_end.date()

        # Topics updated/created in window
        topics = (
            await session.execute(
                select(Topic)
                .where(
                    (Topic.created_at >= window_start)
                    | (Topic.last_posted_at >= window_start)
                    | (Topic.updated_at_db >= window_start)
                )
            )
        ).scalars().all()

        # Recent snapshots for delta metrics
        snaps = (
            await session.execute(
                select(TopicSnapshot)
                .where(TopicSnapshot.captured_at >= window_start)
                .order_by(TopicSnapshot.captured_at.asc())
            )
        ).scalars().all()

        categories = (await session.execute(select(Category))).scalars().all()
        cat_name_by_id = {c.id: c.name for c in categories}

        new_topics = [t for t in topics if t.created_at and t.created_at >= window_start]
        reactivated = [
            t
            for t in topics
            if (t.created_at is None or t.created_at < window_start)
            and t.last_posted_at
            and t.last_posted_at >= window_start
        ]

        by_category_new: dict[str, int] = defaultdict(int)
        tag_new: Counter[str] = Counter()
        keyword_counter: Counter[str] = Counter()

        for t in new_topics:
            by_category_new[cat_name_by_id.get(t.category_id, "unknown")] += 1
            # tags via TopicTag relationship may not be loaded; rely on title keyword for MVP
            for w in _keywords_from_title(t.title):
                keyword_counter[w] += 1

        # For tag counts, compute from snapshot raw_json tags where possible (detail snapshots)
        for s in snaps:
            raw = s.raw_json or {}
            tags = raw.get("tags") if isinstance(raw, dict) else None
            if isinstance(tags, list):
                if s.change_flags.get("new_topic") is True:
                    for tg in tags:
                        if isinstance(tg, str) and tg:
                            tag_new[tg.lower()] += 1

        status_tag_changes = sum(1 for s in snaps if "closed" in (s.change_flags or {}) or "archived" in (s.change_flags or {}))

        # Delta metrics: replies/views increases based on snapshots
        reply_increase: Counter[int] = Counter()
        view_increase: Counter[int] = Counter()
        last_by_topic: dict[int, TopicSnapshot] = {}
        for s in snaps:
            prev = last_by_topic.get(s.topic_id)
            if prev is not None:
                if s.reply_count is not None and prev.reply_count is not None:
                    d = s.reply_count - prev.reply_count
                    if d > 0:
                        reply_increase[s.topic_id] += d
                if s.views is not None and prev.views is not None:
                    d = s.views - prev.views
                    if d > 0:
                        view_increase[s.topic_id] += d
            last_by_topic[s.topic_id] = s

        top_reply = reply_increase.most_common(10)
        top_views = view_increase.most_common(10)

        # Similarity candidates: recent topics subset
        recent_for_sim = sorted(
            [(t.id, t.title) for t in topics],
            key=lambda x: x[0],
            reverse=True,
        )[:60]
        sim_candidates = find_candidates(recent_for_sim, min_score=0.72, max_pairs=30)

        payload = {
            "window": {"start": window_start.isoformat(), "end": window_end.isoformat()},
            "counts": {
                "new_topics_24h": len(new_topics),
                "reactivated_topics_24h": len(reactivated),
                "status_tag_changes_24h": status_tag_changes,
            },
            "by_category": {"new_topics": dict(sorted(by_category_new.items(), key=lambda x: x[1], reverse=True))},
            "by_tag": {"new_topics": dict(tag_new.most_common(30))},
            "top": {
                "reply_increase": [{"topic_id": tid, "delta": d} for tid, d in top_reply],
                "view_increase": [{"topic_id": tid, "delta": d} for tid, d in top_views],
            },
            "keywords": [{"keyword": k, "count": c} for k, c in keyword_counter.most_common(30)],
            "similarity_candidates": [
                {"a": c.topic_id_a, "b": c.topic_id_b, "score": c.score, "reason": c.reason}
                for c in sim_candidates
            ],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        await upsert_daily_report(
            session,
            report_date=report_date,
            window_start=window_start,
            window_end=window_end,
            payload=payload,
        )
        await session.commit()
        self.log.info("daily_report_saved", report_date=str(report_date))
        return DailyReportBuildResult(report_date=report_date, window_start=window_start, window_end=window_end)


def _keywords_from_title(title: str) -> list[str]:
    # very simple keyword extraction (MVP)
    s = (title or "").lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    words = [w for w in s.split() if len(w) >= 3 and w not in {"the", "and", "for", "with", "from"}]
    return words[:20]

