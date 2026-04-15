"""backfill topics.first_seen_at from last_list_seen_at

Revision ID: 004_backfill_first_seen_from_list_seen
Revises: 003_add_topic_first_seen_at
Create Date: 2026-04-13
"""

from __future__ import annotations

from alembic import op


revision = "004_backfill_first_seen_from_list_seen"
down_revision = "003_add_topic_first_seen_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Prefer system-observed time (last_list_seen_at) for first_seen backfill.
    op.execute(
        """
        UPDATE topics
        SET first_seen_at = last_list_seen_at
        WHERE last_list_seen_at IS NOT NULL
          AND (first_seen_at IS NULL OR first_seen_at < last_list_seen_at)
        """
    )


def downgrade() -> None:
    # no-op
    pass

