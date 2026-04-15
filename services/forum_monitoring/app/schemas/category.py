from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    external_category_id: int
    name: str
    slug: str
    is_restricted: bool
    position: int | None
    priority: int
    enabled: bool
    list_poll_interval_sec: int


class CategoryPatch(BaseModel):
    priority: int | None = None
    enabled: bool | None = None
    list_poll_interval_sec: int | None = None

