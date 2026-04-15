from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category_scan_state import CategoryScanState


async def get_or_create_scan_state(
    session: AsyncSession, *, source: str, category_id: int
) -> CategoryScanState:
    q = (
        select(CategoryScanState)
        .where(CategoryScanState.source == source, CategoryScanState.category_id == category_id)
        .limit(1)
    )
    row = (await session.execute(q)).scalars().first()
    if row is None:
        row = CategoryScanState(
            source=source,
            category_id=category_id,
            last_seen_bumped_at=None,
            last_seen_topic_id=None,
            last_page=1,
            state_json={},
        )
        session.add(row)
        await session.flush()
    return row


def is_due(*, scan_state: CategoryScanState, interval_sec: int, now: datetime) -> bool:
    # boost override
    boost_until = scan_state.state_json.get("boost_until")
    boost_interval = scan_state.state_json.get("boost_interval_sec")
    if isinstance(boost_until, str) and isinstance(boost_interval, (int, float)):
        try:
            until_dt = datetime.fromisoformat(boost_until.replace("Z", "+00:00"))
        except ValueError:
            until_dt = None
        if until_dt is not None:
            if until_dt.tzinfo is None:
                until_dt = until_dt.replace(tzinfo=timezone.utc)
            if now <= until_dt:
                interval_sec = int(boost_interval)

    last_run = scan_state.state_json.get("last_run_at")
    if isinstance(last_run, str):
        try:
            last_dt = datetime.fromisoformat(last_run.replace("Z", "+00:00"))
        except ValueError:
            last_dt = None
    else:
        last_dt = None

    if last_dt is None:
        # never run
        return True
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    return (now - last_dt).total_seconds() >= interval_sec


def mark_ran(scan_state: CategoryScanState, now: datetime) -> None:
    scan_state.state_json["last_run_at"] = now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

