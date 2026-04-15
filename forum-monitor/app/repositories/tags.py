from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import Tag


def normalize_tag(name: str) -> str:
    return name.strip().lower()


async def get_or_create_tags(session: AsyncSession, names: list[str]) -> dict[str, Tag]:
    normalized = [normalize_tag(n) for n in names if n and n.strip()]
    if not normalized:
        return {}
    normalized = list(dict.fromkeys(normalized))  # preserve order, unique

    existing = (await session.execute(select(Tag).where(Tag.name.in_(normalized)))).scalars().all()
    by_name = {t.name: t for t in existing}
    for n in normalized:
        if n not in by_name:
            t = Tag(name=n)
            session.add(t)
            by_name[n] = t
    return by_name

