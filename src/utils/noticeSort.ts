/**
 * 종료 처리된 공지(endedAt 있음)를 목록 맨 아래로 보냅니다.
 * 같은 구간 안에서는 공지일(noticeDate) 최신순.
 */
export function sortFeedbackNoticesEndedLast<
  T extends { endedAt?: string | null; noticeDate?: string | null }
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const aEnded = !!(a.endedAt && String(a.endedAt).trim());
    const bEnded = !!(b.endedAt && String(b.endedAt).trim());
    if (aEnded !== bEnded) return aEnded ? 1 : -1;
    return (b.noticeDate || "").localeCompare(a.noticeDate || "");
  });
}
