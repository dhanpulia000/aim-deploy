from app.services.similarity import compute_similarity, find_candidates


def test_similarity_basic():
    c = compute_similarity(id_a=1, title_a="Crash on v1.2.3 when opening menu", id_b=2, title_b="Menu crash v1.2.3")
    assert c.score >= 0.7


def test_find_candidates():
    topics = [
        (1, "Game crashes on start v1.2.0"),
        (2, "Crash on start v1.2.0"),
        (3, "How to change language"),
    ]
    out = find_candidates(topics, min_score=0.7)
    assert any((x.topic_id_a, x.topic_id_b) == (1, 2) for x in out)

