from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher


_RE_VERSION = re.compile(r"\b(v?\d+(?:\.\d+){1,3})\b", re.IGNORECASE)
_RE_WORD = re.compile(r"[a-z0-9]+", re.IGNORECASE)

STOPWORDS = {
    "a",
    "an",
    "the",
    "to",
    "and",
    "or",
    "of",
    "for",
    "in",
    "on",
    "with",
    "is",
    "are",
    "was",
    "were",
    "it",
    "this",
    "that",
    "i",
    "we",
    "you",
    "my",
    "our",
    "your",
    "please",
    "help",
    "issue",
    "bug",
    "report",
    "crash",
}


def normalize_title(title: str) -> str:
    s = (title or "").lower().strip()
    s = re.sub(r"\s+", " ", s)
    return s


def extract_versions(text: str) -> list[str]:
    return [m.group(1).lower() for m in _RE_VERSION.finditer(text or "")]


def tokenize(text: str) -> set[str]:
    words = {w.group(0).lower() for w in _RE_WORD.finditer(text or "")}
    return {w for w in words if w not in STOPWORDS and len(w) >= 2}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


@dataclass(frozen=True)
class SimilarityCandidate:
    topic_id_a: int
    topic_id_b: int
    score: float
    reason: str


def compute_similarity(
    *,
    id_a: int,
    title_a: str,
    id_b: int,
    title_b: str,
) -> SimilarityCandidate:
    na = normalize_title(title_a)
    nb = normalize_title(title_b)

    ta = tokenize(na)
    tb = tokenize(nb)
    jac = jaccard(ta, tb)
    seq = SequenceMatcher(None, na, nb).ratio()

    va = set(extract_versions(na))
    vb = set(extract_versions(nb))
    version_bonus = 0.1 if (va & vb) else 0.0

    score = max(jac, seq) + version_bonus
    score = min(1.0, score)
    reason = f"jaccard={jac:.2f}, seq={seq:.2f}, versions_common={bool(va & vb)}"
    return SimilarityCandidate(topic_id_a=id_a, topic_id_b=id_b, score=score, reason=reason)


def find_candidates(
    topics: list[tuple[int, str]],
    *,
    min_score: float = 0.72,
    max_pairs: int = 50,
) -> list[SimilarityCandidate]:
    """
    O(n^2) MVP: 최근 토픽 subset에만 적용하는 전제로 제한.
    topics: [(topic_id, title)]
    """
    out: list[SimilarityCandidate] = []
    n = len(topics)
    for i in range(n):
        id_a, title_a = topics[i]
        for j in range(i + 1, n):
            id_b, title_b = topics[j]
            cand = compute_similarity(id_a=id_a, title_a=title_a, id_b=id_b, title_b=title_b)
            if cand.score >= min_score:
                out.append(cand)
                if len(out) >= max_pairs:
                    return sorted(out, key=lambda x: x.score, reverse=True)
    return sorted(out, key=lambda x: x.score, reverse=True)

