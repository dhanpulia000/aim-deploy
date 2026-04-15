"""initial schema

Revision ID: 001_initial
Revises:
Create Date: 2026-04-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "categories",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("external_category_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("parent_external_category_id", sa.BigInteger(), nullable=True),
        sa.Column("is_restricted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("position", sa.Integer(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("list_poll_interval_sec", sa.Integer(), nullable=False, server_default=sa.text("600")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source", "external_category_id", name="uq_categories_source_external_id"),
    )

    op.create_table(
        "tags",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("tag_type", sa.String(length=16), nullable=False, server_default=sa.text("'DOMAIN'")),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source", "name", name="uq_tags_source_name"),
    )

    op.create_table(
        "topics",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("external_topic_id", sa.BigInteger(), nullable=False),
        sa.Column("category_id", sa.BigInteger(), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=True),
        sa.Column("author_username", sa.String(length=255), nullable=True),
        sa.Column("topic_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("bumped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("views", sa.Integer(), nullable=True),
        sa.Column("like_count", sa.Integer(), nullable=True),
        sa.Column("reply_count", sa.Integer(), nullable=True),
        sa.Column("posts_count", sa.Integer(), nullable=True),
        sa.Column("closed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("visible", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tags_hash", sa.String(length=64), nullable=True),
        sa.Column("status_hash", sa.String(length=64), nullable=True),
        sa.Column("last_list_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_detail_crawled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_snapshot_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source", "external_topic_id", name="uq_topics_source_external_id"),
    )

    op.create_table(
        "topic_tags",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("topic_id", sa.BigInteger(), sa.ForeignKey("topics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag_id", sa.BigInteger(), sa.ForeignKey("tags.id", ondelete="CASCADE"), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("topic_id", "tag_id", name="uq_topic_tags_topic_tag"),
    )

    op.create_table(
        "posts",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("external_post_id", sa.BigInteger(), nullable=False),
        sa.Column("topic_id", sa.BigInteger(), sa.ForeignKey("topics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("post_number", sa.Integer(), nullable=False),
        sa.Column("author_username", sa.String(length=255), nullable=True),
        sa.Column("post_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("post_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("edit_count", sa.Integer(), nullable=True),
        sa.Column("last_edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw", sa.Text(), nullable=True),
        sa.Column("cooked_html", sa.Text(), nullable=True),
        sa.Column("cooked_text", sa.Text(), nullable=True),
        sa.Column("normalized_text", sa.Text(), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("normalize_version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("has_images", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("has_links", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("has_code_block", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source", "external_post_id", name="uq_posts_source_external_id"),
    )

    op.create_table(
        "topic_snapshots",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("topic_id", sa.BigInteger(), sa.ForeignKey("topics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("captured_bucket_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("category_id", sa.BigInteger(), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("views", sa.Integer(), nullable=True),
        sa.Column("like_count", sa.Integer(), nullable=True),
        sa.Column("reply_count", sa.Integer(), nullable=True),
        sa.Column("posts_count", sa.Integer(), nullable=True),
        sa.Column("last_posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("bumped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("visible", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("tags_hash", sa.String(length=64), nullable=True),
        sa.Column("status_hash", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("topic_id", "captured_bucket_at", name="uq_topic_snapshots_topic_bucket"),
    )

    op.create_table(
        "category_scan_states",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("category_id", sa.BigInteger(), sa.ForeignKey("categories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("last_seen_bumped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_topic_id", sa.BigInteger(), nullable=True),
        sa.Column("last_page", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("state_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source", "category_id", name="uq_category_scan_states_source_category"),
    )

    op.create_table(
        "daily_trend_reports",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("date_kst", sa.String(length=10), nullable=False),
        sa.Column("window_start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("category_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("hot_topics", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("new_topics", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("reactivated_topics", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("tag_trends", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source", "date_kst", name="uq_daily_trend_reports_source_date"),
    )


def downgrade() -> None:
    op.drop_table("daily_trend_reports")
    op.drop_table("category_scan_states")
    op.drop_table("topic_snapshots")
    op.drop_table("posts")
    op.drop_table("topic_tags")
    op.drop_table("topics")
    op.drop_table("tags")
    op.drop_table("categories")

