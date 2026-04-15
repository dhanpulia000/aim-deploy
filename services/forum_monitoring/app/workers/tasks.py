from __future__ import annotations

import asyncio
from typing import Any, Coroutine

from datetime import datetime, timezone

from app.crawlers.discourse.client import DiscourseClient
from app.core.config import get_settings
from app.db.session import get_sessionmaker
from app.policies.category_priority import policy_for_category
from app.repositories.categories import list_categories, upsert_categories
from app.repositories.posts import upsert_post_from_discourse
from app.repositories.snapshots import create_snapshot
from app.repositories.crawl_runs import finish_run, start_run
from app.repositories.topics import apply_topic_detail, get_topic_by_external_id
from sqlalchemy import select

from app.models.category import Category
from app.repositories.scan_states import get_or_create_scan_state, is_due
from app.services.category_latest_sync import CategoryLatestSyncService
from app.services.topic_detail_sync import TopicDetailSyncService
from app.workers.celery_app import celery_app


_worker_loop: asyncio.AbstractEventLoop | None = None


@celery_app.on_after_fork.connect
def _init_worker_loop(sender, **_kwargs):  # pragma: no cover
    """
    Celery prefork에서 task마다 asyncio.run()을 쓰면 loop가 매번 달라져
    asyncpg 연결 풀의 Future가 다른 loop에 붙는 문제가 생길 수 있다.
    worker process마다 단일 loop를 만들어 재사용한다.
    """
    global _worker_loop
    if _worker_loop is None:
        _worker_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_worker_loop)


def run_coro(coro: Coroutine[Any, Any, Any]):
    global _worker_loop
    if _worker_loop is None:
        _worker_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_worker_loop)
    return _worker_loop.run_until_complete(coro)


@celery_app.task(name="forum_monitoring.ping")
def ping() -> str:
    return "pong"


@celery_app.task(name="forum_monitoring.sync_categories")
def sync_categories() -> dict:
    async def run() -> dict:
        crawler = DiscourseClient()
        try:
            SessionLocal = get_sessionmaker()
            async with SessionLocal() as session:
                crawl_run = await start_run(session, source="DISCOURSE_PLAYINZOI", run_type="categories")
                fetched = await crawler.fetch_categories()
                await upsert_categories(session, source="DISCOURSE_PLAYINZOI", items=fetched)
                await session.commit()
                await finish_run(
                    session,
                    run=crawl_run,
                    fetched_count=len(fetched),
                    error_count=0,
                    stats={"categories_fetched": len(fetched)},
                )
                await session.commit()
                return {"categories_fetched": len(fetched)}
        finally:
            await crawler.aclose()

    return run_coro(run())


@celery_app.task(name="forum_monitoring.sync_topic_list")
def sync_topic_list() -> dict:
    async def run() -> dict:
        crawler = DiscourseClient()
        try:
            SessionLocal = get_sessionmaker()
            async with SessionLocal() as session:
                crawl_run = await start_run(session, source="DISCOURSE_PLAYINZOI", run_type="topic_list")
                svc = TopicListSyncService(crawler)
                stats = await svc.run(session)
                await finish_run(
                    session,
                    run=crawl_run,
                    fetched_count=stats.topics_seen,
                    error_count=0,
                    stats={"categories_scanned": stats.categories_scanned, "topics_seen": stats.topics_seen},
                )
                await session.commit()
                return {"categories_scanned": stats.categories_scanned, "topics_seen": stats.topics_seen}
        finally:
            await crawler.aclose()

    return run_coro(run())


@celery_app.task(name="forum_monitoring.bootstrap_category_policies")
def bootstrap_category_policies() -> dict:
    """
    카테고리 기본 우선순위/주기(P0/P1/P2)를 자동 적용.
    - 운영자가 이미 설정을 바꿨다면 덮어쓰지 않도록, 기본값(priority=1, interval=600)일 때만 적용한다.
    """

    async def run() -> dict:
        SessionLocal = get_sessionmaker()
        async with SessionLocal() as session:
            cats = (await session.execute(select(Category))).scalars().all()
            updated = 0
            for c in cats:
                pol = policy_for_category(name=c.name, slug=c.slug)
                if pol is None:
                    continue
                is_default = (c.priority == 1) and (c.list_poll_interval_sec == 600)
                if not is_default:
                    continue
                c.priority = pol.priority
                c.list_poll_interval_sec = pol.list_poll_interval_sec
                updated += 1
            await session.commit()
            return {"categories_total": len(cats), "categories_updated": updated}

    return run_coro(run())


@celery_app.task(name="forum_monitoring.enqueue_due_category_scans")
def enqueue_due_category_scans() -> dict:
    """
    Beat는 매분 이 태스크만 실행하고, due인 카테고리만 실제 목록 수집 태스크로 enqueue.
    """

    async def run() -> dict:
        now = datetime.now(timezone.utc)
        SessionLocal = get_sessionmaker()
        async with SessionLocal() as session:
            existing = await list_categories(session)
            if not existing:
                # bootstrap categories if empty
                crawler = DiscourseClient()
                try:
                    fetched = await crawler.fetch_categories()
                    await upsert_categories(session, source="DISCOURSE_PLAYINZOI", items=fetched)
                    await session.commit()
                finally:
                    await crawler.aclose()
            cats = (
                await session.execute(
                    select(Category)
                    .where(Category.enabled == True, Category.is_restricted == False)  # noqa: E712
                    .order_by(Category.priority.asc(), Category.id.asc())
                )
            ).scalars().all()

            enqueued = 0
            for c in cats:
                scan_state = await get_or_create_scan_state(
                    session, source=c.source, category_id=c.id
                )
                if is_due(scan_state=scan_state, interval_sec=c.list_poll_interval_sec, now=now):
                    sync_category_latest.delay(c.id)
                    enqueued += 1
            await session.commit()
            return {"categories_checked": len(cats), "categories_enqueued": enqueued}

    return run_coro(run())


@celery_app.task(name="forum_monitoring.sync_category_latest")
def sync_category_latest(category_id: int) -> dict:
    async def run() -> dict:
        crawler = DiscourseClient()
        try:
            SessionLocal = get_sessionmaker()
            async with SessionLocal() as session:
                category = (
                    await session.execute(select(Category).where(Category.id == category_id).limit(1))
                ).scalars().first()
                if category is None:
                    return {"ok": False, "error": "category_not_found"}

                crawl_run = await start_run(
                    session, source=category.source, run_type="topic_list"
                )
                svc = CategoryLatestSyncService(crawler)
                result = await svc.run(session, category=category)

                # enqueue detail tasks for candidates
                for topic_external_id in result.candidates[:200]:
                    sync_topic_detail_one.delay(topic_external_id)

                await finish_run(
                    session,
                    run=crawl_run,
                    fetched_count=result.topics_seen,
                    error_count=0,
                    stats={
                        "category_id": category_id,
                        "topics_seen": result.topics_seen,
                        "candidates": len(result.candidates),
                    },
                )
                await session.commit()
                return {
                    "ok": True,
                    "category_id": category_id,
                    "topics_seen": result.topics_seen,
                    "candidates": len(result.candidates),
                }
        finally:
            await crawler.aclose()

    return run_coro(run())


@celery_app.task(name="forum_monitoring.sync_topic_detail_one")
def sync_topic_detail_one(external_topic_id: int) -> dict:
    async def run() -> dict:
        crawler = DiscourseClient()
        try:
            SessionLocal = get_sessionmaker()
            async with SessionLocal() as session:
                # Reuse detail sync service by temporarily limiting selection
                # (MVP: 직접 fetch해서 one-topic 처리)
                detail = await crawler.fetch_topic_detail(topic_id=external_topic_id)
                topic = await get_topic_by_external_id(
                    session, source="DISCOURSE_PLAYINZOI", external_topic_id=external_topic_id
                )
                if topic is None:
                    return {"ok": False, "error": "topic_not_found_in_db"}
                await apply_topic_detail(session, source="DISCOURSE_PLAYINZOI", topic=topic, detail=detail)
                first = detail.posts[0] if detail.posts else None
                if first is not None:
                    await upsert_post_from_discourse(session, source="DISCOURSE_PLAYINZOI", topic=topic, p=first)
                await create_snapshot(
                    session,
                    topic=topic,
                    captured_at=datetime.now(timezone.utc),
                    bucket_minutes=get_settings().snapshot_bucket_minutes,
                )
                await session.commit()
                return {"ok": True, "external_topic_id": external_topic_id}
        finally:
            await crawler.aclose()

    return run_coro(run())


@celery_app.task(name="forum_monitoring.sync_topic_detail")
def sync_topic_detail() -> dict:
    async def run() -> dict:
        crawler = DiscourseClient()
        try:
            SessionLocal = get_sessionmaker()
            async with SessionLocal() as session:
                crawl_run = await start_run(session, source="DISCOURSE_PLAYINZOI", run_type="topic_detail")
                svc = TopicDetailSyncService(crawler)
                stats = await svc.run(session)
                await finish_run(
                    session,
                    run=crawl_run,
                    fetched_count=stats.topics_processed,
                    error_count=stats.errors,
                    stats={
                        "topics_processed": stats.topics_processed,
                        "snapshots_created": stats.snapshots_created,
                        "errors": stats.errors,
                    },
                )
                await session.commit()
                return {
                    "topics_processed": stats.topics_processed,
                    "snapshots_created": stats.snapshots_created,
                    "errors": stats.errors,
                }
        finally:
            await crawler.aclose()

    return run_coro(run())

