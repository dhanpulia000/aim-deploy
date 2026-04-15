from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.services.report_daily import DailyReportService

router = APIRouter()


@router.post("/generate")
async def generate_report(session: AsyncSession = Depends(get_db_session)):
    res = await DailyReportService().build_and_store(session)
    return {"ok": True, "date": str(res.report_date)}

