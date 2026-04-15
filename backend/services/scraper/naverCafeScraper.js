/**
 * Naver Cafe 포스트 스크래퍼
 * 
 * 주의사항:
 * - 이 스크래퍼는 Naver Cafe의 robots.txt 및 이용약관을 준수해야 합니다.
 * - NAVER_CAFE_COOKIE 환경 변수를 설정해야 멤버 전용 게시글에 접근할 수 있습니다.
 * - 쿠키는 브라우저 개발자 도구(F12) > Network 탭 > 요청 헤더에서 복사할 수 있습니다.
 * - 실제 운영 시에는 Naver의 정책을 확인하고 준수해야 합니다.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../../utils/logger');

/**
 * URL에서 article ID 추출
 * @param {string} url - Naver Cafe 포스트 URL
 * @returns {string} article ID 또는 원본 URL
 */
function extractArticleIdFromUrl(url) {
  try {
    const u = new URL(url);
    const id = u.searchParams.get('articleid') || u.searchParams.get('articleId') || u.searchParams.get('article');
    return id || url;
  } catch {
    return url;
  }
}

/**
 * Naver Cafe 포스트 HTML 파싱하여 제목, 내용, 댓글 추출
 * 
 * @param {string} url - 전체 포스트 URL
 * @param {"PUBG_PC" | "PUBG_MOBILE"} cafeGame - 카페 게임 타입
 * @returns {Promise<{
 *   post: {
 *     externalPostId: string;
 *     title: string;
 *     content: string;
 *     createdAt: Date | null;
 *     authorName?: string | null;
 *   };
 *   comments: Array<{
 *     externalCommentId: string;
 *     content: string;
 *     createdAt: Date | null;
 *     authorName?: string | null;
 *   }>;
 * }>}
 */
async function fetchNaverCafePost(url, cafeGame) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  };

  // 쿠키 설정 (환경 변수에서 읽기)
  if (process.env.NAVER_CAFE_COOKIE) {
    headers['Cookie'] = process.env.NAVER_CAFE_COOKIE;
  }

  try {
    const res = await axios.get(url, { 
      headers,
      timeout: 10000, // 10초 타임아웃
      maxRedirects: 5
    });

    const html = res.data;
    const $ = cheerio.load(html);

    // 제목 추출 (여러 방법 시도)
    let title = $('meta[property="og:title"]').attr('content') || 
                $('meta[name="title"]').attr('content') ||
                $('.title_text, .article_title, .ArticleTitle').first().text().trim() ||
                $('title').text().trim();

    // 내용 추출
    let content = '';
    const contentSelectors = [
      '#articleBodyContents',
      '.article_view',
      '.ArticleContent',
      '#content-area',
      '.se-main-container',
      '.se-component-content'
    ];

    for (const selector of contentSelectors) {
      const contentNode = $(selector);
      if (contentNode.length > 0) {
        // 스크립트 태그 제거
        contentNode.find('script').remove();
        content = contentNode.text().trim();
        if (content.length > 50) break; // 충분한 내용이 있으면 중단
      }
    }

    // 작성일 추출
    let createdAt = null;
    const dateSelectors = [
      '.article_info .date',
      '.date',
      'time[datetime]',
      '.ArticleInfo .date'
    ];

    for (const selector of dateSelectors) {
      const dateNode = $(selector);
      if (dateNode.length > 0) {
        const dateText = dateNode.attr('datetime') || dateNode.text().trim();
        if (dateText) {
          try {
            createdAt = new Date(dateText);
            if (isNaN(createdAt.getTime())) {
              // 한국어 날짜 형식 파싱 시도 (예: "2024.01.01 12:00")
              const koreanDateMatch = dateText.match(/(\d{4})[.\s-](\d{1,2})[.\s-](\d{1,2})[\s](\d{1,2}):(\d{1,2})/);
              if (koreanDateMatch) {
                const [, year, month, day, hour, minute] = koreanDateMatch;
                createdAt = new Date(year, month - 1, day, hour, minute);
              }
            }
            if (!isNaN(createdAt.getTime())) break;
          } catch (e) {
            // 파싱 실패 무시
          }
        }
      }
    }

    // 작성자 추출
    let authorName = null;
    const authorSelectors = [
      '.article_info .nick',
      '.nickname',
      '.author',
      '.ArticleInfo .nick'
    ];

    for (const selector of authorSelectors) {
      const authorNode = $(selector).first();
      if (authorNode.length > 0) {
        authorName = authorNode.text().trim();
        if (authorName) break;
      }
    }

    // 댓글 추출
    const comments = [];
    const commentSelectors = [
      '.CommentItem',
      '.comment_item',
      '.CommentListItem',
      'li[data-comment-id]'
    ];

    for (const selector of commentSelectors) {
      const commentNodes = $(selector);
      if (commentNodes.length > 0) {
        commentNodes.each((i, elem) => {
          const $comment = $(elem);
          const commentId = $comment.attr('data-comment-id') || 
                           $comment.attr('id') || 
                           `comment_${i}`;
          
          const commentContent = $comment.find('.comment_text, .comment_content, .CommentText').text().trim();
          if (!commentContent) return;

          let commentDate = null;
          const commentDateNode = $comment.find('.comment_date, .date, time');
          if (commentDateNode.length > 0) {
            const dateText = commentDateNode.attr('datetime') || commentDateNode.text().trim();
            if (dateText) {
              try {
                commentDate = new Date(dateText);
                if (isNaN(commentDate.getTime())) {
                  const koreanDateMatch = dateText.match(/(\d{4})[.\s-](\d{1,2})[.\s-](\d{1,2})[\s](\d{1,2}):(\d{1,2})/);
                  if (koreanDateMatch) {
                    const [, year, month, day, hour, minute] = koreanDateMatch;
                    commentDate = new Date(year, month - 1, day, hour, minute);
                  }
                }
              } catch (e) {
                // 파싱 실패 무시
              }
            }
          }

          const commentAuthor = $comment.find('.nickname, .nick, .author').first().text().trim() || null;

          comments.push({
            externalCommentId: commentId,
            content: commentContent,
            createdAt: commentDate,
            authorName: commentAuthor
          });
        });
        break; // 첫 번째 매칭된 선택자 사용
      }
    }

    const externalPostId = extractArticleIdFromUrl(url);

    return {
      post: {
        externalPostId,
        title: title || '제목 없음',
        content: content || '',
        createdAt: createdAt || new Date(),
        authorName: authorName || null
      },
      comments: comments
    };
  } catch (error) {
    logger.error('[NaverCafeScraper] Failed to fetch post', { 
      url, 
      error: error.message,
      stack: error.stack
    });
    throw new Error(`Failed to fetch Naver Cafe post: ${error.message}`);
  }
}

module.exports = {
  fetchNaverCafePost,
  extractArticleIdFromUrl
};












