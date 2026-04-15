/**
 * 클랜 워커(naverCafeClan)가 실제로 여는 목록 URL.
 * MonitoredBoard 행이 부모판·전체글(menus/0)이어도 클랜 전용 메뉴로 보정 — API 표시와 워커가 동일해야 함.
 */
const CLAN_CLUB_ID = 28866679;
const CLAN_MENU_ID = 178;
const CLAN_BASE_LIST_URL = `https://cafe.naver.com/f-e/cafes/${CLAN_CLUB_ID}/menus/${CLAN_MENU_ID}`;

function isLikelyWholeCafeOrMenuZeroListUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (/\/menus\/0(\?|\/|$|#)/.test(url)) return true;
  if (/[?&]search\.menuid=0(?:&|$|#)/.test(url)) return true;
  return false;
}

/**
 * @param {{ url?: string | null; listUrl?: string | null }} board - MonitoredBoard 행 일부
 */
function getResolvedClanBoardListUrl(board) {
  const fromEnv = process.env.NAVER_CAFE_CLAN_LIST_URL;
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv).trim();
  }
  const b = board || {};
  let candidate = b.url || b.listUrl || CLAN_BASE_LIST_URL;
  if (isLikelyWholeCafeOrMenuZeroListUrl(candidate)) {
    return CLAN_BASE_LIST_URL;
  }
  return candidate;
}

module.exports = {
  CLAN_CLUB_ID,
  CLAN_MENU_ID,
  CLAN_BASE_LIST_URL,
  isLikelyWholeCafeOrMenuZeroListUrl,
  getResolvedClanBoardListUrl
};
