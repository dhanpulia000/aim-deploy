from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "categories",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("external_id", sa.BigInteger(), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=True),
        sa.Column("read_restricted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("external_id", name="uq_categories_external_id"),
        sa.UniqueConstraint("slug", name="uq_categories_slug"),
    )
    op.create_index("ix_categories_position", "categories", ["position"])

    op.create_table(
        "tags",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="uq_tags_name"),
    )

    op.create_table(
        "topics",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("external_id", sa.BigInteger(), nullable=False),
        sa.Column("category_id", sa.BigInteger(), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("author_username", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("bumped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reply_count", sa.Integer(), nullable=True),
        sa.Column("views", sa.Integer(), nullable=True),
        sa.Column("posts_count", sa.Integer(), nullable=True),
        sa.Column("closed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("body_hash", sa.String(length=64), nullable=True),
        sa.Column("excerpt", sa.Text(), nullable=True),
        sa.Column("access_state", sa.String(length=32), nullable=False, server_default="ok"),
        sa.Column("last_list_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_detail_crawl_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at_db", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at_db", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("external_id", name="uq_topics_external_id"),
    )
    op.create_index("ix_topics_last_posted_at", "topics", ["last_posted_at"])
    op.create_index("ix_topics_access_state", "topics", ["access_state"])

    op.create_table(
        "topic_tags",
        sa.Column("topic_id", sa.BigInteger(), sa.ForeignKey("topics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tag_id", sa.BigInteger(), sa.ForeignKey("tags.id", ondelete="CASCADE"), nullable=False),
        sa.PrimaryKeyConstraint("topic_id", "tag_id", name="pk_topic_tags"),
    )
    op.create_index("ix_topic_tags_tag_id", "topic_tags", ["tag_id"])

    op.create_table(
        "topic_snapshots",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("topic_id", sa.BigInteger(), sa.ForeignKey("topics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("author_username", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("bumped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reply_count", sa.Integer(), nullable=True),
        sa.Column("views", sa.Integer(), nullable=True),
        sa.Column("posts_count", sa.Integer(), nullable=True),
        sa.Column("closed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("body_hash", sa.String(length=64), nullable=True),
        sa.Column("excerpt", sa.Text(), nullable=True),
        sa.Column("access_state", sa.String(length=32), nullable=False, server_default="ok"),
        sa.Column("change_flags", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("raw_json", sa.JSON(), nullable=True),
    )
    op.create_index("ix_topic_snapshots_topic_id_captured_at", "topic_snapshots", ["topic_id", "captured_at"])

    op.create_table(
        "crawl_jobs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("job_type", sa.String(length=64), nullable=False),
        sa.Column("trigger", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stats", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    op.create_index("ix_crawl_jobs_job_type_started_at", "crawl_jobs", ["job_type", "started_at"])

    op.create_table(
        "crawl_logs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("crawl_job_id", sa.BigInteger(), sa.ForeignKey("crawl_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("level", sa.String(length=16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("context", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    op.create_index("ix_crawl_logs_crawl_job_id_created_at", "crawl_logs", ["crawl_job_id", "created_at"])

    op.create_table(
        "daily_trend_reports",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("report_date", name="uq_daily_trend_reports_report_date"),
    )


def downgrade() -> None:
    op.drop_table("daily_trend_reports")
    op.drop_index("ix_crawl_logs_crawl_job_id_created_at", table_name="crawl_logs")
    op.drop_table("crawl_logs")
    op.drop_index("ix_crawl_jobs_job_type_started_at", table_name="crawl_jobs")
    op.drop_table("crawl_jobs")
    op.drop_index("ix_topic_snapshots_topic_id_captured_at", table_name="topic_snapshots")
    op.drop_table("topic_snapshots")
    op.drop_index("ix_topic_tags_tag_id", table_name="topic_tags")
    op.drop_table("topic_tags")
    op.drop_index("ix_topics_access_state", table_name="topics")
    op.drop_index("ix_topics_last_posted_at", table_name="topics")
    op.drop_table("topics")
    op.drop_table("tags")
    op.drop_index("ix_categories_position", table_name="categories")
    op.drop_table("categories")

