from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crawlers.discourse.mappers import DiscoursePostModel
from app.models.post import Post
from app.models.topic import Topic
from app.utils.hashing import sha256_hex
from app.utils.text_normalize import derive_flags, normalize_for_hash, strip_html


async def get_post_by_external_id(
    session: AsyncSession, *, source: str, external_post_id: int
) -> Post | None:
    q = (
        select(Post)
        .where(Post.source == source, Post.external_post_id == external_post_id)
        .limit(1)
    )
    return (await session.execute(q)).scalars().first()


async def upsert_post_from_discourse(
    session: AsyncSession,
    *,
    source: str,
    topic: Topic,
    p: DiscoursePostModel,
    normalize_version: int = 1,
) -> Post | None:
    if p.id is None or p.post_number is None:
        return None

    cooked_html = p.cooked or None
    cooked_text = strip_html(cooked_html or "") if cooked_html else None
    normalized_text = normalize_for_hash(cooked_text or "")
    content_hash = sha256_hex(normalized_text) if normalized_text else None
    flags = derive_flags(cooked_html or "")

    now = datetime.now(timezone.utc)
    row = await get_post_by_external_id(session, source=source, external_post_id=p.id)
    if row is None:
        row = Post(
            source=source,
            external_post_id=p.id,
            topic_id=topic.id,
            post_number=int(p.post_number),
            author_username=p.username,
            post_created_at=_parse_dt(p.created_at),
            post_updated_at=_parse_dt(p.updated_at),
            edit_count=p.edit_count,
            last_edited_at=_parse_dt(p.last_edited_at),
            raw=p.raw,
            cooked_html=cooked_html,
            cooked_text=cooked_text,
            normalized_text=normalized_text or None,
            content_hash=content_hash,
            normalize_version=normalize_version,
            has_images=bool(cooked_html and "<img" in cooked_html.lower()),
            has_links=flags["has_links"],
            has_code_block=flags["has_code_block"],
        )
        session.add(row)
        return row

    row.topic_id = topic.id
    row.author_username = p.username or row.author_username
    row.post_updated_at = _parse_dt(p.updated_at) or row.post_updated_at
    row.edit_count = p.edit_count if p.edit_count is not None else row.edit_count
    row.last_edited_at = _parse_dt(p.last_edited_at) or row.last_edited_at
    if p.raw is not None:
        row.raw = p.raw
    if cooked_html is not None:
        row.cooked_html = cooked_html
        row.cooked_text = cooked_text
        row.normalized_text = normalized_text or None
        row.content_hash = content_hash
        row.normalize_version = normalize_version
        row.has_images = bool("<img" in cooked_html.lower())
        row.has_links = flags["has_links"]
        row.has_code_block = flags["has_code_block"]
    row.updated_at = now
    return row


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

