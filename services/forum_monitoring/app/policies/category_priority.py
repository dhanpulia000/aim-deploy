from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CategoryPolicy:
    priority: int  # 0=P0,1=P1,2=P2
    list_poll_interval_sec: int


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def policy_for_category(*, name: str, slug: str) -> CategoryPolicy | None:
    """
    초기 운영 기본값.
    - name/slug 기반 휴리스틱 매핑 (Discourse에서 이름은 바뀔 수 있어도 초기 부트스트랩에 유용)
    - 이후에는 API로 Category 설정을 직접 조정하는 것을 권장
    """
    key = _norm(slug) or _norm(name)

    # P0 (2~5분)
    if key in {"notice", "announcements"}:
        return CategoryPolicy(priority=0, list_poll_interval_sec=180)
    if "bug" in key:
        return CategoryPolicy(priority=0, list_poll_interval_sec=180)
    if "technical" in key or "help" in key:
        return CategoryPolicy(priority=0, list_poll_interval_sec=300)

    # P1 (10~15분)
    if "wishlist" in key:
        return CategoryPolicy(priority=1, list_poll_interval_sec=900)
    if key in {"q-a", "q&a", "qa", "questions"} or "q&a" in key:
        return CategoryPolicy(priority=1, list_poll_interval_sec=900)

    # P2 (30~60분)
    if "tips" in key or "guides" in key:
        return CategoryPolicy(priority=2, list_poll_interval_sec=3600)
    if "brainstorm" in key:
        return CategoryPolicy(priority=2, list_poll_interval_sec=3600)

    return None

