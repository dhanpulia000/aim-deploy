from fastapi import APIRouter

from app.api.v1.routes.health import router as health_router
from app.api.v1.routes.categories import router as categories_router
from app.api.v1.routes.topics import router as topics_router
from app.api.v1.routes.reports import router as reports_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(categories_router, prefix="/categories", tags=["categories"])
api_router.include_router(topics_router, prefix="/topics", tags=["topics"])
api_router.include_router(reports_router, prefix="/reports", tags=["reports"])

