from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.daily_trend_report import DailyTrendReport
from app.models.topic import Topic
from app.models.topic_snapshot import TopicSnapshot


@dataclass(frozen=True)
class DailyReportWindow:
    date_kst: str
    start_at: datetime
    end_at: datetime


def kst_now() -> datetime:
    return datetime.now(timezone(timedelta(hours=9)))


def compute_window(date_kst: str | None) -> DailyReportWindow:
    now_kst = kst_now()
    if date_kst is None:
        date_kst = now_kst.strftime("%Y-%m-%d")
    # rolling 24h window ending now
    end_at = now_kst.astimezone(timezone.utc)
    start_at = (now_kst - timedelta(hours=24)).astimezone(timezone.utc)
    return DailyReportWindow(date_kst=date_kst, start_at=start_at, end_at=end_at)


class DailyReportService:
    def __init__(self) -> None:
        self.log = get_logger(service="daily_report")

    async def generate(self, session: AsyncSession, *, date_kst: str | None) -> DailyTrendReport:
        window = compute_window(date_kst)

        # New topics: first seen (this system) within window
        first_seen_expr = func.coalesce(Topic.first_seen_at, Topic.last_list_seen_at, Topic.topic_created_at)
        new_topics = (
            await session.execute(
                select(Topic)
                .where(first_seen_expr.is_not(None), first_seen_expr >= window.start_at)
                .order_by(first_seen_expr.desc())
                .limit(200)
            )
        ).scalars().all()

        # Hot topics: delta replies/views/likes within window from snapshots
        snap_q = (
            select(
                TopicSnapshot.topic_id,
                func.min(TopicSnapshot.reply_count).label("reply_min"),
                func.max(TopicSnapshot.reply_count).label("reply_max"),
                func.min(TopicSnapshot.views).label("views_min"),
                func.max(TopicSnapshot.views).label("views_max"),
                func.min(TopicSnapshot.like_count).label("likes_min"),
                func.max(TopicSnapshot.like_count).label("likes_max"),
            )
            .where(TopicSnapshot.captured_at >= window.start_at, TopicSnapshot.captured_at <= window.end_at)
            .group_by(TopicSnapshot.topic_id)
        )
        deltas = (await session.execute(snap_q)).all()
        # Compute score and pick top N
        scored = []
        for row in deltas:
            # need at least 2 snapshots with non-null baseline to compute meaningful delta
            if row.reply_min is None and row.reply_max is None and row.views_min is None and row.views_max is None:
                continue
            dr = (row.reply_max or 0) - (row.reply_min or 0)
            dv = (row.views_max or 0) - (row.views_min or 0)
            dl = (row.likes_max or 0) - (row.likes_min or 0)
            score = dr * 10 + dl * 3 + dv * 0.05
            if score <= 0:
                continue
            scored.append(
                {
                    "topic_id": int(row.topic_id),
                    "delta_replies": int(dr),
                    "delta_views": int(dv),
                    "delta_likes": int(dl),
                    "score": float(score),
                }
            )
        scored.sort(key=lambda x: x["score"], reverse=True)
        hot = scored[:50]
        if not hot:
            # Fallback: snapshot Δ가 전부 0인 경우가 많음(24h 안에 토픽당 스냅샷 1건 등).
            # 최근에 DB에서 갱신·최초 수집된 토픽을 기준으로 절대값(댓글·좋아요·조회) 점수를 쓴다.
            # last_activity_at만 쓰면 안 됨: Discourse bumped 시각이라 목록 재수집 후에도 과거일 수 있음.
            epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
            seen_expr = func.greatest(
                func.coalesce(Topic.last_activity_at, epoch),
                func.coalesce(Topic.last_list_seen_at, epoch),
                func.coalesce(Topic.last_detail_crawled_at, epoch),
                func.coalesce(Topic.first_seen_at, epoch),
                func.coalesce(Topic.updated_at, epoch),
            )
            active_topics = (
                await session.execute(
                    select(Topic)
                    .where(
                        seen_expr >= window.start_at,
                    )
                    .order_by(Topic.reply_count.desc().nullslast(), Topic.like_count.desc().nullslast(), Topic.views.desc().nullslast())
                    .limit(200)
                )
            ).scalars().all()

            fallback_scored: list[dict] = []
            for t in active_topics:
                rc = int(t.reply_count or 0)
                lc = int(t.like_count or 0)
                vv = int(t.views or 0)
                score = rc * 10 + lc * 3 + vv * 0.01
                if score <= 0:
                    continue
                last_activity_at = t.last_activity_at.isoformat() if t.last_activity_at else None
                last_list_seen_at = t.last_list_seen_at.isoformat() if t.last_list_seen_at else None
                fallback_scored.append(
                    {
                        "topic_id": int(t.id),
                        "delta_replies": 0,
                        "delta_views": 0,
                        "delta_likes": 0,
                        "score": float(score),
                        "mode": "fallback_absolute",
                        "views": vv,
                        "reply_count": rc,
                        "like_count": lc,
                        "last_activity_at": last_activity_at,
                        "last_list_seen_at": last_list_seen_at,
                    }
                )
            fallback_scored.sort(key=lambda x: x["score"], reverse=True)
            hot = fallback_scored[:50]

        if not hot:
            # 마지막 수단: 최근 창에 걸린 토픽이 하나도 없어도(오래된 last_activity 등) DB에 있는 토픽 중 인기 순 표시
            global_topics = (
                await session.execute(
                    select(Topic)
                    .where(Topic.deleted == False, Topic.visible == True)  # noqa: E712
                    .order_by(
                        Topic.reply_count.desc().nullslast(),
                        Topic.like_count.desc().nullslast(),
                        Topic.views.desc().nullslast(),
                    )
                    .limit(200)
                )
            ).scalars().all()
            global_scored: list[dict] = []
            for t in global_topics:
                rc = int(t.reply_count or 0)
                lc = int(t.like_count or 0)
                vv = int(t.views or 0)
                score = rc * 10 + lc * 3 + vv * 0.01
                if score <= 0:
                    continue
                global_scored.append(
                    {
                        "topic_id": int(t.id),
                        "delta_replies": 0,
                        "delta_views": 0,
                        "delta_likes": 0,
                        "score": float(score),
                        "mode": "fallback_global_engagement",
                        "views": vv,
                        "reply_count": rc,
                        "like_count": lc,
                        "last_activity_at": t.last_activity_at.isoformat() if t.last_activity_at else None,
                        "last_list_seen_at": t.last_list_seen_at.isoformat() if t.last_list_seen_at else None,
                    }
                )
            global_scored.sort(key=lambda x: x["score"], reverse=True)
            hot = global_scored[:50]

        hot_topic_ids = [h["topic_id"] for h in hot]
        topics_by_id: dict[int, Topic] = {}
        if hot_topic_ids:
            rows = (await session.execute(select(Topic).where(Topic.id.in_(hot_topic_ids)))).scalars().all()
            topics_by_id = {t.id: t for t in rows}
        for h in hot:
            t = topics_by_id.get(h["topic_id"])
            if t is None:
                continue
            h["url"] = t.url
            h["title"] = t.title
            h["external_topic_id"] = int(t.external_topic_id)

        # Reactivated topics: activity in window but first_seen earlier than window start
        reactivated = (
            await session.execute(
                select(Topic)
                .where(
                    Topic.last_activity_at.is_not(None),
                    Topic.last_activity_at >= window.start_at,
                    first_seen_expr.is_not(None),
                    first_seen_expr < window.start_at,
                )
                .order_by(Topic.last_activity_at.desc())
                .limit(200)
            )
        ).scalars().all()

        # Category summary: new topics count and hot score sum
        category_summary: dict[str, dict] = {}
        for t in new_topics:
            key = str(t.category_id or "null")
            category_summary.setdefault(key, {"new_topics": 0, "hot_score_sum": 0})
            category_summary[key]["new_topics"] += 1
        for h in hot:
            topic = topics_by_id.get(h["topic_id"])
            if topic is None:
                continue
            key = str(topic.category_id or "null")
            category_summary.setdefault(key, {"new_topics": 0, "hot_score_sum": 0})
            category_summary[key]["hot_score_sum"] += h["score"]

        # Tag trends: MVP placeholder (filled in ops-hardening step)
        tag_trends = {"domain": [], "status": []}

        now = datetime.now(timezone.utc)

        existing = (
            await session.execute(
                select(DailyTrendReport)
                .where(
                    DailyTrendReport.source == "DISCOURSE_PLAYINZOI",
                    DailyTrendReport.date_kst == window.date_kst,
                )
                .order_by(DailyTrendReport.window_end_at.desc())
                .limit(1)
            )
        ).scalars().first()

        payload = dict(
            window_start_at=window.start_at,
            window_end_at=window.end_at,
            category_summary=category_summary,
            hot_topics=hot,
            new_topics=[{"topic_id": t.id, "title": t.title, "url": t.url} for t in new_topics[:100]],
            reactivated_topics=[
                {"topic_id": t.id, "title": t.title, "url": t.url, "last_activity_at": t.last_activity_at}
                for t in reactivated[:100]
            ],
            tag_trends=tag_trends,
            generated_at=now,
        )

        if existing is None:
            report = DailyTrendReport(
                source="DISCOURSE_PLAYINZOI",
                date_kst=window.date_kst,
                version=1,
                **payload,
            )
            session.add(report)
        else:
            report = existing
            for k, v in payload.items():
                setattr(report, k, v)
            report.version = int(report.version) + 1

        await session.commit()
        self.log.info("daily_report_generated", date_kst=window.date_kst, version=report.version)
        return report

