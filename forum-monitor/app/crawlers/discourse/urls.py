from __future__ import annotations

from urllib.parse import quote


def categories_json(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/categories.json"


def category_latest_json(base_url: str, *, slug: str, category_id: int, page: int) -> str:
    b = base_url.rstrip("/")
    return f"{b}/c/{quote(slug)}/{category_id}/l/latest.json?page={page}"


def topic_json(base_url: str, *, topic_id: int) -> str:
    b = base_url.rstrip("/")
    return f"{b}/t/{topic_id}.json"


def topic_url(base_url: str, *, slug: str | None, topic_id: int) -> str:
    b = base_url.rstrip("/")
    s = slug or "topic"
    return f"{b}/t/{quote(s)}/{topic_id}"

