from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.scheduler.jobs import trigger_jobs


router = APIRouter()


JobType = Literal["categories", "topic_list", "topic_detail", "daily_report"]


class CrawlRunRequest(BaseModel):
    job_types: list[JobType] = Field(default_factory=lambda: ["categories", "topic_list", "topic_detail"])
    trigger: Literal["manual"] = "manual"


@router.post("/run")
async def run_crawl(req: CrawlRunRequest):
    queued = await trigger_jobs(req.job_types)
    return {"ok": True, "queued": queued}

