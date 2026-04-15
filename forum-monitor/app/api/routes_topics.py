from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_db_session
from app.repositories.topics import get_topic as get_topic_repo
from app.repositories.topics import list_topics as list_topics_repo

router = APIRouter()


@router.get("")
async def list_topics(
    page: int = Query(default=1, ge=1),
    page_size: int | None = Query(default=None, ge=1),
    _: AsyncSession = Depends(get_db_session),
):
    settings = get_settings()
    size = min(page_size or settings.api_page_size_default, settings.api_page_size_max)
    items, total = await list_topics_repo(_, page=page, page_size=size)
    return {
        "items": [
            {
                "id": t.id,
                "external_id": t.external_id,
                "category_id": t.category_id,
                "title": t.title,
                "url": t.url,
                "author_username": t.author_username,
                "created_at": t.created_at,
                "last_posted_at": t.last_posted_at,
                "reply_count": t.reply_count,
                "views": t.views,
                "tags": [tt.tag_id for tt in (t.tags or [])],  # ids for MVP
                "access_state": t.access_state,
            }
            for t in items
        ],
        "page": page,
        "page_size": size,
        "total": total,
    }


@router.get("/{id}")
async def get_topic(id: int, session: AsyncSession = Depends(get_db_session)):
    t = await get_topic_repo(session, topic_id=id)
    if not t:
        return {"found": False}
    return {
        "found": True,
        "item": {
            "id": t.id,
            "external_id": t.external_id,
            "category_id": t.category_id,
            "title": t.title,
            "slug": t.slug,
            "url": t.url,
            "author_username": t.author_username,
            "created_at": t.created_at,
            "last_posted_at": t.last_posted_at,
            "bumped_at": t.bumped_at,
            "reply_count": t.reply_count,
            "views": t.views,
            "posts_count": t.posts_count,
            "closed": t.closed,
            "archived": t.archived,
            "pinned": t.pinned,
            "body_hash": t.body_hash,
            "excerpt": t.excerpt,
            "access_state": t.access_state,
        },
    }

