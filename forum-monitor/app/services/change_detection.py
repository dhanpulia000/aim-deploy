from __future__ import annotations

from dataclasses import dataclass

from app.models.topic import Topic
from app.models.topic_snapshot import TopicSnapshot


@dataclass(frozen=True)
class ChangeResult:
    is_new: bool
    has_changes: bool
    change_flags: dict


def diff_topic(previous: TopicSnapshot | None, current: Topic, *, is_new: bool) -> ChangeResult:
    flags: dict[str, object] = {}
    if is_new:
        flags["new_topic"] = True
        return ChangeResult(is_new=True, has_changes=True, change_flags=flags)

    if previous is None:
        flags["no_previous_snapshot"] = True
        return ChangeResult(is_new=False, has_changes=True, change_flags=flags)

    def changed(name: str, old: object, new: object) -> None:
        if old != new:
            flags[name] = {"from": old, "to": new}

    changed("title", previous.title, current.title)
    changed("slug", previous.slug, current.slug)
    changed("author_username", previous.author_username, current.author_username)
    changed("last_posted_at", previous.last_posted_at, current.last_posted_at)
    changed("bumped_at", previous.bumped_at, current.bumped_at)
    changed("reply_count", previous.reply_count, current.reply_count)
    changed("views", previous.views, current.views)
    changed("posts_count", previous.posts_count, current.posts_count)
    changed("closed", previous.closed, current.closed)
    changed("archived", previous.archived, current.archived)
    changed("pinned", previous.pinned, current.pinned)
    changed("body_hash", previous.body_hash, current.body_hash)
    changed("access_state", previous.access_state, current.access_state)
    # excerpt is noisy but still useful
    changed("excerpt", previous.excerpt, current.excerpt)

    return ChangeResult(is_new=False, has_changes=bool(flags), change_flags=flags)

