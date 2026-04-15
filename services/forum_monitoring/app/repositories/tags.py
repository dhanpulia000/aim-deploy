from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import Tag


def normalize_tag(name: str) -> str:
    return name.strip().lower()


def infer_tag_type(name: str) -> str:
    """
    MVP heuristic: 대부분은 DOMAIN.
    STATUS 태그는 운영 룰로 별도 매핑이 가능하므로, 초기엔 수동/룰 기반으로 확장.
    """
    n = normalize_tag(name)
    status_like = {"solved", "resolved", "acknowledged", "fixed", "answered"}
    return "STATUS" if n in status_like else "DOMAIN"


async def get_or_create_tags(
    session: AsyncSession, *, source: str, names: list[str]
) -> dict[str, Tag]:
    normalized = [normalize_tag(n) for n in names if n and n.strip()]
    if not normalized:
        return {}
    normalized = list(dict.fromkeys(normalized))  # unique, preserve order

    existing = (
        await session.execute(
            select(Tag).where(Tag.source == source, Tag.name.in_(normalized))
        )
    ).scalars().all()
    by_name = {t.name: t for t in existing}

    for n in normalized:
        if n not in by_name:
            t = Tag(source=source, name=n, tag_type=infer_tag_type(n))
            session.add(t)
            by_name[n] = t

    return by_name

