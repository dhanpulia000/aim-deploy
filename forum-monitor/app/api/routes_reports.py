from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.repositories.reports import get_daily_report_by_date, get_latest_daily_report

router = APIRouter()


@router.get("/daily/latest")
async def daily_latest(session: AsyncSession = Depends(get_db_session)):
    row = await get_latest_daily_report(session)
    if not row:
        return {"found": False, "report": None}
    return {"found": True, "report": {"date": str(row.report_date), "payload": row.payload}}


@router.get("/daily")
async def daily_by_date(
    report_date: date = Query(alias="date"),
    session: AsyncSession = Depends(get_db_session),
):
    row = await get_daily_report_by_date(session, report_date)
    if not row:
        return {"date": str(report_date), "found": False, "report": None}
    return {"date": str(report_date), "found": True, "report": {"payload": row.payload}}

