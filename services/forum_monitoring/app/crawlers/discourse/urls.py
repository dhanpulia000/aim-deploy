from __future__ import annotations


def categories_json(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/categories.json"


def category_latest_json(*, base_url: str, slug: str, category_id: int, page: int) -> str:
    return f"{base_url.rstrip('/')}/c/{slug}/{category_id}/l/latest.json?page={page}"


def topic_json(*, base_url: str, topic_id: int) -> str:
    return f"{base_url.rstrip('/')}/t/{topic_id}.json"


def topic_url(*, base_url: str, slug: str | None, topic_id: int) -> str:
    s = slug or "topic"
    return f"{base_url.rstrip('/')}/t/{s}/{topic_id}"

