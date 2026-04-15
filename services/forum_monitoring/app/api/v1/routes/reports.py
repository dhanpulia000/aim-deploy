from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.daily_trend_report import DailyTrendReport
from app.schemas.report import DailyTrendReportOut, GenerateReportRequest
from app.workers.tasks_report import generate_daily_trend_report

router = APIRouter()


@router.get("/daily/latest", response_model=DailyTrendReportOut)
async def get_latest_daily_report(session: AsyncSession = Depends(get_session)):
    q = select(DailyTrendReport).order_by(DailyTrendReport.window_end_at.desc()).limit(1)
    row = (await session.execute(q)).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="No report yet")
    return DailyTrendReportOut.model_validate(row)


@router.get("/daily/{date_kst}", response_model=DailyTrendReportOut)
async def get_daily_report(date_kst: str, session: AsyncSession = Depends(get_session)):
    q = (
        select(DailyTrendReport)
        .where(DailyTrendReport.date_kst == date_kst)
        .order_by(DailyTrendReport.window_end_at.desc())
        .limit(1)
    )
    row = (await session.execute(q)).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return DailyTrendReportOut.model_validate(row)


@router.post("/generate")
async def generate_report(req: GenerateReportRequest):
    # fire-and-forget style; returns celery async result id
    async_result = generate_daily_trend_report.delay(req.date_kst)
    return {"task_id": async_result.id}

