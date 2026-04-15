from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter()


@router.get("/health")
async def health():
    settings = get_settings()
    return {"ok": True, "env": settings.app_env, "discourse_base_url": str(settings.discourse_base_url)}

