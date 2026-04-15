from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import get_engine

try:
    import redis
except Exception:  # pragma: no cover
    redis = None

router = APIRouter()


@router.get("/health")
async def health():
    settings = get_settings()
    db_ok = True
    redis_ok = True
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    if redis is None:
        redis_ok = False
    else:
        try:
            r = redis.Redis.from_url(settings.redis_url)
            redis_ok = bool(r.ping())
        except Exception:
            redis_ok = False
    ok = db_ok and redis_ok
    return {"ok": ok, "db_ok": db_ok, "redis_ok": redis_ok}

