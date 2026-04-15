from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crawlers.base import ForumCategory
from app.models.category import Category


async def upsert_categories(session: AsyncSession, categories: list[ForumCategory]) -> dict[int, Category]:
    """
    Returns mapping: category_external_id -> Category row (attached to session).
    """
    if not categories:
        return {}

    external_ids = [c.external_id for c in categories]
    existing = (
        await session.execute(select(Category).where(Category.external_id.in_(external_ids)))
    ).scalars().all()
    by_external = {c.external_id: c for c in existing}

    now = datetime.now(timezone.utc)
    for c in categories:
        row = by_external.get(c.external_id)
        if row is None:
            row = Category(
                external_id=c.external_id,
                slug=c.slug,
                name=c.name,
                position=c.position,
                read_restricted=c.read_restricted,
            )
            session.add(row)
            by_external[c.external_id] = row
        else:
            row.slug = c.slug
            row.name = c.name
            row.position = c.position
            row.read_restricted = c.read_restricted
            row.updated_at = now

    return by_external


async def list_categories(session: AsyncSession) -> list[Category]:
    return (await session.execute(select(Category).order_by(Category.position, Category.id))).scalars().all()

