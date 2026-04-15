from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.repositories.categories import list_categories

router = APIRouter()


@router.get("")
async def list_categories(session: AsyncSession = Depends(get_db_session)):
    items = await list_categories(session)
    return {
        "items": [
            {
                "id": c.id,
                "external_id": c.external_id,
                "slug": c.slug,
                "name": c.name,
                "position": c.position,
                "read_restricted": c.read_restricted,
            }
            for c in items
        ]
    }

