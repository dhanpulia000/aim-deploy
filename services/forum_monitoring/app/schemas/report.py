from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel
from pydantic import ConfigDict


class DailyTrendReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    date_kst: str
    window_start_at: datetime
    window_end_at: datetime
    category_summary: dict
    hot_topics: list
    new_topics: list
    reactivated_topics: list
    tag_trends: dict
    generated_at: datetime
    version: int


class GenerateReportRequest(BaseModel):
    # If omitted, generate latest rolling 24h report with date_kst derived from KST now.
    date_kst: str | None = None

