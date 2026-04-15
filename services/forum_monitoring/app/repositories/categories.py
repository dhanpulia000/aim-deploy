from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crawlers.discourse.mappers import ForumCategoryDTO
from app.models.category import Category


async def list_categories(session: AsyncSession) -> list[Category]:
    return (await session.execute(select(Category).order_by(Category.priority, Category.position, Category.id))).scalars().all()


async def get_category_by_external_id(
    session: AsyncSession, *, source: str, external_category_id: int
) -> Category | None:
    q = (
        select(Category)
        .where(Category.source == source, Category.external_category_id == external_category_id)
        .limit(1)
    )
    return (await session.execute(q)).scalars().first()


async def upsert_categories(
    session: AsyncSession, *, source: str, items: list[ForumCategoryDTO]
) -> dict[int, Category]:
    """
    Returns mapping external_category_id -> Category row.
    """
    out: dict[int, Category] = {}
    for it in items:
        row = await get_category_by_external_id(session, source=source, external_category_id=it.external_id)
        if row is None:
            row = Category(
                source=source,
                external_category_id=it.external_id,
                name=it.name,
                slug=it.slug,
                parent_external_category_id=None,
                is_restricted=bool(it.read_restricted),
                position=it.position,
            )
            session.add(row)
        else:
            row.name = it.name
            row.slug = it.slug
            row.is_restricted = bool(it.read_restricted)
            row.position = it.position
        out[it.external_id] = row
    return out

