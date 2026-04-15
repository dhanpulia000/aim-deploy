from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.daily_report import DailyTrendReport


async def upsert_daily_report(
    session: AsyncSession,
    *,
    report_date: date,
    window_start,
    window_end,
    payload: dict,
) -> DailyTrendReport:
    existing = (
        await session.execute(
            select(DailyTrendReport).where(DailyTrendReport.report_date == report_date).limit(1)
        )
    ).scalars().first()

    if existing is None:
        row = DailyTrendReport(
            report_date=report_date,
            window_start=window_start,
            window_end=window_end,
            payload=payload,
        )
        session.add(row)
        return row

    existing.window_start = window_start
    existing.window_end = window_end
    existing.payload = payload
    return existing


async def get_latest_daily_report(session: AsyncSession) -> DailyTrendReport | None:
    return (
        await session.execute(
            select(DailyTrendReport).order_by(DailyTrendReport.report_date.desc(), DailyTrendReport.id.desc()).limit(1)
        )
    ).scalars().first()


async def get_daily_report_by_date(session: AsyncSession, report_date: date) -> DailyTrendReport | None:
    return (
        await session.execute(
            select(DailyTrendReport).where(DailyTrendReport.report_date == report_date).limit(1)
        )
    ).scalars().first()

