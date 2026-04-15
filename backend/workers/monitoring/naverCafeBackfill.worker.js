/**
 * Naver Cafe 백필(Backfill) 모니터링 워커
 * 
 * 기존 naverCafe.worker.js와 병렬로 실행되어 누락 방지를 위한 겹침 스캔을 수행합니다.
 * - lastArticleId에 의존하지 않음 (겹침 스캔)
 * - 최근 N페이지까지 스캔 (기본 5페이지)
 * - DB 레벨 중복 방지 (boardId, articleId 유니크 인덱스)
 * - 절대 lastArticleId를 업데이트하지 않음
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { chromium } = require('playwright');
const { query, queryOne, execute } = require('../../libs/db');
const logger = require('../../utils/logger');
const {
  logBoardScanFailure,
  logScanCycleAllFailed
} = require('../../utils/workerScanErrorLog');
const { getClanWorkerTargetMonitoredBoardIds } = require('../../utils/clanMonitoredBoardIds');
const { isNaverPcFreeBoardExceptionCafeGame } = require('../../services/crawlerGames.service');
const { retryBrowserOperation } = require('../../utils/retry');
const { generateScreenshotPath, ensureScreenshotDirectory } = require('../../utils/fileUtils');
const { collectNaverPostImageUrls, downloadNaverPostImages } = require('./lib/naverPostImages');
const pLimit = require('p-limit');

// 설정
const BROWSER_HEADLESS = process.env.BROWSER_HEADLESS !== 'false';
const BACKFILL_PAGES = parseInt(process.env.NAVER_CAFE_BACKFILL_PAGES) || 5; // 기본 5페이지
const MIN_WAIT_MS = parseInt(process.env.NAVER_CAFE_BACKFILL_MIN_WAIT_MS) || 900000; // 기본 15분
const MAX_WAIT_MS = parseInt(process.env.NAVER_CAFE_BACKFILL_MAX_WAIT_MS) || 1800000; // 기본 30분

// 최신 브라우저 User-Agent 리스트
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
];

/**
 * 랜덤 대기 시간 생성
 */
function getRandomWaitTime() {
  return Math.floor(Math.random() * (MAX_WAIT_MS - MIN_WAIT_MS + 1)) + MIN_WAIT_MS;
}

/**
 * 랜덤 User-Agent 선택
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * 게시판 이름 정규화
 */
function normalizeBoardName(name) {
  return String(name || '').replace(/\s+/g, '').trim();
}

/**
 * 수집 제외 게시판 목록 로드
 */
async function loadExcludedBoards() {
  try {
    const config = queryOne('SELECT * FROM MonitoringConfig WHERE key = ?', ['naver.excludedBoards']);
    if (!config || !config.value) {
      return [];
    }
    try {
      const parsed = JSON.parse(config.value);
      if (Array.isArray(parsed)) {
        return parsed.map(name => normalizeBoardName(name)).filter(name => name.length > 0);
      }
    } catch (e) {
      logger.warn('[NaverCafeBackfill] Failed to parse excluded boards config', { error: e.message });
    }
    return [];
  } catch (error) {
    logger.warn('[NaverCafeBackfill] Failed to load excluded boards config', { error: error.message });
    return [];
  }
}

/**
 * 쿠키 로드
 */
async function loadNaverCafeCookie() {
  if (process.env.NAVER_CAFE_COOKIE) {
    return process.env.NAVER_CAFE_COOKIE;
  }
  try {
    const config = queryOne('SELECT * FROM MonitoringConfig WHERE key = ?', ['naverCafeCookie']);
    if (config && config.value) {
      return config.value;
    }
  } catch (error) {
    logger.warn('[NaverCafeBackfill] Failed to load cookie from DB', { error: error.message });
  }
  return null;
}

/**
 * MonitoringKeyword 로드
 */
async function loadMonitoringKeywords() {
  try {
    const keywords = query('SELECT * FROM MonitoringKeyword WHERE enabled = 1 AND type = ?', ['naver']);
    return keywords.map(k => k.word.toLowerCase());
  } catch (error) {
    logger.error('[NaverCafeBackfill] Failed to load keywords', { error: error.message });
    return [];
  }
}

/**
 * 키워드 필터링
 */
function matchesKeywords(text, keywords) {
  if (!keywords || keywords.length === 0) return false; // 키워드가 없으면 매칭되지 않음
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  const normalizedKeywords = keywords.map(k => String(k).toLowerCase().trim()).filter(k => k.length > 0);
  if (normalizedKeywords.length === 0) return false; // 유효한 키워드가 없으면 매칭되지 않음
  
  return normalizedKeywords.some(keyword => {
    const normalizedKeyword = keyword.replace(/\s+/g, '');
    const normalizedText = lowerText.replace(/\s+/g, '');
    return normalizedText.includes(normalizedKeyword);
  });
}

/**
 * 게시글 URL에서 articleId 추출
 */
function extractArticleIdFromUrl(url) {
  try {
    const match = url.match(/\/articles\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * RawLog에 데이터 저장 (INSERT OR IGNORE 사용)
 */
async function saveRawLog(data) {
  try {
    // 0. 이미 Issue로 승격된 게시글인지 확인하여, 이슈가 존재하면 추가 수집을 피한다.
    //    (이슈큐에 이미 올라온 내용은 최근 수집 로그에 중복으로 쌓이지 않도록 하기 위함)
    if (data.externalPostId || data.url) {
      const articleId = data.externalPostId || extractArticleIdFromUrl(data.url) || null;
      const existingIssue = queryOne(
        `SELECT id FROM ReportItemIssue 
         WHERE source LIKE 'NAVER%' 
           AND (externalPostId = ? OR sourceUrl = ?)
         LIMIT 1`,
        [articleId, data.url || null]
      );

      if (existingIssue) {
        logger.debug('[NaverCafeBackfill] Skipping RawLog because issue already exists', {
          externalPostId: articleId,
          url: data.url,
          issueId: existingIssue.id
        });
        return null;
      }
    }

    const { nanoid } = require('nanoid');
    const logId = nanoid();
    const now = new Date().toISOString();
    const timestamp = data.timestamp ? new Date(data.timestamp).toISOString() : now;
    const articleId = data.externalPostId || extractArticleIdFromUrl(data.url) || null;
    const boardId = data.monitoredBoardId || null;
    
    // metadata 구성
    const metadata = {
      url: data.url,
      title: data.title,
      externalPostId: articleId,
      cafeGame: data.cafeGame,
      monitoredBoardId: boardId,
      screenshotPath: data.screenshotPath || null,
      postImagePaths: data.postImagePaths && data.postImagePaths.length > 0 ? data.postImagePaths : null,
      hasImages: data.hasImages || false,
      requiresLogin: data.requiresLogin || false,
      commentCount: data.commentCount || 0,
      scrapedComments: data.scrapedComments || null,
      isHotTopic: data.isHotTopic || false,
      isError: data.isError || false,
      hasKeywordMatch: data.hasKeywordMatch || false
    };
    
    // INSERT OR IGNORE 사용 (유니크 인덱스로 중복 방지)
    // SQLite는 INSERT OR IGNORE를 지원
    try {
      execute(
        `INSERT OR IGNORE INTO RawLog 
         (id, source, content, author, timestamp, isProcessed, metadata, boardId, articleId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          logId,
          'naver',
          data.content || '',
          data.author || null,
          timestamp,
          0,
          JSON.stringify(metadata),
          boardId,
          articleId,
          now,
          now
        ]
      );
      
      // 실제로 삽입되었는지 확인
      const inserted = queryOne('SELECT * FROM RawLog WHERE id = ?', [logId]);
      
      if (inserted) {
        logger.info('[NaverCafeBackfill] RawLog saved (new)', {
          id: inserted.id,
          boardId,
          articleId,
          title: data.title?.substring(0, 50)
        });
        return inserted;
      } else {
        // 중복으로 인해 무시됨
        logger.debug('[NaverCafeBackfill] RawLog skipped (duplicate)', {
          boardId,
          articleId,
          title: data.title?.substring(0, 50)
        });
        return null;
      }
    } catch (error) {
      // 유니크 제약 위반은 정상적인 중복 처리
      if (error.message && error.message.includes('UNIQUE constraint')) {
        logger.debug('[NaverCafeBackfill] RawLog skipped (unique constraint)', {
          boardId,
          articleId,
          title: data.title?.substring(0, 50)
        });
        return null;
      }
      throw error;
    }
  } catch (error) {
    logger.error('[NaverCafeBackfill] Failed to save RawLog', {
      error: error.message,
      url: data.url,
      boardId: data.monitoredBoardId,
      articleId: data.externalPostId
    });
    throw error;
  }
}

// 주시할 작성자 목록
const WATCH_AUTHORS = process.env.NAVER_CAFE_WATCH_AUTHORS 
  ? process.env.NAVER_CAFE_WATCH_AUTHORS.split(',').map(a => a.trim())
  : ['GM네로', 'PUBG운영우진', 'CM태이고', 'PUBG운영팀', 'PUBG운영진'];

const HOT_TOPIC_THRESHOLD = parseInt(process.env.NAVER_CAFE_HOT_TOPIC_THRESHOLD) || 10; // 댓글 수 임계값 (10개 이상)

/**
 * 본문 정리 함수
 */
function cleanContent(content) {
  if (!content || typeof content !== 'string') {
    return '';
  }
  
  let cleaned = content.trim();
  
  // 에러 메시지 제거
  const errorPatterns = [
    /죄송합니다\.\s*문제가\s*발생했습니다\.\s*다시\s*시도해\s*주세요\.?/gi,
    /죄송합니다\s*문제가\s*발생했습니다\s*다시\s*시도해\s*주세요/gi,
    /문제가\s*발생했습니다/gi,
    /다시\s*시도해\s*주세요/gi
  ];
  
  errorPatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // UI 관련 불필요한 텍스트 제거
  const uiPatterns = [
    /^다음\s*동영상\s*$/gim,
    /^subject\s*$/gim,
    /^author\s*$/gim
  ];
  
  uiPatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // 줄 단위로 필터링
  const lines = cleaned.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return true;
    if (trimmed.split(/\s+/).length === 1) {
      const lowerTrimmed = trimmed.toLowerCase();
      if (['subject', 'author', '다음동영상', '다음 동영상'].includes(lowerTrimmed)) {
        return false;
      }
    }
    return true;
  });
  
  cleaned = filteredLines.join('\n').trim();
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  return cleaned.trim();
}

/**
 * 게시글 상세 페이지 크롤링
 */
async function crawlArticleDetail(page, articleUrl, articleId, postInfo, board) {
  let screenshotPath = null;
  let postImagePaths = [];
  let hasImages = false;
  let requiresLogin = false;
  let content = '';
  let scrapedComments = null;
  let commentCount = postInfo.commentCount || 0;
  let isHotTopic = false;
  
  try {
    // 한글 폰트 설정 (스크린샷 텍스트 깨짐 방지)
    await page.addInitScript(() => {
      const fontLink = document.createElement('link');
      fontLink.rel = 'preconnect';
      fontLink.href = 'https://fonts.googleapis.com';
      document.head.appendChild(fontLink);
      
      const fontLink2 = document.createElement('link');
      fontLink2.rel = 'preconnect';
      fontLink2.href = 'https://fonts.gstatic.com';
      fontLink2.crossOrigin = 'anonymous';
      document.head.appendChild(fontLink2);
      
      const nanumLink = document.createElement('link');
      nanumLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap';
      nanumLink.rel = 'stylesheet';
      document.head.appendChild(nanumLink);
      
      const style = document.createElement('style');
      style.textContent = `
        * {
          font-family: 'Noto Sans KR', 'Nanum Gothic', 'NanumBarunGothic', 'Noto Sans CJK KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif !important;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        body, html {
          font-family: 'Noto Sans KR', 'Nanum Gothic', 'NanumBarunGothic', 'Noto Sans CJK KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif !important;
        }
      `;
      document.head.appendChild(style);
    });
    
    // 로그인 팝업/다이얼로그 감지를 위한 플래그
    let detectedLoginDialog = false;
    let detectedLoginModal = false;
    
    // JavaScript 다이얼로그 감지 (alert, confirm, prompt)
    const dialogHandler = (dialog) => {
      const dialogMessage = dialog.message().toLowerCase();
      if (dialogMessage.includes('로그인') || dialogMessage.includes('login') || 
          dialogMessage.includes('회원') || dialogMessage.includes('member')) {
        detectedLoginDialog = true;
        logger.info('[NaverCafeBackfill] Login dialog detected', {
          articleId,
          dialogType: dialog.type(),
          message: dialog.message().substring(0, 100)
        });
      }
      // 다이얼로그 자동 닫기 (로그인 필요 판단만 하고 진행)
      dialog.dismiss().catch(() => {});
    };
    
    // 다이얼로그 리스너 등록
    page.on('dialog', dialogHandler);
    
    // 게시글 상세 페이지 로드
    await retryBrowserOperation(
      () => page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }),
      {
        maxRetries: 3,
        initialDelay: 2000,
        maxDelay: 10000
      }
    );
    
    // 페이지 로드 후 팝업/모달 감지를 위한 대기 시간
    await page.waitForTimeout(3000);
    
    // 로그인 관련 모달/팝업 요소 감지
    try {
      const loginModalDetected = await page.evaluate(() => {
        // 네이버 카페 로그인 모달/팝업의 일반적인 선택자
        const loginModalSelectors = [
          '.layer_login', // 네이버 로그인 레이어
          '.login_layer',
          '.popup_login',
          '.modal_login',
          '[class*="login"] [class*="layer"]',
          '[class*="login"] [class*="modal"]',
          '[class*="login"] [class*="popup"]',
          '#loginLayer',
          '.login_popup',
          '[id*="login"][id*="layer"]',
          '[id*="login"][id*="modal"]',
          '[id*="login"][id*="popup"]'
        ];
        
        // 모달/팝업이 보이는지 확인 (display: none이 아니고, visibility: hidden이 아닌 경우)
        for (const selector of loginModalSelectors) {
          try {
            const element = document.querySelector(selector);
            if (element) {
              const style = window.getComputedStyle(element);
              const isVisible = style.display !== 'none' && 
                               style.visibility !== 'hidden' && 
                               style.opacity !== '0' &&
                               element.offsetWidth > 0 && 
                               element.offsetHeight > 0;
              
              if (isVisible) {
                // 모달 내부에 로그인 관련 텍스트가 있는지 확인
                const modalText = element.textContent?.toLowerCase() || '';
                if (modalText.includes('로그인') || modalText.includes('login') || 
                    modalText.includes('회원') || modalText.includes('member')) {
                  return true;
                }
              }
            }
          } catch (e) {
            // 선택자 오류 무시
            continue;
          }
        }
        
        return false;
      });
      
      if (loginModalDetected) {
        detectedLoginModal = true;
        logger.info('[NaverCafeBackfill] Login modal/popup detected', { articleId });
      }
    } catch (modalCheckError) {
      logger.debug('[NaverCafeBackfill] Failed to check login modal', {
        articleId,
        error: modalCheckError.message
      });
    }
    
    // 다이얼로그 리스너 제거
    page.off('dialog', dialogHandler);
    
    // iframe 컨텍스트 확인
    await page.waitForTimeout(2000);
    let frame = null;
    let isInIframe = false;
    
    try {
      frame = await page.frame({ name: 'cafe_main' });
      if (!frame) {
        const frames = page.frames();
        for (const f of frames) {
          if (f.url().includes('cafe_main') || f.url().includes('cafe.naver.com')) {
            frame = f;
            break;
          }
        }
      }
      if (frame) {
        isInIframe = true;
        try {
          await frame.waitForSelector('.se-main-container, .article_view', { timeout: 10000 });
        } catch (e) {
          // 타임아웃 무시
        }
      }
    } catch (frameError) {
      // iframe 없으면 메인 페이지 사용
    }
    
    const contextToUse = isInIframe && frame ? frame : page;
    
    // 로그인 필요 여부 확인: 팝업/다이얼로그 감지에만 의존
    // 상세 페이지 진입 시 팝업창이 뜨는 경우만 로그인 필요로 판단
    requiresLogin = detectedLoginDialog || detectedLoginModal;
    
    if (requiresLogin) {
      logger.info('[NaverCafeBackfill] Login required post detected (popup/dialog detected)', {
        articleId,
        detectedByDialog: detectedLoginDialog,
        detectedByModal: detectedLoginModal
      });
    }
    
    // 쿠키 로드 확인
    const cookie = await loadNaverCafeCookie();
    const hasCookie = !!cookie;
    
    if (requiresLogin && !hasCookie) {
      logger.info('[NaverCafeBackfill] Login required post detected (no cookie)', { articleId });
      // 로그인 필요 게시글이지만 본문 추출 시도 (팝업 감지가 잘못되었을 수 있음)
      // 아래 로직 계속 진행
    } else if (requiresLogin && hasCookie) {
      logger.info('[NaverCafeBackfill] Login required post detected but cookie available, attempting to crawl', { articleId });
      // 쿠키가 있으면 본문 추출 시도 (아래 로직 계속 진행)
    }
    
    // 렌더링 완료 대기
    await page.waitForTimeout(4000);
    
    // 핫토픽 여부 판단
    const isWatchedAuthor = postInfo.author && WATCH_AUTHORS.includes(postInfo.author);
    const isHighCommentCount = commentCount >= HOT_TOPIC_THRESHOLD;
    isHotTopic = isWatchedAuthor || isHighCommentCount;
    
    // 댓글 수집 (핫토픽인 경우)
    if (isHotTopic) {
      try {
        await retryBrowserOperation(
          async () => {
            const commentSelectors = ['.CommentBox', '.comment_area', '.comment_box', '#comment_area'];
            for (const selector of commentSelectors) {
              try {
                await page.waitForSelector(selector, { timeout: 5000 });
                break;
              } catch (e) {
                continue;
              }
            }
          },
          { maxRetries: 2, initialDelay: 2000, maxDelay: 5000 }
        );
        
        const comments = await page.evaluate(() => {
          const comments = [];
          const commentSelectors = ['.CommentItem', '.comment_item', '.CommentBox .comment'];
          
          for (const selector of commentSelectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              elements.forEach((el, index) => {
                const text = el.textContent?.trim() || '';
                const author = el.querySelector('.nickname, .nick, .author')?.textContent?.trim() || '';
                const date = el.querySelector('.date, .time')?.textContent?.trim() || '';
                
                if (text && text.length > 0) {
                  comments.push({
                    index: index + 1,
                    author: author || '익명',
                    text: text,
                    date: date || ''
                  });
                }
              });
              if (comments.length > 0) break;
            }
          }
          return comments;
        });
        
        if (comments && comments.length > 0) {
          scrapedComments = JSON.stringify(comments);
          commentCount = comments.length;
        }
      } catch (commentError) {
        logger.warn('[NaverCafeBackfill] Failed to scrape comments', { articleId, error: commentError.message });
      }
    }
    
    // 이미지 감지 및 스크린샷
    try {
      let screenshotContext = page;
      try {
        const screenshotFrame = await page.frame({ name: 'cafe_main' });
        if (screenshotFrame) {
          screenshotContext = screenshotFrame;
        }
      } catch (e) {
        // iframe 없으면 메인 페이지 사용
      }
      
      const containerSelectors = ['.se-main-container', '.ContentRenderer', '.article_view', '#tbody'];
      let foundContainer = null;
      let usedSelector = null;
      
      for (const selector of containerSelectors) {
        try {
          await screenshotContext.waitForSelector(selector, { timeout: 5000 });
          foundContainer = await screenshotContext.$(selector);
          if (foundContainer) {
            usedSelector = selector;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!foundContainer) {
        usedSelector = 'body';
      }
      
      const imageInfo = await screenshotContext.evaluate((selector) => {
        const container = selector === 'body' ? document.body : document.querySelector(selector);
        if (!container) {
          const allImages = document.querySelectorAll('img');
          return {
            hasImages: allImages.length > 0,
            imageCount: allImages.length
          };
        }
        
        const containerImages = container.querySelectorAll('img');
        const style = window.getComputedStyle(container);
        const hasBackgroundImage = style.backgroundImage && style.backgroundImage !== 'none';
        const svgImages = container.querySelectorAll('svg');
        
        return {
          hasImages: containerImages.length > 0 || hasBackgroundImage || svgImages.length > 0,
          imageCount: containerImages.length
        };
      }, usedSelector);
      
      hasImages = imageInfo.hasImages;
      
      if (hasImages) {
        await screenshotContext.waitForTimeout(500);
        let downloadedPaths = [];
        try {
          const imgUrls = await collectNaverPostImageUrls(screenshotContext);
          if (imgUrls.length > 0) {
            downloadedPaths = await downloadNaverPostImages({
              page,
              urls: imgUrls,
              articleId,
              logger
            });
          }
        } catch (dlErr) {
          logger.warn('[NaverCafeBackfill] Inline image download failed', {
            articleId,
            error: dlErr.message
          });
        }

        if (downloadedPaths.length > 0) {
          postImagePaths = downloadedPaths;
          screenshotPath = downloadedPaths[0];
        } else {
        await screenshotContext.waitForTimeout(1000);
        const pathInfo = generateScreenshotPath(articleId);
        await ensureScreenshotDirectory(pathInfo.uploadsDir);
        await screenshotContext.waitForTimeout(1000);
        const containerLocator = screenshotContext.locator(usedSelector);
        await containerLocator.screenshot({
          path: pathInfo.fullPath,
          fullPage: false
        });
        screenshotPath = pathInfo.relativePath;
        postImagePaths = screenshotPath ? [screenshotPath] : [];
        }
      }
    } catch (screenshotError) {
      logger.warn('[NaverCafeBackfill] Failed to capture screenshot', { articleId, error: screenshotError.message });
      screenshotPath = null;
      postImagePaths = [];
    }
    
    // 본문 추출
    const contextForTextElements = isInIframe && frame ? frame : page;
    let elementTexts = [];
    
    try {
      const textElements = await contextForTextElements.$$('.se-main-container .se-text, .se-main-container p');
      const seenTexts = new Set();
      
      for (const el of textElements) {
        const text = await el.innerText();
        if (text && text.trim().length > 1) {
          const trimmedText = text.trim();
          if (!seenTexts.has(trimmedText)) {
            elementTexts.push(trimmedText);
            seenTexts.add(trimmedText);
          }
        }
      }
    } catch (e) {
      // 텍스트 요소 추출 실패 무시
    }
    
    let postData = await contextToUse.evaluate((elementTextsArray) => {
      const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                   document.querySelector('.title_text, .article_title')?.textContent?.trim() ||
                   document.title;
      const cleanTitle = title ? title.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim() : '';
      
      let content = '';
      const seMainContainer = document.querySelector('.se-main-container');
      
      if (seMainContainer) {
        let collectedText = '';
        if (elementTextsArray && elementTextsArray.length > 0) {
          collectedText = elementTextsArray.join('\n');
        } else {
          const textElements = seMainContainer.querySelectorAll('.se-text, .se-component-text, p, div[class*="se-"]');
          const textArray = [];
          const seenTexts = new Set();
          
          textElements.forEach(el => {
            const text = el.textContent?.trim() || '';
            if (text && text.length > 1 && !text.match(/^[\s\n\r:]+$/)) {
              if (!seenTexts.has(text)) {
                textArray.push(text);
                seenTexts.add(text);
              }
            }
          });
          
          if (textArray.length > 0) {
            collectedText = textArray.join('\n');
          } else {
            collectedText = seMainContainer.textContent?.trim() || '';
          }
        }
        
        if (collectedText && collectedText.length > 0) {
          if (cleanTitle && collectedText.startsWith(cleanTitle)) {
            collectedText = collectedText.substring(cleanTitle.length).trim();
            collectedText = collectedText.replace(/^[\s\n\r:]+/, '').trim();
          }
          collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
          if (collectedText.length >= 5) {
            content = collectedText;
          }
        }
      }
      
      // fallback: 다른 셀렉터 시도
      if (!content || content.length < 1) {
        const contentSelectors = ['.ContentRenderer', '#articleBodyContents', '.ArticleContent', '.article_view'];
        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            let text = element.textContent?.trim() || '';
            if (cleanTitle && text.startsWith(cleanTitle)) {
              text = text.substring(cleanTitle.length).trim();
              text = text.replace(/^[\s\n\r:]+/, '').trim();
            }
            text = text.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
            if (text.length > 0) {
              content = text;
              break;
            }
          }
        }
      }
      
      return { content: content || '' };
    }, elementTexts);
    
    // fallback: 본문이 비어있으면 더 적극적으로 텍스트 추출 시도
    // 팝업이 감지되었어도 본문 추출을 시도 (팝업 감지가 잘못되었을 수 있음)
    if (!postData.content || postData.content.trim().length === 0) {
      try {
        const aggressiveFallback = await contextToUse.evaluate(() => {
          const additionalSelectors = [
            '.article_view_content',
            '.article_content',
            '.content_area',
            '.post_content',
            '#articleBodyContents .se-main-container',
            '#articleBodyContents .se-component',
            '.se-module-text',
            '.se-module',
            '.se-section',
            '.se-component',
            '[class*="article"] [class*="content"]',
            '[class*="post"] [class*="content"]'
          ];

          let content = '';
          for (const selector of additionalSelectors) {
            try {
              const element = document.querySelector(selector);
              if (element) {
                let text = element.textContent?.trim() || element.innerText?.trim() || '';
                
                const pageTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                                 document.querySelector('.title_text, .article_title')?.textContent?.trim() ||
                                 document.title || '';
                const cleanTitle = pageTitle.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
                
                if (cleanTitle && text.startsWith(cleanTitle)) {
                  text = text.substring(cleanTitle.length).trim();
                  text = text.replace(/^[\s\n\r:]+/, '').trim();
                }
                
                text = text.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
                
                if (text.length >= 3 && 
                    text.trim() !== cleanTitle.trim() &&
                    !text.match(/^(다음글목록|말머리|인기멤버|1:1 채팅|조회 \d+|댓글 \d+|URL 복사|배틀그라운드 공식카페)/i)) {
                  content = text;
                  break;
                }
              }
            } catch (e) {
              // 셀렉터 오류 무시
            }
          }
          return { content: content || '' };
        });

        if (aggressiveFallback && aggressiveFallback.content && aggressiveFallback.content.length >= 3) {
          let finalContent = aggressiveFallback.content;
          const postTitle = postInfo.title || '';
          if (postTitle && finalContent.startsWith(postTitle)) {
            finalContent = finalContent.substring(postTitle.length).trim();
            finalContent = finalContent.replace(/^[\s\n\r:]+/, '').trim();
          }
          
          if (finalContent.length >= 3 && finalContent.trim() !== postTitle.trim()) {
            postData.content = finalContent;
            logger.info('[NaverCafeBackfill] Aggressive fallback content extracted', {
              articleId,
              contentLength: finalContent.length,
              contentPreview: finalContent.substring(0, 100)
            });
          }
        }
      } catch (aggressiveError) {
        logger.warn('[NaverCafeBackfill] Aggressive fallback extraction failed', {
          articleId,
          error: aggressiveError.message
        });
      }
    }
    
    // postData 안전성 검사 (크리티컬: 이슈 승격에 필수)
    if (!postData || typeof postData !== 'object') {
      logger.error('[NaverCafeBackfill] postData is invalid', {
        articleId,
        postDataType: typeof postData,
        postDataValue: String(postData)
      });
      return {
        content: '',
        requiresLogin: requiresLogin || false,
        hasImages: false,
        screenshotPath: null,
        postImagePaths: null,
        scrapedComments: null,
        commentCount: postInfo.commentCount || 0,
        isHotTopic: false
      };
    }

    content = cleanContent(postData.content || '');
    
    // 로그인 필요 여부 재평가: 이미지 감지를 우선적으로 확인
    // 이미지가 있으면 로그인 필요 없음 (이미지만 있는 게시글은 본문이 비어있을 수 있음)
    if (hasImages) {
      requiresLogin = false;
      logger.info('[NaverCafeBackfill] Images detected, overriding requiresLogin=false (image-only post possible)', {
        articleId,
        title: postInfo?.title?.substring(0, 50),
        hasImages: true,
        hadPopupDetected: detectedLoginDialog || detectedLoginModal
      });
    }
    
    // 본문 추출 결과 확인: 본문이 성공적으로 추출되면 requiresLogin을 false로 설정
    const extractedContentLength = (content && typeof content === 'string') 
      ? content.trim().length 
      : 0;
    const postTitle = (postInfo && postInfo.title && typeof postInfo.title === 'string') 
      ? postInfo.title.trim() 
      : '';
    const contentStr = (content && typeof content === 'string') 
      ? content.trim() 
      : '';
    const isContentSameAsTitle = contentStr === postTitle;
    
    // 본문이 실제로 추출된 경우 (제목과 다르고 3자 이상) 로그인 필요 없음
    if (extractedContentLength > 0 && 
        !isContentSameAsTitle && 
        extractedContentLength >= 3) {
      // 실제 본문이 추출되었으면 로그인 필요 없음 (팝업 감지가 잘못되었을 수 있음)
      requiresLogin = false;
      logger.info('[NaverCafeBackfill] Real content extracted, overriding requiresLogin=false (popup detection may have been false positive)', {
        articleId,
        title: postTitle?.substring(0, 50),
        contentLength: extractedContentLength,
        contentPreview: content?.substring(0, 100),
        hadPopupDetected: detectedLoginDialog || detectedLoginModal
      });
    } else if (extractedContentLength === 0 && requiresLogin && !hasImages) {
      // 본문도 없고 이미지도 없는 경우에만 로그인 필요로 유지
      logger.debug('[NaverCafeBackfill] No content extracted and no images, keeping requiresLogin=true', {
        articleId,
        title: postTitle?.substring(0, 50),
        detectedByDialog: detectedLoginDialog,
        detectedByModal: detectedLoginModal
      });
    }
    
    return {
      content,
      requiresLogin,
      hasImages,
      screenshotPath,
      postImagePaths: postImagePaths.length > 0 ? postImagePaths : null,
      scrapedComments,
      commentCount,
      isHotTopic
    };
  } catch (error) {
    logger.error('[NaverCafeBackfill] Failed to crawl article detail', {
      articleId,
      error: error.message,
      stack: error.stack
    });
    return {
      content: '',
      requiresLogin: false,
      hasImages: false,
      screenshotPath: null,
      postImagePaths: null,
      scrapedComments: null,
      commentCount: postInfo.commentCount || 0,
      isHotTopic: false,
      isError: true
    };
  }
}

/**
 * 게시판의 여러 페이지 스캔
 */
async function scanBoardPages(board, page, keywords, excludedBoards, maxPages = BACKFILL_PAGES) {
  const stats = {
    pagesScanned: 0,
    postsFound: 0,
    keywordMatched: 0,
    saved: 0,
    duplicates: 0,
    errors: 0
  };
  
  try {
    // 기본 URL 구성
    let baseUrl = board.url || board.listUrl;
    
    // 리스트형 보기 강제 및 페이지당 게시글 수 늘리기
    try {
      const urlObj = new URL(baseUrl);
      urlObj.searchParams.delete('search.viewType');
      urlObj.searchParams.delete('viewType');
      urlObj.searchParams.set('search.viewType', 'title');
      urlObj.searchParams.delete('search.listType');
      urlObj.searchParams.delete('listType');
      urlObj.searchParams.set('search.listType', '50');
      baseUrl = urlObj.toString();
    } catch (urlError) {
      // URL 파싱 실패 시 원본 사용
    }
    
    // 각 페이지 스캔
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      try {
        // 페이지 URL 구성
        let pageUrl = baseUrl;
        if (pageNum > 1) {
          const separator = pageUrl.includes('?') ? '&' : '?';
          pageUrl = `${pageUrl}${separator}page=${pageNum}`;
        }
        
        logger.info('[NaverCafeBackfill] Scanning page', {
          boardId: board.id,
          boardName: board.name || board.label,
          pageNum,
          maxPages,
          url: pageUrl
        });
        
        // 페이지 로드
        await retryBrowserOperation(
          () => page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }),
          {
            maxRetries: 3,
            initialDelay: 2000,
            maxDelay: 10000
          }
        );
        
        // iframe 컨텍스트 확인
        let frame = null;
        try {
          frame = await page.frame({ name: 'cafe_main' });
          if (!frame) {
            frame = await page.frame({ url: /cafe_main/ });
          }
        } catch (e) {
          // iframe 없으면 메인 페이지 사용
        }
        
        const context = frame || page;
        
        // 게시글 목록 대기
        await context.waitForTimeout(2000);
        
        // 게시글 목록 추출 (기존 워커의 로직 재사용)
        const posts = await context.evaluate((params) => {
          const { excludedBoards } = params || {};
          const posts = [];
          
          const normalizeBoardName = (name) => String(name || '').replace(/\s+/g, '').trim();
          
          const rows = Array.from(document.querySelectorAll('tbody tr'));
          
          rows.forEach((row) => {
            let link = row.querySelector('td .board-list .inner_list a.article');
            if (!link) {
              link = row.querySelector('a.article, a[href*="/ArticleRead.nhn"], a[href*="/ArticleDetail.nhn"]');
            }
            if (!link) {
              link = row.querySelector('.article-title a, .title a, a.title');
            }
            
            if (!link) return;
            
            const href = link.getAttribute('href') || '';
            let title = link.textContent?.trim() || link.innerText?.trim() || '';
            const dateText = row.querySelector('td.td_normal.type_date, .date, .article-date, time')?.textContent?.trim() || '';
            const author = row.querySelector('td .author, td .nickname, td .td_name, .author, .nickname, .writer')?.textContent?.trim() || null;
            
            // 제목에서 [숫자] 형식의 댓글 수 추출 (제목 옆에 표시되는 경우)
            let commentCountFromTitle = 0;
            if (title) {
              // 제목 텍스트에서 [숫자] 패턴 찾기
              const titleCommentMatch = title.match(/\[(\d+)\]/);
              if (titleCommentMatch) {
                commentCountFromTitle = parseInt(titleCommentMatch[1], 10) || 0;
                // 제목에서 [숫자] 제거 (깔끔한 제목 유지)
                title = title.replace(/\[\d+\]\s*/, '').trim();
              } else {
                // 제목 링크의 부모 요소에서 [숫자] 패턴 찾기
                const linkParent = link.parentElement;
                if (linkParent) {
                  const parentText = linkParent.textContent?.trim() || '';
                  const parentCommentMatch = parentText.match(/\[(\d+)\]/);
                  if (parentCommentMatch) {
                    commentCountFromTitle = parseInt(parentCommentMatch[1], 10) || 0;
                  }
                }
                // 제목 링크의 형제 요소에서 [숫자] 패턴 찾기
                if (!commentCountFromTitle && link.nextSibling) {
                  const siblingText = link.nextSibling.textContent?.trim() || '';
                  const siblingCommentMatch = siblingText.match(/\[(\d+)\]/);
                  if (siblingCommentMatch) {
                    commentCountFromTitle = parseInt(siblingCommentMatch[1], 10) || 0;
                  }
                }
              }
            }
            
            // 게시판 이름 추출
            let boardNameElement = row.querySelector('a.board_name, .board_name');
            if (!boardNameElement) {
              boardNameElement = row.querySelector('td.td_board a, td.td_category a');
            }
            const boardName = boardNameElement?.textContent?.trim() || '';
            const normBoardName = normalizeBoardName(boardName);
            
            // 수집 제외 게시판 필터링
            if (normBoardName && Array.isArray(excludedBoards) && excludedBoards.length > 0) {
              const matchedExcluded = excludedBoards.find((excludedName) => {
                const normExcludedName = normalizeBoardName(excludedName);
                return normBoardName.includes(normExcludedName) || normExcludedName.includes(normBoardName);
              });
              if (matchedExcluded) return;
            }
            
            if (!href || !title) return;
            
            // 댓글 수 추출 (다양한 셀렉터 시도 - 강화된 버전)
            // 제목에서 추출한 댓글 수를 기본값으로 사용
            let commentCount = commentCountFromTitle;
            const cells = row.querySelectorAll('td');
            let commentElement = null;
            
            // 1차 시도: td 요소 내부의 a.cmt 태그 (가장 일반적인 구조: <td><a class="cmt">숫자</a></td>)
            for (const cell of cells) {
              const cmtLink = cell.querySelector('a.cmt');
              if (cmtLink) {
                commentElement = cmtLink;
                break;
              }
            }
            
            // 2차 시도: row 전체에서 a.cmt 찾기
            if (!commentElement) {
              commentElement = row.querySelector('a.cmt');
            }
            
            // 3차 시도: td 요소 내부의 .cmt 클래스 (a 태그가 아닐 수도 있음)
            if (!commentElement) {
              for (const cell of cells) {
                const cmtEl = cell.querySelector('.cmt');
                if (cmtEl) {
                  commentElement = cmtEl;
                  break;
                }
              }
            }
            
            // 4차 시도: row 전체에서 .cmt 클래스
            if (!commentElement) {
              commentElement = row.querySelector('.cmt');
            }
            
            // 5차 시도: td 요소에서 "댓글 N" 또는 "답글 N" 형식 텍스트 찾기 (우선순위 상향)
            if (!commentElement) {
              for (const cell of cells) {
                const text = cell.textContent?.trim() || '';
                if (text.match(/댓글\s*\d+|답글\s*\d+|답글수\s*\d+/i)) {
                  commentElement = cell;
                  break;
                }
              }
            }
            
            // 6차 시도: td 요소 중 숫자만 있는 셀 찾기 (댓글 수 열은 보통 숫자만 표시)
            // 단, 링크의 href에 댓글 관련 키워드가 있는 경우만 인정 (조회수, 작성자명과 혼동 방지)
            if (!commentElement) {
              for (const cell of cells) {
                const text = cell.textContent?.trim() || '';
                // 숫자만 있는 경우 (작성자명, 조회수 등과 혼동 가능하므로 엄격하게)
                if (text.match(/^\d+$/)) {
                  const hasLink = cell.querySelector('a');
                  if (hasLink) {
                    // 링크의 href에 댓글 관련 키워드가 있는지 확인 (필수)
                    const linkHref = hasLink.getAttribute('href') || '';
                    // href에 댓글 관련 키워드가 반드시 포함되어 있어야 함
                    if (linkHref.includes('comment') || linkHref.includes('reply') || linkHref.includes('cmt') || linkHref.includes('댓글')) {
                      commentElement = cell;
                      break;
                    }
                  }
                  // 링크가 없으면 숫자만 있는 셀은 무시 (조회수, 작성자명 등과 혼동 방지)
                }
              }
            }
            
            // 7차 시도: 링크가 있는 숫자 셀 (href 확인 없이) - 제거
            // 이전: 링크만 있으면 무조건 댓글 수로 인식 (위험)
            // 수정: href에 댓글 관련 키워드가 없는 경우는 제외
            
            // 8차 시도: 다른 명확한 클래스명
            if (!commentElement) {
              commentElement = row.querySelector('.comment_count, .reply_count, .cmt_count, .td_comment, .td_reply, .comment-count, .reply-count');
            }
            
            // 9차 시도: 부분 매칭 (cmt 포함)
            if (!commentElement) {
              commentElement = row.querySelector('[class*="cmt"], [class*="comment"], [class*="reply"], [class*="Comment"], [class*="Reply"]');
            }
            
            // 10차 시도: 모든 td 셀에서 숫자 포함 텍스트 찾기 (마지막 수단)
            // 단, 숫자만 있는 경우는 제외 (댓글/답글 키워드가 반드시 포함되어야 함)
            if (!commentElement) {
              for (const cell of cells) {
                const text = cell.textContent?.trim() || '';
                // 숫자가 포함된 텍스트 중에서 "댓글" 또는 "답글" 키워드가 반드시 포함된 경우만 인정
                // 숫자만 있는 경우는 제외 (조회수, 작성자명 등과 혼동 방지)
                if (text.match(/\d+/) && (text.includes('댓글') || text.includes('답글') || text.includes('comment') || text.includes('reply'))) {
                  commentElement = cell;
                  break;
                }
              }
            }
            
            // 추출된 요소에서 숫자 추출
            if (commentElement) {
              const commentText = commentElement.textContent?.trim() || '';
              // 숫자 추출 (첫 번째 숫자)
              const match = commentText.match(/(\d+)/);
              if (match) {
                const extractedCount = parseInt(match[1], 10) || 0;
                // 제목에서 추출한 댓글 수가 없거나 0이면 셀렉터로 추출한 값 사용
                if (!commentCount || commentCount === 0) {
                  commentCount = extractedCount;
                }
              }
            }
            
            posts.push({ href, title, dateText, author, commentCount });
          });
          
          return posts;
        }, { excludedBoards });
        
        stats.postsFound += posts.length;
        stats.pagesScanned++;
        
        // 각 게시글 처리
        for (const postInfo of posts) {
          try {
            // 키워드 매칭 확인 (필터링하지 않고 표시만)
            const hasKeywordMatch = matchesKeywords(postInfo.title, keywords);
            
            if (hasKeywordMatch) {
              stats.keywordMatched++;
            }
            
            // articleId 추출
            const articleUrl = postInfo.href.startsWith('http')
              ? postInfo.href
              : new URL(postInfo.href, baseUrl).href;
            
            const articleId = extractArticleIdFromUrl(articleUrl);
            if (!articleId) {
              continue;
            }
            
            // 게시글 상세 페이지 크롤링
            const detailData = await crawlArticleDetail(page, articleUrl, articleId, postInfo, board);
            
            // RawLog 저장
            const saved = await saveRawLog({
              url: articleUrl,
              title: postInfo.title,
              content: detailData.content,
              author: postInfo.author || null,
              timestamp: new Date(),
              externalPostId: articleId,
              cafeGame: board.cafeGame,
              monitoredBoardId: board.id,
              screenshotPath: detailData.screenshotPath,
              postImagePaths: detailData.postImagePaths,
              hasImages: detailData.hasImages,
              requiresLogin: detailData.requiresLogin,
              commentCount: detailData.commentCount,
              scrapedComments: detailData.scrapedComments,
              isHotTopic: detailData.isHotTopic,
              isError: detailData.isError || false,
              hasKeywordMatch: hasKeywordMatch // 키워드 매칭 여부
            });
            
            if (saved) {
              stats.saved++;
            } else {
              stats.duplicates++;
            }
            
            // 요청 간 딜레이
            await page.waitForTimeout(500);
          } catch (postError) {
            logger.error('[NaverCafeBackfill] Failed to process post', {
              boardId: board.id,
              postTitle: postInfo.title?.substring(0, 50),
              error: postError.message
            });
            stats.errors++;
          }
        }
        
        // 페이지 간 딜레이
        await page.waitForTimeout(1000);
      } catch (pageError) {
        logger.error('[NaverCafeBackfill] Failed to scan page', {
          boardId: board.id,
          pageNum,
          error: pageError.message
        });
        stats.errors++;
        // 페이지 스캔 실패해도 다음 페이지 계속
      }
    }
  } catch (error) {
    logger.error('[NaverCafeBackfill] Failed to scan board pages', {
      boardId: board.id,
      error: error.message
    });
    stats.errors++;
  }
  
  return stats;
}

/**
 * 게시판 스캔 (병렬 처리)
 */
async function scanBoard(board, browser, keywords, excludedBoards) {
  let page = null;
  
  try {
    // 수집 제외 게시판 확인
    const boardName = (board.name || '').trim();
    const normBoardName = normalizeBoardName(boardName);
    const excludedBoardsNormalized = excludedBoards.map(n => normalizeBoardName(n));
    
    const isExcluded = normBoardName && excludedBoardsNormalized.some((excludedName) => {
      if (excludedName === '자유게시판' && isNaverPcFreeBoardExceptionCafeGame(board.cafeGame)) return false;
      return normBoardName.includes(excludedName) || excludedName.includes(normBoardName);
    });
    
    if (isExcluded) {
      logger.info('[NaverCafeBackfill] Skipping excluded board', {
        boardId: board.id,
        boardName
      });
      return { skipped: true };
    }
    
    // 브라우저 페이지 생성
    page = await browser.newPage();
    
    // 쿠키 설정
    const cookie = await loadNaverCafeCookie();
    if (cookie) {
      const cookies = cookie.split(';').map(cookieStr => {
        const [name, value] = cookieStr.trim().split('=');
        return {
          name: name.trim(),
          value: value?.trim() || '',
          domain: '.naver.com',
          path: '/'
        };
      }).filter(c => c.name && c.value);
      
      if (cookies.length > 0) {
        await page.context().addCookies(cookies);
      }
    }
    
    // User-Agent 설정
    const userAgent = getRandomUserAgent();
    await page.setExtraHTTPHeaders({ 'User-Agent': userAgent });
    
    // 게시판 스캔
    const stats = await scanBoardPages(board, page, keywords, excludedBoards, BACKFILL_PAGES);
    
    // 스캔이 성공적으로 완료된 경우에만 lastScanAt 업데이트
    // (stats에 error 속성이 없고, 최소한 1페이지 이상 스캔했거나 전체 스캔이 완료된 경우)
    if (stats && !stats.error && stats.pagesScanned !== undefined && stats.pagesScanned > 0) {
      // 실제 수집된 RawLog의 최근 시간을 확인하여 더 정확한 시간 사용
      let lastScanTime = new Date().toISOString();
      try {
        const recentLog = queryOne(
          'SELECT createdAt FROM RawLog WHERE boardId = ? ORDER BY createdAt DESC LIMIT 1',
          [board.id]
        );
        if (recentLog && recentLog.createdAt) {
          // RawLog의 최근 수집 시간 사용 (더 정확함)
          lastScanTime = new Date(recentLog.createdAt).toISOString();
        }
      } catch (logError) {
        logger.debug('[NaverCafeBackfill] Failed to get recent RawLog time', {
          boardId: board.id,
          error: logError.message
        });
        // 실패 시 현재 시간 사용
      }
      
      try {
        execute(
          'UPDATE MonitoredBoard SET lastScanAt = ?, updatedAt = ? WHERE id = ?',
          [lastScanTime, new Date().toISOString(), board.id]
        );
        logger.debug('[NaverCafeBackfill] Updated lastScanAt', {
          boardId: board.id,
          lastScanAt: lastScanTime
        });
      } catch (dbError) {
        logger.warn('[NaverCafeBackfill] Failed to update lastScanAt', {
          boardId: board.id,
          error: dbError.message
        });
      }
    }
    
    logger.info('[NaverCafeBackfill] Board scan complete', {
      boardId: board.id,
      boardName: board.name || board.label,
      ...stats
    });
    
    return stats;
  } catch (error) {
    logBoardScanFailure('NaverCafeBackfillWorker', board, error);
    return { error: error.message };
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(e => logger.warn('[NaverCafeBackfill] Page close failed', { error: e.message }));
    }
  }
}

/**
 * 메인 스캔 루프
 */
async function runScan() {
  let browser = null;
  
  try {
    // 브라우저 초기화 (메모리 절감 옵션)
    browser = await chromium.launch({
      headless: BROWSER_HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-sync',
        '--mute-audio',
        '--no-first-run',
        '--disable-breakpad'
      ]
    });
    
    logger.info('[NaverCafeBackfill] Browser initialized');
    
    // 설정 로드
    const keywords = await loadMonitoringKeywords();
    const excludedBoards = await loadExcludedBoards();
    
    // 활성화된 게시판 조회 (클랜 전용 워커가 담당하는 보드 id는 제외 — 부모판 이중 스캔 방지)
    const allBoards = query('SELECT * FROM MonitoredBoard WHERE enabled = 1 AND isActive = 1');
    const clanDedicated = new Set(getClanWorkerTargetMonitoredBoardIds());
    const boards = allBoards.filter((b) => !clanDedicated.has(b.id));
    
    if (boards.length === 0) {
      logger.info('[NaverCafeBackfill] No enabled boards to scan');
      return;
    }
    
    logger.info('[NaverCafeBackfill] Starting backfill scan', {
      boardsCount: boards.length,
      pagesPerBoard: BACKFILL_PAGES,
      keywordsCount: keywords.length
    });
    
    // 병렬 스캔 (동시성 제한: 2-3개)
    const limit = pLimit(2);
    const scanPromises = boards.map(board => 
      limit(() => scanBoard(board, browser, keywords, excludedBoards))
    );
    
    const results = await Promise.allSettled(scanPromises);
    
    // 결과 집계
    const summary = {
      totalBoards: boards.length,
      successful: 0,
      failed: 0,
      totalSaved: 0,
      totalDuplicates: 0,
      totalErrors: 0
    };
    
    results.forEach((result, index) => {
      const board = boards[index];
      if (result.status === 'rejected') {
        logBoardScanFailure('NaverCafeBackfillWorker', board, result.reason);
        summary.failed++;
        return;
      }
      if (result.status === 'fulfilled' && result.value && !result.value.skipped && !result.value.error) {
        summary.successful++;
        if (result.value.saved) summary.totalSaved += result.value.saved;
        if (result.value.duplicates) summary.totalDuplicates += result.value.duplicates;
        if (result.value.errors) summary.totalErrors += result.value.errors;
      } else {
        summary.failed++;
      }
    });

    const realSuccess = results.filter(
      (r) => r.status === 'fulfilled' && r.value && !r.value.skipped && !r.value.error
    ).length;
    const realFail = results.filter(
      (r) =>
        r.status === 'rejected' ||
        (r.status === 'fulfilled' && r.value && r.value.error)
    ).length;
    const attemptedReal = results.filter(
      (r) => !(r.status === 'fulfilled' && r.value && r.value.skipped)
    ).length;
    logScanCycleAllFailed('NaverCafeBackfillWorker', {
      attempted: attemptedReal,
      success: realSuccess,
      fail: realFail
    });

    logger.info('[NaverCafeBackfill] Backfill scan complete', summary);
    try {
      const { reportWorkerStats } = require('../../utils/workerStatsReporter');
      reportWorkerStats('naverCafeBackfill', summary.successful, summary.failed, {
        totalSaved: summary.totalSaved,
        totalDuplicates: summary.totalDuplicates,
        totalErrors: summary.totalErrors
      });
    } catch (e) {
      // 통계 보고 실패해도 수집 결과에는 영향 없음
    }
  } catch (error) {
    logger.error('[NaverCafeBackfill] Scan failed', {
      error: error.message,
      stack: error.stack
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
        logger.info('[NaverCafeBackfill] Browser closed');
      } catch (e) {
        logger.warn('[NaverCafeBackfill] Failed to close browser', { error: e.message });
      }
    }
  }
}

/**
 * 워커 시작
 */
async function start() {
  logger.info('[NaverCafeBackfill] Starting backfill worker', {
    pagesPerBoard: BACKFILL_PAGES,
    minWaitMs: MIN_WAIT_MS,
    maxWaitMs: MAX_WAIT_MS
  });
  
  // 첫 스캔 즉시 실행
  await runScan();
  
  // 랜덤 대기 후 재스캔 (재귀적)
  async function scheduleNext() {
    const waitTime = getRandomWaitTime();
    logger.info('[NaverCafeBackfill] Next scan scheduled', {
      waitTimeMs: waitTime,
      waitTimeMinutes: Math.floor(waitTime / 60000)
    });
    
    setTimeout(async () => {
      await runScan();
      scheduleNext(); // 재귀적으로 다음 스캔 예약
    }, waitTime);
  }
  
  scheduleNext();
}

/**
 * 워커 종료
 */
async function stop() {
  logger.info('[NaverCafeBackfill] Stopping...');
  process.exit(0);
}

// 프로세스 종료 처리
process.on('SIGTERM', async () => {
  logger.info('[NaverCafeBackfill] SIGTERM received');
  await stop();
});

process.on('SIGINT', async () => {
  logger.info('[NaverCafeBackfill] SIGINT received');
  await stop();
});

process.on('uncaughtException', async (error) => {
  logger.error('[NaverCafeBackfill] Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  await stop();
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  logger.error('[NaverCafeBackfill] Unhandled rejection', {
    reason: String(reason)
  });
});

// 시작
start().catch(err => {
  logger.error('[NaverCafeBackfill] Startup failed', { error: err.message });
  process.exit(1);
});

