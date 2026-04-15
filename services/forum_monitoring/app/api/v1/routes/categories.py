from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.category import Category
from app.schemas.category import CategoryOut, CategoryPatch
from app.workers.tasks import bootstrap_category_policies, sync_categories

router = APIRouter()


@router.get("", response_model=list[CategoryOut])
async def get_categories(session: AsyncSession = Depends(get_session)):
    cats = (await session.execute(select(Category).order_by(Category.priority, Category.position, Category.id))).scalars().all()
    return [
        CategoryOut(
            id=c.id,
            source=c.source,
            external_category_id=c.external_category_id,
            name=c.name,
            slug=c.slug,
            is_restricted=c.is_restricted,
            position=c.position,
            priority=c.priority,
            enabled=c.enabled,
            list_poll_interval_sec=c.list_poll_interval_sec,
        )
        for c in cats
    ]


@router.patch("/{category_id}", response_model=CategoryOut)
async def patch_category(
    category_id: int,
    patch: CategoryPatch,
    session: AsyncSession = Depends(get_session),
):
    row = (await session.execute(select(Category).where(Category.id == category_id).limit(1))).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Category not found")

    if patch.priority is not None:
        row.priority = int(patch.priority)
    if patch.enabled is not None:
        row.enabled = bool(patch.enabled)
    if patch.list_poll_interval_sec is not None:
        row.list_poll_interval_sec = int(patch.list_poll_interval_sec)

    await session.commit()
    return CategoryOut(
        id=row.id,
        source=row.source,
        external_category_id=row.external_category_id,
        name=row.name,
        slug=row.slug,
        is_restricted=row.is_restricted,
        position=row.position,
        priority=row.priority,
        enabled=row.enabled,
        list_poll_interval_sec=row.list_poll_interval_sec,
    )


@router.post("/bootstrap")
async def bootstrap_policies():
    async_result = bootstrap_category_policies.delay()
    return {"task_id": async_result.id}


@router.post("/sync")
async def sync_categories_now():
    async_result = sync_categories.delay()
    return {"task_id": async_result.id}

