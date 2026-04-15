from __future__ import annotations

from celery import Celery

from app.core.config import get_settings


def make_celery() -> Celery:
    settings = get_settings()
    celery = Celery(
        "forum_monitoring",
        broker=settings.redis_url,
        backend=settings.redis_url,
        include=["app.workers.tasks", "app.workers.tasks_report"],
    )
    celery.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        timezone="UTC",
        enable_utc=True,
        broker_connection_retry_on_startup=True,
    )
    return celery


celery_app = make_celery()


@celery_app.on_after_configure.connect
def setup_periodic_tasks(sender, **_kwargs):
    # Beat는 매분 due 카테고리만 큐잉 (카테고리별 interval은 DB 설정 사용)
    sender.add_periodic_task(86400.0, "forum_monitoring.sync_categories", name="sync_categories_daily")
    sender.add_periodic_task(60.0, "forum_monitoring.enqueue_due_category_scans", name="enqueue_due_category_scans_1m")
    # 카테고리 정책 기본값 부트스트랩(주 1회 정도면 충분하지만, 운영 편의상 6시간마다 가볍게 실행)
    sender.add_periodic_task(21600.0, "forum_monitoring.bootstrap_category_policies", name="bootstrap_category_policies_6h")
    # 백필/안전망: 상세 동기화 배치도 유지 (토픽이 많아져도 주기적으로 최신 상태 보정)
    sender.add_periodic_task(1800.0, "forum_monitoring.sync_topic_detail", name="sync_topic_detail_30m")
    sender.add_periodic_task(3600.0, "forum_monitoring.generate_daily_trend_report", name="generate_daily_report_1h")

