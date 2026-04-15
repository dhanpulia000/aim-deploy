/**
 * 수동 게시글 수집 서비스
 * URL을 통해 네이버 카페 게시글을 즉시 수집합니다.
 */

require('dotenv').config();
const { chromium } = require('playwright');
const { prisma } = require('../libs/db');
const logger = require('../utils/logger');
const { upsertIssueFromNaverCafe } = require('./naverCafeIssues.service');
const { generateScreenshotPath, ensureScreenshotDirectory } = require('../utils/fileUtils');
const { retryBrowserOperation } = require('../utils/retry');
const { createKSTDate, toKSTISOString } = require('../utils/dateUtils');

const BROWSER_HEADLESS = process.env.BROWSER_HEADLESS !== 'false';

/**
 * URL에서 article ID 추출
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
 * URL에서 카페 ID 추출
 */
function extractCafeIdFromUrl(url) {
  try {
    const match = url.match(/\/cafes\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * 카페 ID로 PUBG PC/Mobile 구분
 */
function determineCafeGameByCafeId(cafeId) {
  if (!cafeId) return 'PUBG_PC'; // 기본값
  
  // PUBG Mobile 카페 ID: 29359582
  // PUBG PC 카페 ID: 28866679
  const cafeIdStr = String(cafeId);
  
  if (cafeIdStr === '29359582') {
    return 'PUBG_MOBILE';
  } else if (cafeIdStr === '28866679') {
    return 'PUBG_PC';
  }
  
  // 알 수 없는 카페 ID는 기본값 반환
  return 'PUBG_PC';
}

/**
 * 모바일 URL을 PC 버전으로 변환
 */
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname === 'm.cafe.naver.com') {
      urlObj.hostname = 'cafe.naver.com';
      return urlObj.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * URL 유효성 검사
 */
function validateUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('cafe.naver.com');
  } catch {
    return false;
  }
}

/**
 * 날짜 텍스트 파싱 (한국 시간 기준으로 정확히 파싱)
 * 반환된 Date 객체는 UTC로 저장되지만, 한국 시간 값을 나타냅니다.
 */
function parseDateText(dateText) {
  if (!dateText) return null;
  
  // 형식 1: "2024.12.04 09:55" (날짜 + 시간)
  const dateMatch = dateText.match(/(\d{4})[.\s-](\d{1,2})[.\s-](\d{1,2})[\s](\d{1,2}):(\d{2})/);
  if (dateMatch) {
    const [, year, month, day, hour, minute] = dateMatch;
    // 한국 시간 기준으로 정확히 생성
    // createKSTDate는 한국 시간을 UTC로 변환한 Date 객체를 반환
    // 예: 한국 시간 2025-12-23 09:30 → UTC 2025-12-23 00:30
    const timestampKST = createKSTDate(parseInt(year), parseInt(month), parseInt(day), parseInt(hour), parseInt(minute));
    return timestampKST;
  }
  
  // 형식 2: "09:55" (시간만 - 오늘 날짜로 간주)
  const timeOnlyMatch = dateText.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnlyMatch) {
    const [, hour, minute] = timeOnlyMatch;
    // 오늘 날짜의 한국 시간으로 파싱
    const now = new Date();
    const kstDateStr = now.toLocaleString('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const [month, day, year] = kstDateStr.split('/');
    const timestampKST = createKSTDate(parseInt(year), parseInt(month), parseInt(day), parseInt(hour), parseInt(minute));
    return timestampKST;
  }
  
  return null;
}

/**
 * URL을 통해 네이버 카페 게시글 수집
 * 
 * @param {string} url - 네이버 카페 게시글 URL
 * @param {string} [customCookies] - 사용자 제공 쿠키 (선택사항)
 * @returns {Promise<Object>} 수집된 이슈 정보
 */
async function ingestByUrl(url, customCookies = null) {
  let browser = null;
  let page = null;

  try {
    // URL 유효성 검사
    if (!validateUrl(url)) {
      throw new Error('유효하지 않은 네이버 카페 URL입니다. cafe.naver.com 도메인의 URL만 지원합니다.');
    }

    // 모바일 URL을 PC 버전으로 변환
    const normalizedUrl = normalizeUrl(url);
    const articleId = extractArticleIdFromUrl(normalizedUrl);

    if (!articleId) {
      throw new Error('게시글 ID를 추출할 수 없습니다. 올바른 네이버 카페 게시글 URL인지 확인해주세요.');
    }

    logger.info('[ManualIngest] Starting manual ingestion', { url: normalizedUrl, articleId });

    // 브라우저 실행 (메모리 절감 옵션)
    browser = await chromium.launch({
      headless: BROWSER_HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--mute-audio',
        '--no-first-run'
      ]
    });

    page = await browser.newPage();

    // 쿠키 설정 (사용자 제공 쿠키 우선, 없으면 환경 변수 사용)
    const cookie = customCookies || process.env.NAVER_CAFE_COOKIE;
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
        logger.debug('[ManualIngest] Cookies loaded', { 
          count: cookies.length,
          source: customCookies ? 'user-provided' : 'env-variable'
        });
      }
    } else {
      logger.debug('[ManualIngest] No cookie configured, accessing public content only');
    }

    // User-Agent 설정
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // 페이지 이동
    await retryBrowserOperation(
      () => page.goto(normalizedUrl, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      }),
      {
        maxRetries: 3,
        initialDelay: 2000,
        maxDelay: 10000,
        onRetry: (attempt, error, delay) => {
          logger.warn(`[ManualIngest] Retry ${attempt}/3 loading page after ${delay}ms`, {
            url: normalizedUrl,
            error: error.message
          });
          return delay;
        }
      }
    );

    // 안정화 대기 (페이지 로딩 완료 대기)
    await page.waitForTimeout(3000);

    // iframe 컨텍스트 확인 및 전환
    let frame = null;
    let isInIframe = false;
    
    try {
      const iframeExists = await page.evaluate(() => {
        const iframe = document.querySelector('iframe#cafe_main, iframe#cafe_main_original, iframe[name="cafe_main"]');
        return !!iframe;
      });

      if (iframeExists) {
        // iframe이 로드될 때까지 대기
        await page.waitForTimeout(2000);
        
        frame = await page.frame({ name: 'cafe_main' }) || 
               await page.frame({ url: /cafe_main/ }) ||
               page.frames().find(f => f.name() === 'cafe_main');
        
        if (frame) {
          isInIframe = true;
          logger.debug('[ManualIngest] Using iframe context', { frameUrl: frame.url() });
          
          // iframe 내부 컨텐츠가 로드될 때까지 대기
          try {
            await frame.waitForSelector('.se-main-container, .article_view', { timeout: 10000 });
          } catch (e) {
            logger.debug('[ManualIngest] Timeout waiting for iframe content, proceeding anyway');
          }
        }
      }
    } catch (iframeError) {
      logger.warn('[ManualIngest] Failed to access iframe, using main page', { error: iframeError.message });
    }

    // 게시글 내용 추출
    const contextForTextElements = isInIframe && frame ? frame : page;
    let elementTexts = [];
    
    try {
      const textElements = await contextForTextElements.$$('.se-main-container .se-text, .se-main-container p, .se-main-container .se-component-text');
      const seenTexts = new Set(); // 중복 제거를 위한 Set
      
      for (const el of textElements) {
        const text = await el.innerText();
        if (text && text.trim().length > 1) {
          const trimmedText = text.trim();
          // 중복 체크: 이미 본 텍스트이거나 다른 텍스트에 포함되어 있으면 제외
          let isDuplicate = false;
          
          // 정확히 같은 텍스트가 이미 있는지 확인
          if (seenTexts.has(trimmedText)) {
            isDuplicate = true;
          } else {
            // 다른 텍스트에 포함되어 있는지 확인 (긴 텍스트가 짧은 텍스트를 포함)
            for (const seenText of seenTexts) {
              if (seenText.includes(trimmedText) && seenText.length > trimmedText.length) {
                isDuplicate = true;
                break;
              }
              if (trimmedText.includes(seenText) && trimmedText.length > seenText.length) {
                // 현재 텍스트가 기존 텍스트를 포함하면 기존 텍스트 제거
                const index = elementTexts.indexOf(seenText);
                if (index > -1) {
                  elementTexts.splice(index, 1);
                  seenTexts.delete(seenText);
                }
                break;
              }
            }
          }
          
          if (!isDuplicate) {
            elementTexts.push(trimmedText);
            seenTexts.add(trimmedText);
          }
        }
      }
    } catch (e) {
      logger.debug('[ManualIngest] Failed to extract text elements', { error: e.message });
    }

    const contextToUse = isInIframe && frame ? frame : page;
    
    // iframe 컨텍스트에서 제목을 먼저 추출 (iframe 내부 제목 사용)
    let pageTitle = '';
    try {
      if (isInIframe && frame) {
        pageTitle = await frame.evaluate(() => {
          return document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                 document.querySelector('.title_text, .article_title, .ArticleTitle')?.textContent?.trim() ||
                 document.title || '';
        });
      } else {
        pageTitle = await page.evaluate(() => {
          return document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                 document.querySelector('.title_text, .article_title, .ArticleTitle')?.textContent?.trim() ||
                 document.title || '';
        });
      }
    } catch (e) {
      logger.debug('[ManualIngest] Failed to extract title separately', { error: e.message });
    }
    
    const postData = await contextToUse.evaluate(({ elementTextsArray, preExtractedTitle }) => {
      // 제목 추출 (미리 추출한 제목이 있으면 사용, 없으면 DOM에서 추출)
      const title = preExtractedTitle || 
                   document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                   document.querySelector('.title_text, .article_title, .ArticleTitle')?.textContent?.trim() ||
                   document.title;
      
      // 제목에서 ": 네이버 카페" 제거
      const cleanTitle = title ? title.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim() : '';
      
      // 본문 추출
      let content = '';
      let usedSelector = '';
      
      const seMainContainer = document.querySelector('.se-main-container');
      if (seMainContainer) {
        let collectedText = '';
        
        if (elementTextsArray && elementTextsArray.length > 0) {
          collectedText = elementTextsArray.join('\n');
        } else {
          // 대체 방법: DOM에서 직접 수집 (중복 제거 포함)
          // 먼저 .se-text, .se-component-text 등 구체적인 요소부터 시도
          const specificSelectors = ['.se-text', '.se-component-text', '.se-section-text', 'p', 'div[class*="se-"]'];
          const textArray = [];
          const seenTexts = new Set(); // 중복 제거를 위한 Set
          
          // 구체적인 선택자로 먼저 시도
          for (const selector of specificSelectors) {
            const textElements = seMainContainer.querySelectorAll(selector);
            textElements.forEach(el => {
              const text = el.textContent?.trim() || '';
              // 빈 줄이나 의미 없는 텍스트 제외
              if (text && text.length > 1 && !text.match(/^[\s\n\r:]+$/)) {
                // 중복 체크: 이미 본 텍스트이거나 다른 텍스트에 포함되어 있으면 제외
                let isDuplicate = false;
                
                // 정확히 같은 텍스트가 이미 있는지 확인
                if (seenTexts.has(text)) {
                  isDuplicate = true;
                } else {
                  // 다른 텍스트에 포함되어 있는지 확인
                  for (const seenText of seenTexts) {
                    // 긴 텍스트가 짧은 텍스트를 포함하는 경우
                    if (seenText.includes(text) && seenText.length > text.length) {
                      isDuplicate = true;
                      break;
                    }
                    // 현재 텍스트가 기존 텍스트를 포함하면 기존 텍스트 제거
                    if (text.includes(seenText) && text.length > seenText.length) {
                      const index = textArray.indexOf(seenText);
                      if (index > -1) {
                        textArray.splice(index, 1);
                        seenTexts.delete(seenText);
                      }
                      break;
                    }
                  }
                }
                
                if (!isDuplicate) {
                  textArray.push(text);
                  seenTexts.add(text);
                }
              }
            });
          }
          
          if (textArray.length > 0) {
            collectedText = textArray.join('\n');
          } else {
            // 최후의 수단: 전체 텍스트 사용 (하지만 제목 제거 필요)
            collectedText = seMainContainer.textContent?.trim() || '';
            // textContent는 모든 하위 요소의 텍스트를 포함하므로 중복이 있을 수 있음
            // 하지만 요소별 수집이 실패한 경우이므로 전체 텍스트 사용
          }
        }
        
        // elementTextsArray가 비어있고 collectedText도 비어있으면 textContent 직접 사용
        if (!collectedText || collectedText.length === 0) {
          collectedText = seMainContainer.textContent?.trim() || '';
        }
        
        // collectedText가 여전히 비어있지 않으면 처리
        if (collectedText && collectedText.length > 0) {
          // 제목 제거 (보수적인 로직 - startsWith만 사용)
          if (cleanTitle && cleanTitle.length > 0) {
            if (collectedText.startsWith(cleanTitle)) {
              let trimmed = collectedText.substring(cleanTitle.length).trim();
              trimmed = trimmed.replace(/^[\s\n\r:]+/, '').trim();
              if (trimmed.length > 0) {
                collectedText = trimmed;
              }
            }
          }
          
          // ": 네이버 카페" 제거
          collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
          collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*\n/g, '\n').trim();
          collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*/g, '').trim();
          
          // 최소 길이 체크 (5자 이상)
          if (collectedText.length >= 5) {
            content = collectedText;
            usedSelector = '.se-main-container (internal)';
          }
        }
      }
      
      if (!content || content.length < 1) {
        const contentSelectors = [
          '.article_view .se-main-container',
          '.article_view .se-component',
          '.ContentRenderer',
          '#articleBodyContents',
          '.ArticleContent',
          '#content-area',
          '.article_view',
          '.se-viewer',
          '.se-section-text',
          '.se-component-text',
          '.se-text'
        ];
        
        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            let text = element.textContent?.trim() || '';
            
            if (cleanTitle && cleanTitle.length > 0) {
              if (text.startsWith(cleanTitle)) {
                let trimmed = text.substring(cleanTitle.length).trim();
                trimmed = trimmed.replace(/^[\s\n\r:]+/, '').trim();
                if (trimmed.length > 0) {
                  text = trimmed;
                }
              }
            }
            
            text = text.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
            text = text.replace(/\s*:\s*네이버\s*카페\s*\n/g, '\n').trim();
            text = text.replace(/\s*:\s*네이버\s*카페\s*/g, '').trim();
            
            if (text.length > 0) {
              content = text;
              usedSelector = selector;
              break;
            }
          }
        }
      }
      
      // 방법 3: 추가 fallback (공개 게시글인 경우)
      if (!content || content.length < 1) {
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
          '[class*="post"] [class*="content"]',
          '[id*="content"]',
          '[id*="article"]',
          '.article-body',
          '.article-body-contents',
          '.article-content-wrapper',
          '.article-content-body',
          '.se-viewer .se-component',
          '.se-viewer .se-section',
          '.se-viewer .se-module'
        ];

        for (const selector of additionalSelectors) {
          try {
            const element = document.querySelector(selector);
            if (element) {
              let text = element.textContent?.trim() || element.innerText?.trim() || '';
              
              if (cleanTitle && text.startsWith(cleanTitle)) {
                text = text.substring(cleanTitle.length).trim();
                text = text.replace(/^[\s\n\r:]+/, '').trim();
              }
              
              text = text.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
              text = text.replace(/\s*:\s*네이버\s*카페\s*\n/g, '\n').trim();
              
              if (text.length >= 5 && 
                  !text.match(/^(다음글목록|말머리|인기멤버|1:1 채팅|조회 \d+|댓글 \d+|URL 복사|배틀그라운드 공식카페)/i) &&
                  !text.match(/^[\s\n\r:]+$/)) {
                content = text;
                usedSelector = selector;
                break;
              }
            }
          } catch (e) {
            // 계속
          }
        }
      }

      // 날짜 추출 (다양한 선택자 시도)
      let dateText = '';
      const dateSelectors = [
        '.article_info .date',
        '.article_info .date_text',
        '.date',
        'time[datetime]',
        '.article_info time',
        '.date_info',
        '[class*="date"]',
        '[class*="Date"]',
        'meta[property="article:published_time"]',
        'meta[name="date"]'
      ];
      
      for (const selector of dateSelectors) {
        try {
          const dateElement = document.querySelector(selector);
          if (dateElement) {
            // datetime 속성이 있으면 우선 사용
            const datetime = dateElement.getAttribute('datetime') || dateElement.getAttribute('content');
            if (datetime) {
              dateText = datetime;
              break;
            }
            // textContent 사용
            const text = dateElement.textContent?.trim();
            if (text && text.length > 0) {
              dateText = text;
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // 메타 태그에서 날짜 추출 시도
      if (!dateText) {
        const metaDate = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
                        document.querySelector('meta[name="date"]')?.getAttribute('content');
        if (metaDate) {
          dateText = metaDate;
        }
      }
      
      const author = document.querySelector('.article_info .nick, .nickname, .author')?.textContent?.trim() || null;

      return { title: cleanTitle, content, dateText, author, usedSelector };
    }, { elementTextsArray: elementTexts, preExtractedTitle: pageTitle });

    // 본문 추출 결과 로깅
    // 본문에서 불필요한 텍스트 제거 (에러 메시지, UI 텍스트 등)
    let cleanedContent = postData.content || '';
    
    // 에러 메시지 제거
    const errorPatterns = [
      /죄송합니다\.\s*문제가\s*발생했습니다\.\s*다시\s*시도해\s*주세요\.?/gi,
      /죄송합니다\s*문제가\s*발생했습니다\s*다시\s*시도해\s*주세요/gi,
      /문제가\s*발생했습니다/gi,
      /다시\s*시도해\s*주세요/gi
    ];
    
    errorPatterns.forEach(pattern => {
      cleanedContent = cleanedContent.replace(pattern, '');
    });
    
    // UI 관련 불필요한 텍스트 제거
    const uiPatterns = [
      /^다음\s*동영상\s*$/gim,
      /^subject\s*$/gim,
      /^author\s*$/gim,
      /^다음\s*동영상\s*$/gim,
      /^subject$/gim,
      /^author$/gim
    ];
    
    uiPatterns.forEach(pattern => {
      cleanedContent = cleanedContent.replace(pattern, '');
    });
    
    // 줄 단위로 필터링 (불필요한 단일 단어 줄 제거)
    const lines = cleanedContent.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      // 빈 줄은 유지
      if (trimmed.length === 0) return true;
      // 단일 단어만 있는 줄 중 불필요한 것 제거
      if (trimmed.split(/\s+/).length === 1) {
        const lowerTrimmed = trimmed.toLowerCase();
        if (['subject', 'author', '다음동영상', '다음 동영상'].includes(lowerTrimmed)) {
          return false;
        }
      }
      return true;
    });
    
    cleanedContent = filteredLines.join('\n').trim();
    
    // 연속된 빈 줄 정리 (최대 2개 연속)
    cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n').trim();
    
    // 정리된 본문으로 업데이트
    postData.content = cleanedContent;

    logger.info('[ManualIngest] Content extraction result', {
      articleId,
      title: postData.title?.substring(0, 50),
      contentLength: postData.content?.length || 0,
      contentPreview: postData.content?.substring(0, 200) || '(empty)',
      usedSelector: postData.usedSelector || 'none',
      elementTextsCount: elementTexts.length
    });

    if (!postData.title || postData.title.length === 0) {
      throw new Error('게시글 제목을 추출할 수 없습니다.');
    }

    // 본문이 비어있으면 상세 디버깅 정보 로그
    if (!postData.content || postData.content.trim().length === 0) {
      const debugInfo = await contextToUse.evaluate(() => {
        const seMain = document.querySelector('.se-main-container');
        const articleView = document.querySelector('.article_view');
        const contentRenderer = document.querySelector('.ContentRenderer');
        const allSeElements = document.querySelectorAll('[class*="se-"]');
        
        return {
          hasSeMainContainer: !!seMain,
          seMainTextLength: seMain?.textContent?.trim().length || 0,
          seMainTextPreview: seMain?.textContent?.trim().substring(0, 200) || '(none)',
          hasArticleView: !!articleView,
          articleViewTextLength: articleView?.textContent?.trim().length || 0,
          hasContentRenderer: !!contentRenderer,
          contentRendererTextLength: contentRenderer?.textContent?.trim().length || 0,
          allSeElementsCount: allSeElements.length,
          pageTitle: document.title,
          pageUrl: window.location.href
        };
      });
      
      logger.warn('[ManualIngest] Content extraction failed - debug info', {
        articleId,
        title: postData.title?.substring(0, 50),
        debugInfo
      });
    }

    // 이미지 감지 및 스크린샷 캡처 (크롤러 워커와 동일한 로직)
    let hasImages = false;
    let screenshotPath = null;
    
    try {
      // 1. iframe 컨텍스트 확인 (스크린샷용)
      let screenshotContext = page;
      let screenshotFrame = null;
      
      try {
        screenshotFrame = await page.frame({ name: 'cafe_main' });
        if (!screenshotFrame) {
          screenshotFrame = await page.frame({ url: /cafe_main/ });
        }
        if (screenshotFrame) {
          screenshotContext = screenshotFrame;
          logger.debug('[ManualIngest] Using iframe context for screenshot', { articleId });
        }
      } catch (frameError) {
        logger.debug('[ManualIngest] No iframe context for screenshot, using main page', { articleId });
      }

      // 2. 본문 컨테이너 찾기 (다중 선택자 지원)
      const containerSelectors = ['.se-main-container', '.ContentRenderer', '.article_view', '#tbody'];
      let foundContainer = null;
      let usedSelector = postData.usedSelector || '.se-main-container';

      for (const selector of containerSelectors) {
        try {
          await screenshotContext.waitForSelector(selector, { timeout: 5000 });
          foundContainer = await screenshotContext.$(selector);
          if (foundContainer) {
            usedSelector = selector;
            logger.debug('[ManualIngest] Found container for screenshot', { articleId, selector });
            break;
          }
        } catch (e) {
          // 다음 선택자 시도
          continue;
        }
      }

      // 컨테이너를 찾지 못했어도 이미지 감지는 계속 진행
      if (!foundContainer) {
        logger.warn('[ManualIngest] Container not found, checking entire page for images', {
          articleId,
          selectors: containerSelectors
        });
        usedSelector = 'body'; // 전체 페이지에서 확인
      }

      // 3. 이미지 감지 (강화된 감지 로직)
      const imageInfo = await screenshotContext.evaluate((selector) => {
        const container = selector === 'body' ? document.body : document.querySelector(selector);
        if (!container) {
          // 컨테이너를 찾지 못했어도 전체 페이지에서 이미지 확인
          const allImages = document.querySelectorAll('img');
          const allImageArray = Array.from(allImages);
          
          // 배경 이미지도 확인
          const bodyStyle = window.getComputedStyle(document.body);
          const hasBodyBackground = bodyStyle.backgroundImage && bodyStyle.backgroundImage !== 'none';
          
          return {
            hasImages: allImageArray.length > 0 || hasBodyBackground,
            imageCount: allImageArray.length,
            containerFound: false,
            hasBackgroundImage: hasBodyBackground
          };
        }
        
        // 컨테이너 내부 이미지
        const containerImages = container.querySelectorAll('img');
        const imageArray = Array.from(containerImages);
        
        // 배경 이미지 확인
        const style = window.getComputedStyle(container);
        const hasBackgroundImage = style.backgroundImage && style.backgroundImage !== 'none';
        
        // 컨테이너 내부의 모든 요소에서 배경 이미지 확인
        const allElements = container.querySelectorAll('*');
        let hasAnyBackgroundImage = hasBackgroundImage;
        for (const el of allElements) {
          const elStyle = window.getComputedStyle(el);
          if (elStyle.backgroundImage && elStyle.backgroundImage !== 'none') {
            hasAnyBackgroundImage = true;
            break;
          }
        }
        
        // SVG 이미지도 확인
        const svgImages = container.querySelectorAll('svg, [class*="svg"], [id*="svg"]');
        const hasSvg = svgImages.length > 0;
        
        // 이미지가 있는지 확인 (직접 이미지, 배경 이미지, SVG)
        const hasImages = imageArray.length > 0 || hasAnyBackgroundImage || hasSvg;
        
        return {
          hasImages: hasImages,
          imageCount: imageArray.length,
          containerFound: true,
          hasBackgroundImage: hasAnyBackgroundImage,
          hasSvg: hasSvg
        };
      }, usedSelector);

      hasImages = imageInfo.hasImages;
      
      logger.info('[ManualIngest] Image detection result', {
        articleId,
        hasImages: imageInfo.hasImages,
        imageCount: imageInfo.imageCount || 0,
        containerFound: imageInfo.containerFound !== false,
        hasBackgroundImage: imageInfo.hasBackgroundImage || false,
        hasSvg: imageInfo.hasSvg || false
      });
      
      if (!imageInfo.hasImages) {
        logger.debug('[ManualIngest] No images found, skipping screenshot', { articleId });
        screenshotPath = null;
      } else {
        logger.info('[ManualIngest] Images detected, waiting for load', { 
          articleId, 
          imageCount: imageInfo.imageCount 
        });

        // 이미지 로드 완료 대기 (최대 10초)
        const maxWaitTime = 10000;
        const startTime = Date.now();

        try {
          await screenshotContext.evaluate(async (selector, maxWait) => {
            const container = selector === 'body' ? document.body : document.querySelector(selector);
            if (!container) return false;
            
            const images = Array.from(container.querySelectorAll('img'));
            if (images.length === 0) return false;

            const loadPromises = images.map(img => {
              return new Promise((resolve) => {
                if (img.complete && img.naturalWidth > 0) {
                  resolve(true);
                  return;
                }
                
                const timeout = setTimeout(() => {
                  resolve(false); // 타임아웃 시 false 반환
                }, maxWait);
                
                img.onload = () => {
                  clearTimeout(timeout);
                  resolve(true);
                };
                img.onerror = () => {
                  clearTimeout(timeout);
                  resolve(false);
                };
              });
            });

            const results = await Promise.all(loadPromises);
            return results.some(loaded => loaded); // 하나라도 로드되면 true
          }, usedSelector, maxWaitTime);

          const waitTime = Date.now() - startTime;
          logger.debug('[ManualIngest] Images loaded', { articleId, waitTime });
        } catch (loadError) {
          logger.warn('[ManualIngest] Image load check failed, proceeding anyway', {
            articleId,
            error: loadError.message
          });
        }

        // 안정화 대기
        await screenshotContext.waitForTimeout(1500);

        // 4. 경로 생성 및 디렉토리 생성
        const pathInfo = generateScreenshotPath(articleId);
        await ensureScreenshotDirectory(pathInfo.uploadsDir);

        // 5. 스크린샷 캡처
        try {
          const containerLocator = screenshotContext.locator(usedSelector);
          await containerLocator.screenshot({ 
            path: pathInfo.fullPath,
            fullPage: false
          });
          
          screenshotPath = pathInfo.relativePath;
          logger.info('[ManualIngest] Screenshot captured successfully', { 
            articleId, 
            screenshotPath,
            usedSelector,
            imageCount: imageInfo.imageCount
          });
        } catch (screenshotError) {
          logger.warn('[ManualIngest] Failed to capture screenshot', { 
            articleId,
            error: screenshotError.message,
            usedSelector,
            stack: screenshotError.stack
          });
        }
      }
    } catch (imageError) {
      logger.warn('[ManualIngest] Failed to detect images or capture screenshot', { 
        articleId,
        error: imageError.message,
        stack: imageError.stack
      });
    }

    // 댓글 수집
    let scrapedComments = null;
    let commentCount = 0;
    let isHotTopic = false;
    
    try {
      // 댓글 영역 대기
      await retryBrowserOperation(
        async () => {
          const commentSelectors = [
            '.CommentBox',
            '.comment_area',
            '.comment_box',
            '#comment_area',
            '.CommentList',
            '.comment_list'
          ];
          
          for (const selector of commentSelectors) {
            try {
              await page.waitForSelector(selector, { timeout: 3000 });
              return;
            } catch (e) {
              continue;
            }
          }
        },
        {
          maxRetries: 2,
          initialDelay: 1000
        }
      );

      await page.waitForTimeout(1000);

      // 댓글 추출
      const comments = await page.evaluate(() => {
        const comments = [];
        const commentSelectors = [
          '.CommentItem',
          '.comment_item',
          '.CommentBox .comment',
          '.comment_area .comment',
          'li[class*="comment"]',
          '.comment_list li'
        ];
        
        for (const selector of commentSelectors) {
          const commentElements = document.querySelectorAll(selector);
          if (commentElements.length > 0) {
            commentElements.forEach((el, idx) => {
              const text = el.textContent?.trim() || '';
              const author = el.querySelector('.nickname, .nick, .author, [class*="author"]')?.textContent?.trim() || '익명';
              
              if (text && text.length > 0) {
                comments.push({
                  index: idx + 1,
                  author: author,
                  text: text,
                  date: ''
                });
              }
            });
            break;
          }
        }
        
        return comments;
      });

      if (comments && comments.length > 0) {
        scrapedComments = JSON.stringify(comments);
        commentCount = comments.length;
        isHotTopic = commentCount >= 10; // 10개 이상 댓글이면 핫토픽
        logger.info('[ManualIngest] Comments scraped', { commentCount: comments.length });
      }
    } catch (commentError) {
      logger.warn('[ManualIngest] Failed to scrape comments', { error: commentError.message });
    }

    // 로그인 필요 여부 감지
    let requiresLogin = false;
    try {
      const loginCheckResult = await page.evaluate(() => {
        const loginRequiredPatterns = [
          /로그인이 필요합니다/i,
          /회원만 볼 수 있습니다/i,
          /로그인 후 이용해주세요/i,
          /회원 전용 게시글/i,
          /비공개 게시글/i,
          /권한이 없습니다/i,
          /접근 권한이 없습니다/i
        ];
        
        const bodyText = document.body.textContent || '';
        const hasLoginMessage = loginRequiredPatterns.some(pattern => pattern.test(bodyText));
        
        const pageTitle = document.title || '';
        const currentUrl = window.location.href || '';
        const hasLoginInUrl = /login|member|auth/i.test(currentUrl);
        
        // 본문이 거의 없을 때 UI-only 여부 및 이미지-only 여부 확인
        const mainContainer = document.querySelector('.se-main-container, .article_view, .ContentRenderer');
        const mainContent = mainContainer?.textContent?.trim() || '';
        const isContentEmpty = mainContent.length < 20;
        
        const uiOnlyPatterns = [
          /^다음글목록/i,
          /^말머리/i,
          /^인기멤버/i,
          /^1:1 채팅/i,
          /^조회 \d+$/i,
          /^댓글 \d+$/i,
          /^URL 복사$/i
        ];
        const isUIOnly = uiOnlyPatterns.some(pattern => pattern.test(mainContent));

        // 컨텐츠 영역 내 이미지 존재 여부 확인 (이미지만 있는 글은 로그인 필요로 보지 않기 위함)
        let hasImages = false;
        if (mainContainer) {
          const imgs = mainContainer.querySelectorAll('img');
          const realImages = Array.from(imgs).filter(img => {
            const src = img.src || '';
            return src && !src.startsWith('data:image/svg') && img.naturalWidth > 0;
          });
          hasImages = realImages.length > 0;
        }
        
        let requiresLogin = hasLoginMessage;
        
        // 추가 휴리스틱: 카페 메인/랜딩 타이틀 + 본문 없음
        const genericTitlePatterns = [
          /^배틀그라운드\s*공식카페\s*-\s*PUBG:\s*BATTLEGROUNDS/i,
          /^네이버\s*카페$/i
        ];
        const looksLikeGenericTitle = genericTitlePatterns.some(pattern => pattern.test(pageTitle));
        
        // 본문이 없더라도 "이미지만 있는 경우"에는 로그인 필요로 분류하지 않음
        if (!hasImages) {
          if (!requiresLogin && looksLikeGenericTitle && (isContentEmpty || isUIOnly)) {
            requiresLogin = true;
          }
          
          if (!requiresLogin && isUIOnly && hasLoginInUrl) {
            requiresLogin = true;
          }
        }
        
        return { requiresLogin, hasImages, isContentEmpty };
      });
      
      requiresLogin = loginCheckResult.requiresLogin;
    } catch (loginCheckError) {
      logger.warn('[ManualIngest] Failed to check login requirement', { error: loginCheckError.message });
    }

    // 날짜 파싱 (한국 시간 기준으로 정확히 파싱)
    let createdAt = null;
    if (postData.dateText) {
      createdAt = parseDateText(postData.dateText);
      logger.debug('[ManualIngest] Date parsing result', {
        articleId,
        dateText: postData.dateText,
        parsed: createdAt ? createdAt.toISOString() : null
      });
    }
    
    // 날짜 파싱 실패 시 현재 시간 사용 (하지만 로그인 필요 게시글의 경우 경고)
    if (!createdAt) {
      if (requiresLogin) {
        logger.warn('[ManualIngest] Failed to parse date for login-required post, using current time', {
          articleId,
          dateText: postData.dateText || '(empty)',
          requiresLogin
        });
      }
      createdAt = new Date();
    }

    // 카페 게임 타입 추정 (카페 ID 기반으로 정확하게 구분)
    let cafeGame = 'PUBG_PC'; // 기본값
    try {
      const cafeId = extractCafeIdFromUrl(normalizedUrl);
      if (cafeId) {
        cafeGame = determineCafeGameByCafeId(cafeId);
        logger.debug('[ManualIngest] Determined cafeGame by cafeId', {
          cafeId,
          cafeGame,
          url: normalizedUrl
        });
      } else {
        // 카페 ID를 추출할 수 없는 경우 URL 패턴으로 대체 확인
        if (normalizedUrl.includes('pubgmobile') || normalizedUrl.includes('pubg-mobile')) {
          cafeGame = 'PUBG_MOBILE';
        }
        logger.warn('[ManualIngest] Could not extract cafeId, using URL pattern fallback', {
          cafeGame,
          url: normalizedUrl
        });
      }
    } catch (e) {
      logger.warn('[ManualIngest] Failed to determine cafeGame', {
        error: e.message,
        url: normalizedUrl,
        defaultCafeGame: cafeGame
      });
      // 기본값 유지
    }

    // Issue로 저장
    const post = {
      externalPostId: articleId,
      title: postData.title,
      content: postData.content || '',
      createdAt: createdAt,
      authorName: postData.author
    };

    const issue = await upsertIssueFromNaverCafe({
      url: normalizedUrl,
      cafeGame: cafeGame,
      post: post,
      comments: [],
      monitoredUrlId: null,
      monitoredBoardId: null,
      screenshotPath: screenshotPath,
      hasImages: hasImages,
      requiresLogin: requiresLogin,
      commentCount: commentCount,
      scrapedComments: scrapedComments,
      isHotTopic: isHotTopic,
      restoreIfExcluded: true  // 수동 수집 시 보고서 제외 완료된 이슈 → 열림 상태로 복원
    });

    logger.info('[ManualIngest] Issue created/updated', { 
      issueId: issue.id, 
      title: postData.title?.substring(0, 50) 
    });

    return {
      success: true,
      issue: {
        id: issue.id,
        summary: issue.summary,
        detail: issue.detail,
        sourceUrl: issue.sourceUrl,
        category: issue.category?.name || null,
        categoryGroup: issue.categoryGroup?.name || null,
        importance: issue.importance,
        severity: issue.severity
      }
    };

  } catch (error) {
    logger.error('[ManualIngest] Failed to ingest URL', { 
      url, 
      error: error.message,
      stack: error.stack
    });
    throw error;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        logger.warn('[ManualIngest] Failed to close page', { error: e.message });
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        logger.warn('[ManualIngest] Failed to close browser', { error: e.message });
      }
    }
  }
}

module.exports = {
  ingestByUrl
};










