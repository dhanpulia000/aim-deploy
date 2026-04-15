from app.crawlers.discourse.mappers import map_topic_detail


def test_map_topic_detail_body_hash_stable():
    raw = {
        "id": 123,
        "slug": "test-topic",
        "title": "Title",
        "fancy_title": "Fancy Title",
        "created_at": "2026-04-13T00:00:00.000Z",
        "last_posted_at": "2026-04-13T01:00:00.000Z",
        "views": 10,
        "reply_count": 1,
        "posts_count": 2,
        "tags": ["Bug", "Crash"],
        "post_stream": {
            "posts": [
                {
                    "post_number": 1,
                    "username": "alice",
                    "created_at": "2026-04-13T00:00:00.000Z",
                    "cooked": "<p>Hello <b>world</b></p>",
                }
            ]
        },
    }
    d = map_topic_detail("https://forum.playinzoi.com", raw)
    assert d.external_id == 123
    assert d.title == "Fancy Title"
    assert d.author_username == "alice"
    assert d.body_text == "Hello world"
    assert len(d.body_hash) == 64

