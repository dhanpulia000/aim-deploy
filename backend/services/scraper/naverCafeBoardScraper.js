/**
 * Naver Cafe 게시판 목록 페이지 스크래퍼
 * 
 * "전체글보기" 페이지에서 게시글 목록을 파싱하여 반환합니다.
 * 
 * 주의사항:
 * - 이 스크래퍼는 Naver Cafe의 robots.txt 및 이용약관을 준수해야 합니다.
 * - NAVER_CAFE_COOKIE 환경 변수를 설정해야 멤버 전용 게시판에 접근할 수 있습니다.
 * - 실제 운영 시에는 Naver의 정책을 확인하고 준수해야 합니다.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../../utils/logger');

const NAVER_CAFE_COOKIE = process.env.NAVER_CAFE_COOKIE || null;

/**
 * Naver Cafe 게시판 목록 페이지에서 게시글 목록 추출
 * 
 * 실제 HTML 구조:
 * <tbody>
 *   <tr class="board-notice type_required">...</tr> <!-- 공지 -->
 *   <tr>
 *     <td>
 *       <div class="board-list">
 *         <div class="inner_list">
 *           <a class="article" href="https://cafe.naver.com/f-e/cafes/29359582/articles/2266023?referrerAllArticles=true">
 *             게시글 제목
 *           </a>
 *         </div>
 *       </div>
 *     </td>
 *     <td class="td_normal type_date">13:59</td>
 *     ...
 *   </tr>
 * </tbody>
 * 
 * @param {string} listUrl - 전체글보기 페이지 URL
 * @param {"PUBG_PC"|"PUBG_MOBILE"} cafeGame - 카페 게임 타입
 * @returns {Promise<Array<{
 *   externalPostId: string;
 *   title: string;
 *   createdAt: Date | null;
 *   authorName: string | null;
 *   articleUrl: string;
 * }>>}
 */
async function fetchNaverCafeBoardPosts(listUrl, cafeGame) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  };

  if (NAVER_CAFE_COOKIE) {
    headers['Cookie'] = NAVER_CAFE_COOKIE;
  }

  try {
    const res = await axios.get(listUrl, {
      headers,
      timeout: 10000,
      maxRedirects: 5
    });

    const html = res.data;
    const $ = cheerio.load(html);
    const posts = [];

    /**
     * 실제 Naver Cafe "전체글보기" 페이지 구조에 맞춘 파싱
     * - tbody > tr 구조
     * - 공지: tr.board-notice 클래스
     * - 게시글 링크: td .board-list .inner_list a.article
     * - 날짜: td.td_normal.type_date
     */
    $('tbody tr').each((_, el) => {
      const row = $(el);

      // 공지 행은 건너뛴다
      if (row.hasClass('board-notice')) {
        return;
      }

      // 실제 게시글 링크 찾기
      const articleLink = row.find('td .board-list .inner_list a.article').first();
      if (!articleLink.length) {
        return;
      }

      const href = articleLink.attr('href') || '';
      if (!href) {
        return;
      }

      // articleId 추출 (URL에서)
      const articleUrl = normalizeArticleUrl(listUrl, href);
      const externalPostId = extractArticleIdFromUrl(articleUrl);
      if (!externalPostId) {
        return;
      }

      const title = articleLink.text().trim();
      if (!title) {
        return;
      }

      // 날짜 파싱
      const dateText = row.find('td.td_normal.type_date').first().text().trim();
      const createdAt = parseNaverDate(dateText);

      // 작성자 (선택적, 구조에 따라 다를 수 있음)
      const authorName = row.find('td .author, td .nickname, td .td_name').first().text().trim() || null;

      posts.push({
        externalPostId,
        title,
        articleUrl,
        createdAt,
        authorName
      });
    });

    logger.debug('[NaverCafeBoardScraper] Parsed posts', {
      listUrl,
      cafeGame,
      count: posts.length
    });

    return posts;
  } catch (error) {
    logger.error('[NaverCafeBoardScraper] Failed to fetch board list', {
      listUrl,
      cafeGame,
      error: error.message
    });
    throw new Error(`Failed to fetch Naver Cafe board list: ${error.message}`);
  }
}

/**
 * URL에서 articleId 추출
 * 
 * 지원 형식:
 * - https://cafe.naver.com/f-e/cafes/29359582/articles/2266023?referrerAllArticles=true
 * - /f-e/cafes/29359582/articles/2266023
 * - ?articleid=2266023
 * 
 * @param {string} url - 게시글 URL
 * @returns {string} articleId 또는 null
 */
function extractArticleIdFromUrl(url) {
  if (!url) return null;
  
  try {
    // 방법 1: URL 경로에서 /articles/{articleId} 패턴 추출
    const pathMatch = url.match(/\/articles\/(\d+)/);
    if (pathMatch) {
      return pathMatch[1];
    }

    // 방법 2: 쿼리 파라미터에서 추출
    const u = new URL(url, 'https://cafe.naver.com');
    const articleId = u.searchParams.get('articleid') || 
                      u.searchParams.get('articleId') || 
                      u.searchParams.get('article');
    if (articleId) {
      return articleId;
    }

    // 방법 3: 상대 경로인 경우 직접 파싱
    const queryMatch = url.match(/[?&]articleid=(\d+)/i) || 
                       url.match(/[?&]articleId=(\d+)/i) ||
                       url.match(/[?&]article=(\d+)/i);
    if (queryMatch) {
      return queryMatch[1];
    }

    return null;
  } catch {
    // URL 파싱 실패 시 정규식으로만 시도
    const match = url.match(/\/articles\/(\d+)/) ||
                  url.match(/[?&]articleid=(\d+)/i) ||
                  url.match(/[?&]articleId=(\d+)/i);
    return match ? match[1] : null;
  }
}

/**
 * 상대 경로를 절대 URL로 변환
 * @param {string} listUrl - 게시판 목록 페이지 URL
 * @param {string} href - 게시글 링크 (상대 또는 절대)
 * @returns {string} 절대 URL
 */
function normalizeArticleUrl(listUrl, href) {
  if (!href) return listUrl;
  
  try {
    // 이미 절대 URL인 경우
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href;
    }

    const base = new URL(listUrl);
    
    // 절대 경로인 경우
    if (href.startsWith('/')) {
      return `${base.origin}${href}`;
    }

    // 상대 경로인 경우
    const basePath = base.pathname.replace(/\/[^/]*$/, '/');
    return `${base.origin}${basePath}${href}`;
  } catch (error) {
    logger.warn('[NaverCafeBoardScraper] Failed to normalize URL', {
      listUrl,
      href,
      error: error.message
    });
    return href;
  }
}

/**
 * Naver Cafe 날짜 문자열을 Date 객체로 파싱
 * 
 * 지원 형식:
 * - "2025.01.02 13:59" (YYYY.MM.DD HH:MM)
 * - "13:59" (HH:MM - 오늘 날짜로 간주)
 * 
 * @param {string} text - 날짜 문자열
 * @returns {Date | null} 파싱된 날짜 또는 null
 */
function parseNaverDate(text) {
  if (!text) return null;

  const trimmed = text.trim();
  const now = new Date();

  // 형식 1: "YYYY.MM.DD HH:MM"
  const fullDateMatch = trimmed.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (fullDateMatch) {
    const [, year, month, day, hour, minute] = fullDateMatch;
    return new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10)
    );
  }

  // 형식 2: "HH:MM" (오늘 날짜로 간주)
  const timeMatch = trimmed.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const [, hour, minute] = timeMatch;
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      parseInt(hour, 10),
      parseInt(minute, 10)
    );
  }

  logger.warn('[NaverCafeBoardScraper] Failed to parse date', { text: trimmed });
  return null;
}

module.exports = {
  fetchNaverCafeBoardPosts,
  extractArticleIdFromUrl,
  normalizeArticleUrl,
  parseNaverDate
};

