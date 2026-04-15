"""add topics.first_seen_at

Revision ID: 003_add_topic_first_seen_at
Revises: 002_add_crawl_runs
Create Date: 2026-04-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "003_add_topic_first_seen_at"
down_revision = "002_add_crawl_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("topics", sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True))
    # backfill: if topic_created_at exists, use that; else use last_list_seen_at
    op.execute(
        """
        UPDATE topics
        SET first_seen_at = COALESCE(first_seen_at, topic_created_at, last_list_seen_at)
        """
    )


def downgrade() -> None:
    op.drop_column("topics", "first_seen_at")

