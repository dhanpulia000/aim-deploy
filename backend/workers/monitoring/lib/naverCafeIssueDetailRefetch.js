/**
 * 네이버 카페 단일 게시글 상세에서 댓글 수·스크랩 댓글 재수집
 * (naverCafe.worker.js 로직 축약 공유)
 */

/* eslint-env browser */
/* global document */
const { retryBrowserOperation } = require('../../../utils/retry');
const logger = require('../../../utils/logger');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function loadNaverCafeCookie() {
  if (process.env.NAVER_CAFE_COOKIE) {
    return process.env.NAVER_CAFE_COOKIE;
  }
  try {
    const { queryOne } = require('../../../libs/db');
    const config = queryOne('SELECT * FROM MonitoringConfig WHERE key = ?', ['naverCafeCookie']);
    if (config && config.value) {
      return config.value;
    }
  } catch (e) {
    logger.warn('[naverCafeIssueDetailRefetch] Failed to load cookie from DB', { error: e.message });
  }
  return null;
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} articleUrl
 * @param {{ cookie?: string|null }} [options]
 * @returns {Promise<{ ok: boolean, commentCount?: number, scrapedComments?: string|null, requiresLogin?: boolean, error?: string }>}
 */
async function refetchNaverCafeIssueDetail(browser, articleUrl, options = {}) {
  const cookie = options.cookie !== undefined ? options.cookie : await loadNaverCafeCookie();
  const page = await browser.newPage();
  try {
    if (cookie) {
      const cookies = cookie.split(';').map((cookieStr) => {
        const [name, value] = cookieStr.trim().split('=');
        return {
          name: name.trim(),
          value: value?.trim() || '',
          domain: '.naver.com',
          path: '/'
        };
      }).filter((c) => c.name && c.value);

      if (cookies.length > 0) {
        await page.context().addCookies(cookies);
      }
    }

    await page.setExtraHTTPHeaders({
      'User-Agent': getRandomUserAgent()
    });

    await retryBrowserOperation(
      () =>
        page.goto(articleUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        }),
      {
        maxRetries: 2,
        initialDelay: 2000,
        maxDelay: 8000,
        onRetry: (attempt, error, delay) => {
          logger.warn(`[IssueDetailRefetch] goto retry ${attempt}`, { url: articleUrl, error: error.message, delay });
          return delay;
        }
      }
    );

    await page.waitForTimeout(2000);

    // 네이버 카페 상세는 대부분 iframe#cafe_main 안에 본문/댓글이 들어가므로
    // 가능한 경우 iframe context를 평가 컨텍스트로 사용한다.
    const iframeSelectors = [
      'iframe#cafe_main',
      'iframe#cafe_main_original',
      'iframe[name="cafe_main"]'
    ];

    let context = page;
    for (const selector of iframeSelectors) {
      try {
        const iframeHandle = await page.$(selector);
        if (iframeHandle) {
          const frame = await iframeHandle.contentFrame();
          if (frame) {
            context = frame;
            break;
          }
        }
      } catch {
        // ignore and fallback to top page
      }
    }

    let requiresLogin = false;
    try {
      requiresLogin = await context.evaluate(() => {
        const text = document.body?.innerText || '';
        return /로그인이 필요합니다|회원만 볼 수 있습니다/i.test(text);
      });
    } catch {
      /* ignore */
    }

    if (requiresLogin && !cookie) {
      return { ok: false, requiresLogin: true, error: 'Login required (set NAVER_CAFE_COOKIE)' };
    }

    // 댓글 영역 로딩 대기 (iframe context 기준)
    await retryBrowserOperation(
      async () => {
        const commentSelectors = [
          '.CommentBox',
          '.comment_area',
          '.comment_box',
          '#comment_area',
          '.CommentList',
          '.comment_list',
          '[class*="comment"]',
          '[id*="comment"]'
        ];
        for (const selector of commentSelectors) {
          try {
            if (typeof context.waitForSelector === 'function') {
              await context.waitForSelector(selector, { timeout: 4000 });
              const el = await context.$(selector).catch(() => null);
              if (el) return el;
            }
          } catch {
            /* next */
          }
        }
        return null;
      },
      {
        maxRetries: 1,
        initialDelay: 1000,
        maxDelay: 3000,
        onRetry: () => 1000
      }
    ).catch(() => null);

    const comments = await context.evaluate(() => {
      const out = [];
      const commentSelectors = [
        '.CommentItem',
        '.comment_item',
        '.CommentBox .comment',
        '.comment_area .comment',
        'li[class*="comment"]',
        '.comment_list li',
        '[class*="Comment"]'
      ];

      for (const selector of commentSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          elements.forEach((el, index) => {
            const text = el.textContent?.trim() || '';
            const author =
              el.querySelector('.nickname, .nick, .author, [class*="nick"]')?.textContent?.trim() || '';
            const date = el.querySelector('.date, .time, [class*="date"]')?.textContent?.trim() || '';
            if (text && text.length > 0) {
              out.push({
                index: index + 1,
                author: author || '익명',
                text,
                date: date || ''
              });
            }
          });
          if (out.length > 0) break;
        }
      }

      if (out.length === 0) {
        const commentArea = document.querySelector('.CommentBox, .comment_area, [class*="comment"]');
        if (commentArea) {
          const allText = commentArea.textContent?.trim() || '';
          if (allText.length > 0) {
            out.push({ index: 1, author: '전체', text: allText, date: '' });
          }
        }
      }
      return out;
    });

    let scrapedComments = null;
    if (comments && comments.length > 0) {
      scrapedComments = JSON.stringify(comments);
    }

    const actualCommentCount = await context.evaluate(() => {
      const allText = document.body.textContent || '';
      const commentMatches = allText.match(/댓글\s*(\d+)/g);
      if (commentMatches && commentMatches.length > 0) {
        const numbers = commentMatches
          .map((m) => {
            const numMatch = m.match(/(\d+)/);
            return numMatch ? parseInt(numMatch[1], 10) : 0;
          })
          .filter((n) => n > 0 && n < 10000);
        if (numbers.length > 0) {
          return Math.min(...numbers);
        }
      }

      const replyBoxSelectors = ['div.ReplyBox', 'div.replyBox', '.ReplyBox', '.replyBox', '[class*="ReplyBox"]', '[class*="replyBox"]'];
      let replyBox = null;
      for (const selector of replyBoxSelectors) {
        replyBox = document.querySelector(selector);
        if (replyBox) break;
      }
      if (!replyBox) return null;

      const replyText = replyBox.textContent || '';
      const replyIndex = replyText.indexOf('댓글');
      if (replyIndex >= 0) {
        const allElements = replyBox.querySelectorAll('*');
        for (const el of allElements) {
          if (el.tagName === 'STRONG' && el.classList.contains('num')) {
            const text = el.textContent?.trim() || '';
            const numMatch = text.match(/^(\d+)$/);
            if (numMatch) {
              return parseInt(numMatch[1], 10) || 0;
            }
          }
        }
        const replyMatch = replyText.substring(replyIndex).match(/댓글\s*(\d+)/);
        if (replyMatch) {
          return parseInt(replyMatch[1], 10) || 0;
        }
      }

      const numElements = replyBox.querySelectorAll('strong.num');
      for (const numEl of numElements) {
        const text = numEl.textContent?.trim() || '';
        const numMatch = text.match(/^(\d+)$/);
        if (numMatch) {
          return parseInt(numMatch[1], 10) || 0;
        }
      }
      return null;
    });

    const actualCommentElementsCount = await context.evaluate(() => {
      const commentSelectors = [
        'ul.comment_list > li',
        '.comment_list > li',
        '.comment_box > ul > li',
        '.reply_area > ul > li',
        '.CommentBox > ul > li',
        '.CommentItem',
        '.comment_item',
        'li[class*="comment"]',
        'li[class*="Comment"]',
        'li[class*="reply"]',
        'li[class*="Reply"]'
      ];
      for (const selector of commentSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          return elements.length;
        }
      }
      return 0;
    });

    const scrapedCommentsCount = scrapedComments ? JSON.parse(scrapedComments).length : 0;
    let commentCount = 0;
    if (scrapedCommentsCount > 0) {
      commentCount = scrapedCommentsCount;
    } else if (actualCommentElementsCount > 0) {
      commentCount = actualCommentElementsCount;
    } else if (actualCommentCount !== null && actualCommentCount !== undefined) {
      commentCount = actualCommentCount;
    }

    return {
      ok: true,
      commentCount,
      scrapedComments
    };
  } catch (error) {
    logger.warn('[IssueDetailRefetch] Failed', { url: articleUrl, error: error.message });
    return { ok: false, error: error.message };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  refetchNaverCafeIssueDetail,
  loadNaverCafeCookie
};
