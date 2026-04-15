from datetime import datetime, timezone

from app.models.topic import Topic
from app.models.topic_snapshot import TopicSnapshot
from app.services.change_detection import diff_topic


def test_diff_topic_detects_changes():
    prev = TopicSnapshot(
        topic_id=1,
        title="Old",
        slug="s",
        url="u",
        author_username="a",
        created_at=None,
        last_posted_at=None,
        bumped_at=None,
        reply_count=0,
        views=0,
        posts_count=1,
        closed=False,
        archived=False,
        pinned=False,
        body_hash="x",
        excerpt="e",
        access_state="ok",
        change_flags={},
        raw_json=None,
    )
    t = Topic(
        external_id=99,
        category_id=None,
        title="New",
        slug="s",
        url="u",
        author_username="a",
        created_at=None,
        last_posted_at=None,
        bumped_at=None,
        reply_count=1,
        views=10,
        posts_count=2,
        closed=False,
        archived=False,
        pinned=False,
        body_hash="y",
        excerpt="e",
        access_state="ok",
        last_list_seen_at=None,
        last_detail_crawl_at=None,
        created_at_db=datetime.now(timezone.utc),
        updated_at_db=datetime.now(timezone.utc),
    )
    res = diff_topic(prev, t, is_new=False)
    assert res.has_changes is True
    assert "title" in res.change_flags
    assert "reply_count" in res.change_flags
    assert "views" in res.change_flags
    assert "body_hash" in res.change_flags

