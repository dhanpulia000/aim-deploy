from __future__ import annotations

import re


_RE_STRIP_SCRIPT = re.compile(r"<script[\s\S]*?</script>", re.IGNORECASE)
_RE_STRIP_STYLE = re.compile(r"<style[\s\S]*?</style>", re.IGNORECASE)
_RE_TAGS = re.compile(r"<[^>]+>")
_RE_WS = re.compile(r"\s+")
_RE_CODEBLOCK = re.compile(r"```[\s\S]*?```", re.MULTILINE)
_RE_URL = re.compile(r"https?://\S+")


def strip_html(html: str) -> str:
    if not html:
        return ""
    s = _RE_STRIP_SCRIPT.sub(" ", html)
    s = _RE_STRIP_STYLE.sub(" ", s)
    s = _RE_TAGS.sub(" ", s)
    s = (
        s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    return _RE_WS.sub(" ", s).strip()


def derive_flags(text: str) -> dict[str, bool]:
    if not text:
        return {"has_links": False, "has_code_block": False}
    return {
        "has_links": bool(_RE_URL.search(text)),
        "has_code_block": bool(_RE_CODEBLOCK.search(text)),
    }


def normalize_for_hash(text: str) -> str:
    """
    Hash 안정성을 위한 최소 정규화.
    - 공백 정리
    - 링크는 그대로 두되, trailing punctuation 등 노이즈는 최소화(여기서는 과도한 변형을 피함)
    """
    if not text:
        return ""
    s = _RE_WS.sub(" ", text).strip()
    return s

