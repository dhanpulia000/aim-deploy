/**
 * Playwright 기반 Naver Cafe 모니터링 워커
 * 
 * 독립 프로세스로 실행되며, MonitoredBoard를 스캔하여 RawLog에 저장합니다.
 * MonitoringKeyword를 참조하여 필터링합니다.
 */

/* eslint-env browser */
/* global document, window */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { chromium } = require('playwright');
const { query, queryOne, execute } = require('../../libs/db');
const logger = require('../../utils/logger');
const { logBoardScanFailure, logScanCycleAllFailed } = require('../../utils/workerScanErrorLog');
const { getClanWorkerTargetMonitoredBoardIds } = require('../../utils/clanMonitoredBoardIds');
const { isNaverPcFreeBoardExceptionCafeGame } = require('../../services/crawlerGames.service');
const { retryBrowserOperation } = require('../../utils/retry');
const { generateScreenshotPath, ensureScreenshotDirectory } = require('../../utils/fileUtils');
const { collectNaverPostImageUrls, downloadNaverPostImages } = require('./lib/naverPostImages');
const { toKSTISOString, nowKSTISOString } = require('../../utils/dateUtils');
const fs = require('fs').promises;

function stripTrailingSignature(text) {
  if (!text) return '';
  let cleaned = text;
  const signatureRegex = /[\r\n]+[^\r\n]{0,20}님의\s*게시글\s*더보기[\s\S]*$/i;
  const matchIndex = cleaned.search(signatureRegex);
  if (matchIndex >= 0) {
    cleaned = cleaned.substring(0, matchIndex).trim();
  }
  return cleaned;
}

// 설정
const DEFAULT_SCAN_INTERVAL_MS = 300000; // 기본 5분 (300초)
const BROWSER_HEADLESS = process.env.BROWSER_HEADLESS !== 'false';
// 백필 기간 (일): 크롤러 시작 시 최근 N일의 게시글을 다시 스캔하여 놓친 게시글 찾기
const BACKFILL_DAYS = parseInt(process.env.BACKFILL_DAYS || '0', 10); // 기본 0일 (비활성화, 필요시 환경변수로 활성화)

// 랜덤 대기 시간 범위 (밀리초)
const MIN_WAIT_MS = 150000; // 2분 30초 (150초)
const MAX_WAIT_MS = 240000; // 4분 (240초)

// 최신 브라우저 User-Agent 리스트 (2024-2025)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
];

/**
 * 랜덤 대기 시간 생성 (150초 ~ 240초)
 * @returns {number} 밀리초 단위 대기 시간
 */
function getRandomWaitTime() {
  return Math.floor(Math.random() * (MAX_WAIT_MS - MIN_WAIT_MS + 1)) + MIN_WAIT_MS;
}

/**
 * 랜덤 User-Agent 선택
 * @returns {string} User-Agent 문자열
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// 게시판 이름 정규화 유틸 (공백 제거 + 문자열화)
function normalizeBoardName(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .trim();
}

// 게시판 기반 수집 제외 설정 (기본값)
// 예: 가입인사, 등업신청, 자유게시판 등
const DEFAULT_EXCLUDED_BOARDS = [
  '가입인사',
  '등업신청',
  '자유게시판'
];

// 댓글 동향 분석 설정
const WATCH_AUTHORS = process.env.NAVER_CAFE_WATCH_AUTHORS 
  ? process.env.NAVER_CAFE_WATCH_AUTHORS.split(',').map(a => a.trim())
  : ['GM네로', 'PUBG운영우진', 'CM태이고', 'PUBG운영팀', 'PUBG운영진']; // 주시할 작성자 닉네임 배열

const HOT_TOPIC_THRESHOLD = parseInt(process.env.NAVER_CAFE_HOT_TOPIC_THRESHOLD) || 10; // 댓글 수 임계값 (10개 이상)

// 스캔 주기 로드: 환경 변수 > DB > 기본값
async function loadScanInterval() {
  // 1. 환경 변수에서 먼저 확인
  if (process.env.NAVER_CAFE_SCAN_INTERVAL_MS) {
    const envInterval = parseInt(process.env.NAVER_CAFE_SCAN_INTERVAL_MS);
    if (!isNaN(envInterval) && envInterval > 0) {
      return envInterval;
    }
  }
  
  // 2. DB에서 MonitoringConfig 확인
  try {
    const config = queryOne('SELECT * FROM MonitoringConfig WHERE key = ?', ['crawler.interval']);
    if (config && config.value) {
      const dbInterval = parseInt(config.value);
      if (!isNaN(dbInterval) && dbInterval > 0) {
        // DB 값은 초 단위이므로 밀리초로 변환
        return dbInterval * 1000;
      }
    }
  } catch (error) {
    logger.warn('[NaverCafeWorker] Failed to load scan interval from DB', { error: error.message });
  }
  
  // 3. 기본값 사용
  return DEFAULT_SCAN_INTERVAL_MS;
}

/**
 * 수집 제외 게시판 목록 로드 (일반 naverCafe 워커 전용)
 * - DB monitoringConfig: key = 'naver.excludedBoards' (JSON 배열: ["가입인사", "등업신청", ...])
 * - 설정이 없거나 파싱에 실패하면 DEFAULT_EXCLUDED_BOARDS 사용
 * - ⚠️ naverCafeClan.worker.js는 별도 loadExcludedBoardsForClanWorker() 사용 (클랜/방송/디스코드 예외)
 */
async function loadExcludedBoards() {
  try {
    const config = queryOne('SELECT * FROM MonitoringConfig WHERE key = ?', ['naver.excludedBoards']);
    
    if (!config || !config.value) {
      logger.debug('[NaverCafeWorker] No excluded boards config found, using defaults', {
        defaultExcludedBoards: DEFAULT_EXCLUDED_BOARDS
      });
      return DEFAULT_EXCLUDED_BOARDS.map(normalizeBoardName);
    }
    
    try {
      const parsed = JSON.parse(config.value);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map(name => normalizeBoardName(name))
          .filter(name => name.length > 0);
        if (normalized.length > 0) {
          logger.debug('[NaverCafeWorker] Loaded excluded boards from config', {
            original: parsed,
            normalized: normalized,
            count: normalized.length
          });
          return normalized;
        }
      }
    } catch (e) {
      logger.warn('[NaverCafeWorker] Failed to parse excluded boards config, using defaults', {
        error: e.message,
        rawValue: config.value
      });
    }
    
    logger.debug('[NaverCafeWorker] Using default excluded boards', {
      defaultExcludedBoards: DEFAULT_EXCLUDED_BOARDS
    });
    return DEFAULT_EXCLUDED_BOARDS.map(normalizeBoardName);
  } catch (error) {
    logger.warn('[NaverCafeWorker] Failed to load excluded boards config, using defaults', {
      error: error.message
    });
    return DEFAULT_EXCLUDED_BOARDS.map(normalizeBoardName);
  }
}

// 쿠키 로드: 환경 변수 또는 DB에서
async function loadNaverCafeCookie() {
  // 1. 환경 변수에서 먼저 확인
  if (process.env.NAVER_CAFE_COOKIE) {
    return process.env.NAVER_CAFE_COOKIE;
  }
  
  // 2. DB에서 MonitoringConfig 확인
  try {
    const config = queryOne('SELECT * FROM MonitoringConfig WHERE key = ?', ['naverCafeCookie']);
    if (config && config.value) {
      return config.value;
    }
  } catch (error) {
    logger.warn('[NaverCafeWorker] Failed to load cookie from DB', { error: error.message });
  }
  
  return null;
}

let NAVER_CAFE_COOKIE = null;
let SCAN_INTERVAL_MS = DEFAULT_SCAN_INTERVAL_MS;

let browser = null;
let isRunning = false;
let scanInterval = null;
let scheduledScanTimeout = null; // 랜덤 대기용 timeout

/**
 * MonitoringKeyword를 로드하여 필터링 키워드 목록 반환
 */
async function loadMonitoringKeywords() {
  try {
    const keywords = query('SELECT * FROM MonitoringKeyword WHERE enabled = 1 AND type = ?', ['naver']);
    return keywords.map(k => k.word.toLowerCase());
  } catch (error) {
    logger.error('[NaverCafeWorker] Failed to load keywords', { error: error.message });
    return [];
  }
}

/**
 * 키워드 필터링: 내용에 키워드가 포함되어 있는지 확인
 */
function matchesKeywords(text, keywords) {
  if (!keywords || keywords.length === 0) return false; // 키워드가 없으면 매칭되지 않음
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  // 키워드 정규화 (공백 제거, 소문자 변환)
  const normalizedKeywords = keywords.map(k => String(k).toLowerCase().trim()).filter(k => k.length > 0);
  if (normalizedKeywords.length === 0) return false; // 유효한 키워드가 없으면 매칭되지 않음
  
  return normalizedKeywords.some(keyword => {
    const normalizedKeyword = keyword.replace(/\s+/g, '');
    const normalizedText = lowerText.replace(/\s+/g, '');
    return normalizedText.includes(normalizedKeyword);
  });
}

/**
 * RawLog에 데이터 저장
 */
async function saveRawLog(data) {
  try {
    // 0. 이미 Issue로 승격된 게시글인지 확인
    //    댓글 수 업데이트를 위해 이슈가 있어도 RawLog는 저장 (RawLogProcessor가 이슈 업데이트 처리)
    //    단, RawLog 중복 저장은 아래 로직에서 방지
    let existingIssue = null;
    if (data.externalPostId || data.url) {
      existingIssue = queryOne(
        `SELECT id, commentCount, scrapedComments, isHotTopic FROM ReportItemIssue 
         WHERE source LIKE 'NAVER%' 
           AND (externalPostId = ? OR sourceUrl = ?)
         LIMIT 1`,
        [data.externalPostId || null, data.url || null]
      );

      if (existingIssue) {
        // 댓글 수가 변경되었는지 확인
        const currentCommentCount = data.commentCount || 0;
        const existingCommentCount = existingIssue.commentCount || 0;
        const hasCommentChange = currentCommentCount !== existingCommentCount;
        
        logger.debug('[NaverCafeWorker] Issue already exists, checking for updates', {
          externalPostId: data.externalPostId,
          url: data.url,
          issueId: existingIssue.id,
          currentCommentCount,
          existingCommentCount,
          hasCommentChange
        });
        
        // 댓글 수가 변경되지 않았고, 다른 중요한 정보도 변경되지 않았으면 RawLog 저장 스킵
        // (중복 저장 방지 및 성능 최적화)
        if (!hasCommentChange && 
            !data.scrapedComments && 
            !existingIssue.scrapedComments &&
            (data.isHotTopic === false || data.isHotTopic === existingIssue.isHotTopic)) {
          logger.debug('[NaverCafeWorker] Skipping RawLog (no significant changes)', {
            externalPostId: data.externalPostId,
            issueId: existingIssue.id
          });
          return null;
        }
        
        // 댓글 수가 변경되었거나 중요한 정보가 변경되었으면 RawLog 저장 (이슈 업데이트를 위해)
        logger.info('[NaverCafeWorker] Saving RawLog for issue update', {
          externalPostId: data.externalPostId,
          issueId: existingIssue.id,
          commentCountChange: `${existingCommentCount} -> ${currentCommentCount}`,
          hasScrapedComments: !!data.scrapedComments
        });
      }
    }

    // 중복 체크: 같은 boardId + articleId 조합이 이미 있는지 확인 (가장 정확한 방법)
    // 또는 externalPostId를 json_extract로 정확히 비교
    if (data.externalPostId || data.monitoredBoardId) {
      let existing = null;
      
      // 1. boardId + articleId 조합으로 먼저 확인 (가장 정확)
      if (data.monitoredBoardId && data.externalPostId) {
        existing = queryOne(
          `SELECT id, isProcessed, content, metadata FROM RawLog 
           WHERE source = 'naver' 
             AND boardId = ? 
             AND articleId = ?
           ORDER BY createdAt DESC LIMIT 1`,
          [data.monitoredBoardId, data.externalPostId]
        );
      }
      
      // 2. boardId + articleId로 찾지 못했으면 externalPostId로 json_extract로 정확히 비교
      if (!existing && data.externalPostId) {
        existing = queryOne(
          `SELECT id, isProcessed, content, metadata FROM RawLog 
           WHERE source = 'naver' 
             AND json_extract(metadata, '$.externalPostId') = ?
           ORDER BY createdAt DESC LIMIT 1`,
          [data.externalPostId]
        );
      }
      
      if (existing) {
          // 기존 RawLog의 본문 확인
          const existingContent = existing.content || '';
          const existingMeta = JSON.parse(existing.metadata || '{}');
          const existingTitle = existingMeta.title || '';
          
          // 기존 본문이 비어있거나 제목과 동일하거나 placeholder인 경우, 새 본문으로 업데이트
          const shouldUpdate = (
            !existingContent || 
            existingContent.trim().length === 0 ||
            existingContent === '[이미지/미디어 포함]' ||
            (existingTitle && existingContent.trim() === existingTitle.trim())
          ) && data.content && data.content.trim().length > 0 && data.content !== '[이미지/미디어 포함]';
          
          if (shouldUpdate) {
            // 기존 RawLog의 본문 업데이트
            const updatedMeta = {
              ...existingMeta,
              title: data.title || existingMeta.title, // 더 긴 제목으로 업데이트 (말머리 포함)
              externalPostId: data.externalPostId || existingMeta.externalPostId,
              url: data.url || existingMeta.url,
              screenshotPath: data.screenshotPath || existingMeta.screenshotPath,
              postImagePaths: data.postImagePaths && data.postImagePaths.length > 0
                ? data.postImagePaths
                : existingMeta.postImagePaths,
              hasImages: data.hasImages !== undefined ? data.hasImages : existingMeta.hasImages,
              requiresLogin: data.requiresLogin !== undefined ? data.requiresLogin : existingMeta.requiresLogin,
              commentCount: data.commentCount !== undefined ? data.commentCount : existingMeta.commentCount,
              scrapedComments: data.scrapedComments || existingMeta.scrapedComments,
              isHotTopic: data.isHotTopic !== undefined ? data.isHotTopic : existingMeta.isHotTopic,
              isError: data.isError !== undefined ? data.isError : existingMeta.isError,
              hasKeywordMatch: data.hasKeywordMatch !== undefined ? data.hasKeywordMatch : existingMeta.hasKeywordMatch
            };
            
            execute(
              'UPDATE RawLog SET content = ?, metadata = ?, updatedAt = ? WHERE id = ?',
              [data.content, JSON.stringify(updatedMeta), new Date().toISOString(), existing.id]
            );
            
            logger.info('[NaverCafeWorker] RawLog content updated', {
              externalPostId: data.externalPostId,
              existingId: existing.id,
              oldContentLength: existingContent.length,
              newContentLength: data.content.length,
              newContentPreview: data.content.substring(0, 100)
            });
            
            return queryOne('SELECT * FROM RawLog WHERE id = ?', [existing.id]);
          } else {
            logger.debug('[NaverCafeWorker] RawLog already exists, skipping duplicate', {
              externalPostId: data.externalPostId,
              url: data.url,
              existingId: existing.id,
              isProcessed: existing.isProcessed,
              existingContentLength: existingContent.length,
              newContentLength: data.content?.length || 0,
              existingTitle: existingTitle?.substring(0, 50),
              newTitle: data.title?.substring(0, 50)
            });
            return queryOne('SELECT * FROM RawLog WHERE id = ?', [existing.id]);
          }
      }
    }
    
    const { nanoid } = require('nanoid');
    const logId = nanoid();
    // 한국 시간 기준으로 정확히 저장
    const now = nowKSTISOString();
    // timestamp가 있으면 한국 시간 기준으로 변환, 없으면 현재 한국 시간 사용
    const timestamp = data.timestamp ? (toKSTISOString(data.timestamp) || new Date(data.timestamp).toISOString()) : now;
    
    execute(
      `INSERT INTO RawLog (id, source, content, author, timestamp, isProcessed, processingStatus, metadata, boardId, articleId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        'naver',
        data.content || '',
        data.author || null,
        timestamp,
        0,
        'NEW', // 명시적으로 NEW 상태로 설정
        JSON.stringify({
          url: data.url,
          title: data.title,
          externalPostId: data.externalPostId,
          cafeGame: data.cafeGame,
          monitoredBoardId: data.monitoredBoardId,
          screenshotPath: data.screenshotPath || null,
          postImagePaths: data.postImagePaths && data.postImagePaths.length > 0 ? data.postImagePaths : null,
          hasImages: data.hasImages || false,
          requiresLogin: data.requiresLogin || false,
          commentCount: data.commentCount || 0,
          scrapedComments: data.scrapedComments || null,
          isHotTopic: data.isHotTopic || false,
          isError: data.isError || false,
          hasKeywordMatch: data.hasKeywordMatch || false
        }),
        data.monitoredBoardId || null, // boardId
        data.externalPostId || null,   // articleId
        now,
        now
      ]
    );
    
    const rawLog = queryOne('SELECT * FROM RawLog WHERE id = ?', [logId]);
    
    logger.info('[NaverCafeWorker] RawLog saved', { 
      id: rawLog.id,
      title: data.title?.substring(0, 50),
      source: 'naver',
      author: data.author || null,
      hasScreenshot: !!data.screenshotPath,
      commentCount: data.commentCount || 0,
      hasScrapedComments: !!data.scrapedComments,
      isHotTopic: data.isHotTopic || false
    });
    
    return rawLog;
  } catch (error) {
    logger.error('[NaverCafeWorker] Failed to save RawLog', { 
      error: error.message,
      url: data.url
    });
    throw error;
  }
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
 * 본문에서 불필요한 텍스트 제거 (에러 메시지, UI 텍스트 등)
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
    /^author\s*$/gim,
    /^다음\s*동영상\s*$/gim,
    /^subject$/gim,
    /^author$/gim
  ];
  
  uiPatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // 줄 단위로 필터링 (불필요한 단일 단어 줄 제거)
  const lines = cleaned.split('\n');
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
  
  cleaned = filteredLines.join('\n').trim();
  
  // 연속된 빈 줄 정리 (최대 2개 연속)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  return cleaned.trim();
}

/**
 * Naver Cafe 게시판 스캔
 */
async function scanBoard(board) {
  let page;
  if (!browser) {
    logger.error('[NaverCafeWorker] Browser not initialized');
    return;
  }

  try {
    // 수집 제외 게시판 설정 로드 (게시판 단위 필터)
    const excludedBoards = await loadExcludedBoards();
    const boardName = (board.name || '').trim();
    const normBoardName = normalizeBoardName(boardName);
    
    // 클랜 관련 게시판 여부 확인 (게시판 제외 설정 무시)
    // 정규화 전 원본 이름과 정규화된 이름 모두 확인
    const isClanBoard = (normBoardName && (
      normBoardName.includes('클랜/방송/디스코드') ||
      normBoardName.includes('클랜홍보') ||
      normBoardName.includes('클랜홍보')
    )) || (boardName && (
      boardName.includes('클랜/방송/디스코드') ||
      boardName.includes('클랜 홍보') ||
      boardName.includes('클랜홍보') ||
      boardName.includes('🏰')
    ));
    
    // 양방향 비교: 게시판 이름이 제외 목록을 포함하거나, 제외 목록이 게시판 이름을 포함하는지 확인
    // 단, 클랜 관련 게시판은 제외 설정을 무시하고 수집
    const isExcludedBoard = !isClanBoard &&
      normBoardName &&
      Array.isArray(excludedBoards) &&
      excludedBoards.some((excludedName) => {
        const normExcludedName = normalizeBoardName(excludedName);
        // naverFlavor pc 프로필: 자유게시판은 기본 제외에 있어도 수집 유지
        if (normExcludedName === '자유게시판' && isNaverPcFreeBoardExceptionCafeGame(board.cafeGame)) {
          return false;
        }
        // 양방향 부분 일치 확인
        return normBoardName.includes(normExcludedName) || normExcludedName.includes(normBoardName);
      });

    if (isExcludedBoard) {
      logger.info('[NaverCafeWorker] Skipping board (excluded by config)', {
        boardId: board.id,
        boardName,
        normBoardName,
        excludedBoards,
        excludedBoardsNormalized: excludedBoards.map(n => normalizeBoardName(n))
      });
      return;
    }
    
    if (isClanBoard) {
      logger.info('[NaverCafeWorker] Clan board detected - ignoring excluded board config', {
        boardId: board.id,
        boardName,
        normBoardName
      });
    }
    
    logger.debug('[NaverCafeWorker] Board not excluded, proceeding with scan', {
      boardId: board.id,
      boardName,
      normBoardName,
      excludedBoardsCount: excludedBoards.length
    });

    // 브라우저 상태 확인
    if (!browser || !browser.isConnected()) {
      logger.warn('[NaverCafeWorker] Browser not connected, skipping scan', { boardId });
      return;
    }
    
    // 쿠키 동적 로드 (매 스캔마다 최신 쿠키 사용)
    const cookie = await loadNaverCafeCookie();
    
    try {
      page = await browser.newPage();
    } catch (error) {
      logger.error('[NaverCafeWorker] Failed to create new page', {
        boardId,
        error: error.message,
        browserConnected: browser?.isConnected()
      });
      // 브라우저 재시작 필요
      if (browser && !browser.isConnected()) {
        logger.warn('[NaverCafeWorker] Browser disconnected, will restart on next scan');
        browser = null;
      }
      return;
    }
    
    // 한글 폰트 설정 (스크린샷 텍스트 깨짐 방지)
    await page.addInitScript(() => {
      // 폰트 로딩을 위한 link 태그 추가
      const fontLink = document.createElement('link');
      fontLink.rel = 'preconnect';
      fontLink.href = 'https://fonts.googleapis.com';
      document.head.appendChild(fontLink);
      
      const fontLink2 = document.createElement('link');
      fontLink2.rel = 'preconnect';
      fontLink2.href = 'https://fonts.gstatic.com';
      fontLink2.crossOrigin = 'anonymous';
      document.head.appendChild(fontLink2);
      
      // Google Fonts에서 한글 폰트 로드
      const nanumLink = document.createElement('link');
      nanumLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap';
      nanumLink.rel = 'stylesheet';
      document.head.appendChild(nanumLink);
      
      // CSS 스타일 강제 적용
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
    
    // 쿠키 설정
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
        logger.debug('[NaverCafeWorker] Cookies loaded', { count: cookies.length });
      }
    } else {
      logger.debug('[NaverCafeWorker] No cookie configured, accessing public content only');
    }

    // User-Agent 설정 (랜덤 선택)
    const userAgent = getRandomUserAgent();
    await page.setExtraHTTPHeaders({
      'User-Agent': userAgent
    });
    logger.debug('[NaverCafeWorker] User-Agent set', { userAgent });

    // URL 우선순위: url > listUrl
    let targetUrl = board.url || board.listUrl;
    
    // 리스트형 보기 강제 및 페이지당 게시글 수 늘리기
    // URL에 viewType=title, listType=50 파라미터 추가
    try {
      const urlObj = new URL(targetUrl);
      // 기존 viewType 파라미터 제거 후 재설정
      urlObj.searchParams.delete('search.viewType');
      urlObj.searchParams.delete('viewType');
      urlObj.searchParams.set('search.viewType', 'title'); // 리스트형 강제
      
      // 페이지당 게시글 수 늘리기 (50개씩 보기)
      urlObj.searchParams.delete('search.listType');
      urlObj.searchParams.delete('listType');
      urlObj.searchParams.set('search.listType', '50'); // 50개씩 보기
      
      targetUrl = urlObj.toString();
      logger.debug('[NaverCafeWorker] URL modified to force list view and increase items per page', {
        originalUrl: board.url || board.listUrl,
        modifiedUrl: targetUrl
      });
    } catch (urlError) {
      // URL 파싱 실패 시 원본 URL 사용하되, 파라미터를 추가 시도
      if (!targetUrl.includes('search.viewType=') && !targetUrl.includes('viewType=')) {
        const separator = targetUrl.includes('?') ? '&' : '?';
        targetUrl = `${targetUrl}${separator}search.viewType=title`;
      }
      if (!targetUrl.includes('search.listType=') && !targetUrl.includes('listType=')) {
        const separator = targetUrl.includes('?') ? '&' : '?';
        targetUrl = `${targetUrl}${separator}search.listType=50`;
      }
      logger.debug('[NaverCafeWorker] URL parameters appended', {
        modifiedUrl: targetUrl
      });
    }
    
    logger.info('[NaverCafeWorker] Scanning board', {
      boardId: board.id,
      name: board.name || board.label,
      url: targetUrl
    });

    // 게시판 목록 페이지 로드 (재시도 로직 적용)
    // networkidle 대신 domcontentloaded 사용 (네이버 카페는 동적 로딩이 많아 networkidle이 도달하지 않을 수 있음)
    await retryBrowserOperation(
      () => page.goto(targetUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 // 45초 -> 30초로 단축
      }),
      {
        maxRetries: 3,
        initialDelay: 2000,
        maxDelay: 10000,
        onRetry: (attempt, error, delay) => {
          logger.warn(`[NaverCafeWorker] Retry ${attempt}/3 loading board list after ${delay}ms`, {
            url: targetUrl,
            error: error.message
          });
          return delay;
        }
      }
    );

    // iframe 컨텍스트 확인 및 전환
    let frame = null;
    let isInIframe = false;
    
    try {
      // iframe이 있는지 확인
      const iframeExists = await page.evaluate(() => {
        // eslint-disable-next-line no-undef
        const iframe = document.querySelector('iframe#cafe_main, iframe#cafe_main_original, iframe[name="cafe_main"]');
        return !!iframe;
      });

      if (iframeExists) {
        logger.debug('[NaverCafeWorker] Iframe detected, attempting to switch context');
        
        // Playwright의 frame API로 iframe 전환 시도
        try {
          frame = await page.frame({ name: 'cafe_main' });
          if (!frame) {
            // name으로 찾지 못하면 id로 시도
            frame = await page.frame({ url: /cafe_main/ });
          }
          
          if (frame) {
            isInIframe = true;
            logger.info('[NaverCafeWorker] Successfully switched to iframe context', {
              frameName: frame.name(),
              frameUrl: frame.url()
            });
          } else {
            logger.warn('[NaverCafeWorker] Iframe exists but frame context not found, using main page');
          }
        } catch (frameError) {
          logger.warn('[NaverCafeWorker] Failed to switch to iframe context, using main page', {
            error: frameError.message
          });
        }
      } else {
        logger.debug('[NaverCafeWorker] No iframe detected, using main page context');
      }
    } catch (iframeCheckError) {
      logger.warn('[NaverCafeWorker] Error checking for iframe, using main page', {
        error: iframeCheckError.message
      });
    }

    // iframe이 있으면 frame을, 없으면 page를 사용
    const context = frame || page;

    // 목록 로딩 완료 대기: 최소 10개 이상의 게시글 행이 로드될 때까지 기다림
    logger.debug('[NaverCafeWorker] Waiting for list items to load', {
      boardId: board.id,
      isInIframe
    });

    try {
      // waitForFunction을 사용하여 최소 10개 이상의 행이 로드될 때까지 대기
      // 구형 ArticleList.nhn은 #upperArticleList 내 table > tr (tbody 없음) 구조일 수 있음
      await context.waitForFunction(
        () => {
          const listRows = document.querySelectorAll('tbody tr:not(.board-notice)');
          const cardRows = document.querySelectorAll('.article-card, .article-item, .board-list-item');
          const allRows = document.querySelectorAll('tbody tr');
          const upperListRows = document.querySelectorAll('#upperArticleList tr');
          
          const count = Math.max(
            listRows.length,
            cardRows.length,
            allRows.length,
            upperListRows.length
          );
          
          return count >= 10; // 최소 10개 이상
        },
        {
          timeout: 30000, // 최대 30초 대기
          polling: 500 // 500ms마다 체크
        }
      );
      
      logger.info('[NaverCafeWorker] List items loaded (minimum 10 items found)');
    } catch (waitError) {
      // 타임아웃이 발생해도 계속 진행 (게시글이 10개 미만일 수도 있음)
      logger.warn('[NaverCafeWorker] Timeout waiting for minimum items, proceeding anyway', {
        boardId: board.id,
        error: waitError.message
      });
      
      // 추가 안정화 대기 (1초)
      await page.waitForTimeout(1000);
    }

    // 게시글 목록 파싱 (댓글 수 및 작성자 정보 포함)
    // DOM 요소 카운트 및 상세 디버깅 로그 추가
    const domStats = await context.evaluate(() => {
      // 다양한 선택자로 DOM 요소 카운트
      const selectors = {
        'tbody tr': document.querySelectorAll('tbody tr').length,
        'tbody tr:not(.board-notice)': document.querySelectorAll('tbody tr:not(.board-notice)').length,
        '#upperArticleList tr': document.querySelectorAll('#upperArticleList tr').length,
        '.article-board > table > tbody > tr': document.querySelectorAll('.article-board > table > tbody > tr').length,
        'tbody tr.board-notice': document.querySelectorAll('tbody tr.board-notice').length,
        // 리스트형 외 다른 보기 방식도 확인
        '.article-list': document.querySelectorAll('.article-list').length,
        '.article-card': document.querySelectorAll('.article-card').length,
        '.board-list': document.querySelectorAll('.board-list').length
      };
      
      return selectors;
    });
    
    logger.info('[NaverCafeWorker] DOM elements count', {
      boardId: board.id,
      url: targetUrl,
      isInIframe,
      frameContext: frame ? frame.name() : 'main',
      domStats
    });

    const posts = await context.evaluate((params) => {
      const { watchAuthors, excludedBoards } = params || {};
      const posts = [];
      
      // 정규화 함수 (브라우저 컨텍스트 내에서 사용)
      const normalizeBoardName = (name) => {
        return String(name || '').replace(/\s+/g, '').trim();
      };
      
      // 다양한 보기 방식에 대응하는 선택자 시도
      // 1. 리스트형 (기본): tbody tr (공지 포함)
      // 2. 구형 ArticleList.nhn: #upperArticleList tr (tbody 없이 table > tr 구조)
      // 3. 카드형/앨범형: .article-card, .article-item 등
      let rows = [];
      
      const listRows = document.querySelectorAll('tbody tr');
      const upperListRows = document.querySelectorAll('#upperArticleList tr');
      if (listRows.length > 0) {
        rows = Array.from(listRows);
      } else if (upperListRows.length > 0) {
        rows = Array.from(upperListRows);
      } else {
        const cardRows = document.querySelectorAll('.article-card, .article-item, .board-list-item');
        if (cardRows.length > 0) {
          rows = Array.from(cardRows);
        } else {
          rows = Array.from(document.querySelectorAll('tbody tr'));
        }
      }
      
      // 디버깅: 총 행 수
      const totalRows = rows.length;
      let skippedNoLink = 0;
      let skippedNoHref = 0;
      let skippedNoTitle = 0;
      let skippedExcludedBoard = 0;
      let added = 0;
      const excludedBoardDetails = []; // 디버깅용: 제외된 게시판 정보
      
      rows.forEach((row, index) => {
        // 다양한 링크 선택자 시도 (구형 ArticleList.nhn 포함)
        let link = row.querySelector('td .board-list .inner_list a.article');
        if (!link) {
          link = row.querySelector('a.article, a[href*="/ArticleRead.nhn"], a[href*="/ArticleDetail.nhn"], a[href*="ArticleRead.nhn"]');
        }
        if (!link) {
          link = row.querySelector('.article-title a, .title a, a.title');
        }
        if (!link) {
          // 구형 목록: td 내 게시글 링크 (상대 경로 ArticleRead.nhn 포함)
          link = row.querySelector('a[href*="ArticleRead"]');
        }
        
        if (!link) {
          skippedNoLink++;
          return;
        }
        
        const href = link.getAttribute('href') || '';
        let title = link.textContent?.trim() || link.innerText?.trim() || '';
        // 네이버 카페 목록: 행당 한 셀만 있음. 오늘 글은 시간만 "00:27", 이전 날짜는 "2026.02.25." 형식
        // <td class="td_normal type_date">00:27</td> 또는 <td class="td_normal type_date">2026.02.25.</td>
        let dateText = '';
        const dateCell = row.querySelector('td.td_normal.type_date, td.type_date, td[class*="type_date"]');
        if (dateCell) dateText = (dateCell.textContent || '').trim();
        if (!dateText) {
          dateText = row.querySelector('.date, .article-date, time')?.textContent?.trim() ||
                     row.querySelector('time')?.getAttribute('datetime') || '';
        }
        const author = row.querySelector('td .author, td .nickname, td .td_name, .author, .nickname, .writer')?.textContent?.trim() || null;
        
        // 댓글 수 추출: 오직 제목 옆 [숫자]만 사용
        // 기준: 리스트 페이지에서 제목 옆 [숫자] 패턴만 찾기
        // 주의: 댓글 수가 아닌 다른 숫자(조회수, 게시글 번호 등)와 혼동될 수 있으므로 주의 필요
        let commentCountFromTitle = 0;
        if (link) {
          // 방법 0: 제목 텍스트 자체에 [숫자]가 포함되어 있는지 확인 (가장 정확)
          // 예: "진짜 배린이인데요 [3]" -> 3 추출
          const titleWithBracket = title.match(/\[(\d+)\]/);
          if (titleWithBracket) {
            commentCountFromTitle = parseInt(titleWithBracket[1], 10) || 0;
          }
          
          // 방법 1: 제목 링크의 바로 다음 형제 요소에서 [숫자] 패턴 찾기
          if (!commentCountFromTitle && link.nextSibling) {
            const siblingText = link.nextSibling.textContent?.trim() || '';
            // 정확히 [숫자] 패턴만 찾기
            const siblingCommentMatch = siblingText.match(/^\s*\[(\d+)\]\s*$/);
            if (siblingCommentMatch) {
              commentCountFromTitle = parseInt(siblingCommentMatch[1], 10) || 0;
            }
          }
          
          // 방법 2: 형제 요소에서 찾지 못한 경우, 제목 링크의 부모 요소에서 형제 요소 확인
          if (!commentCountFromTitle && link.parentElement) {
            const parent = link.parentElement;
            const children = Array.from(parent.children);
            const linkIndex = children.indexOf(link);
            if (linkIndex >= 0 && linkIndex < children.length - 1) {
              const nextSibling = children[linkIndex + 1];
              const nextSiblingText = nextSibling.textContent?.trim() || '';
              // 정확히 [숫자] 패턴만 찾기
              const nextSiblingMatch = nextSiblingText.match(/^\s*\[(\d+)\]\s*$/);
              if (nextSiblingMatch) {
                commentCountFromTitle = parseInt(nextSiblingMatch[1], 10) || 0;
              }
            }
          }
          
          // 방법 3: 댓글 수 전용 셀렉터 시도 (더 정확함)
          // 네이버 카페 리스트 페이지에서 댓글 수는 보통 특정 클래스나 구조로 표시됨
          if (!commentCountFromTitle) {
            // 댓글 수 전용 셀렉터들 시도 (명확한 클래스명만 사용)
            const commentCountSelectors = [
              '.comment_count',
              '.reply_count',
              '.cmt_count',
              'td.td_comment',
              'td.td_reply'
            ];
            
            for (const selector of commentCountSelectors) {
              const commentElement = row.querySelector(selector);
              if (commentElement) {
                const commentText = commentElement.textContent?.trim() || '';
                // [숫자] 패턴만 찾기 (가장 안전)
                const commentMatch = commentText.match(/\[(\d+)\]/);
                if (commentMatch) {
                  commentCountFromTitle = parseInt(commentMatch[1], 10) || 0;
                  break;
                }
                // "댓글" 또는 "reply" 텍스트와 함께 숫자가 있는 경우만 인정
                const commentTextMatch = commentText.match(/(?:댓글|reply|답글|comment)\s*[:\s]*(\d+)/i);
                if (commentTextMatch) {
                  commentCountFromTitle = parseInt(commentTextMatch[1], 10) || 0;
                  break;
                }
                // 숫자만 있는 경우는 제외 (작성자명, 조회수 등과 혼동 가능)
                // 이전 코드: numOnlyMatch 제거됨
              }
            }
          }
        }
        
        // 게시판 이름 추출 (카테고리/게시판 컬럼 기반) - 다양한 선택자 시도
        let boardNameElement = row.querySelector('a.board_name, .board_name');
        if (!boardNameElement) {
          boardNameElement = row.querySelector('td.td_board a, td.td_category a');
        }
        if (!boardNameElement) {
          boardNameElement = row.querySelector('.board_area .board_name, .category_name');
        }
        if (!boardNameElement) {
          // 추가 선택자 시도
          boardNameElement = row.querySelector('[class*="board"], [class*="category"], [class*="cafe"]');
        }
        if (!boardNameElement) {
          // 테이블 셀에서 직접 추출 시도 (20자 제한 완화: 50자로 확대)
          const cells = row.querySelectorAll('td');
          for (const cell of cells) {
            const text = cell.textContent?.trim() || '';
            // 게시판 이름으로 보이는 텍스트 찾기 (길이 제한 완화: 50자까지 허용)
            if (text && text.length > 0 && text.length <= 50 && !text.match(/^\d+$/) && !text.match(/^\d{4}-\d{2}-\d{2}/) && !text.match(/^\d{1,2}:\d{2}$/)) {
              // 링크가 있는 셀 우선 선택 (게시판 이름은 보통 링크로 표시됨)
              const hasLink = cell.querySelector('a');
              if (hasLink) {
                boardNameElement = cell;
                break;
              }
            }
          }
          // 링크가 있는 셀을 찾지 못했으면 링크 없는 셀도 시도
          if (!boardNameElement) {
            for (const cell of cells) {
              const text = cell.textContent?.trim() || '';
              if (text && text.length > 0 && text.length <= 50 && !text.match(/^\d+$/) && !text.match(/^\d{4}-\d{2}-\d{2}/) && !text.match(/^\d{1,2}:\d{2}$/)) {
                boardNameElement = cell;
                break;
              }
            }
          }
        }
        
        const boardName = boardNameElement?.textContent?.trim() || '';
        const normBoardName = normalizeBoardName(boardName);
        
        // 게시판 이름 추출 실패 시 디버깅 로그 (제목에 "질문"이 포함된 경우만)
        if (!boardName && title && (title.includes('질문') || title.includes('컴린이'))) {
          // 디버깅: 게시판 이름 추출 실패한 경우 로그 (나중에 분석용)
          // 실제 로그는 나중에 추가할 수 있음
        }
        
        // 클랜 관련 게시글 여부 확인 (게시판 제외 설정 무시)
        const isClanRelated = title && (
          title.includes('클랜/방송/디스코드') ||
          title.includes('클랜 홍보') ||
          title.includes('클랜홍보') ||
          title.startsWith('🏰┃클랜/방송/디스코드')
        );
        
        // 수집 제외 게시판 필터링 (양방향 부분 일치 허용)
        // 단, 클랜 관련 게시글은 제외 설정을 무시하고 수집
        if (!isClanRelated && normBoardName && Array.isArray(excludedBoards) && excludedBoards.length > 0) {
          const matchedExcluded = excludedBoards.find((excludedName) => {
            const normExcludedName = normalizeBoardName(excludedName);
            // 양방향 부분 일치 확인
            return normBoardName.includes(normExcludedName) || normExcludedName.includes(normBoardName);
          });
          
          if (matchedExcluded) {
            excludedBoardDetails.push({
              boardName: boardName,
              normBoardName: normBoardName,
              matchedExcluded: matchedExcluded,
              title: title?.substring(0, 50) || ''
            });
            skippedExcludedBoard++;
            return;
          }
        }
        
        if (!href) {
          skippedNoHref++;
          return;
        }
        
        // 댓글 수 추출: 오직 제목 옆 [숫자]만 사용
        // 다른 셀렉터를 통한 추출은 제거 (조회수, 게시글 번호 등과 혼동 가능)
        const commentCount = commentCountFromTitle || 0;
        
        if (title) {
          posts.push({
            href,
            title,
            dateText,
            author,
            commentCount
          });
          added++;
        } else {
          skippedNoTitle++;
        }
      });
      
      return {
        posts,
        stats: {
          totalRows,
          skippedNoLink,
          skippedNoHref,
          skippedNoTitle,
          skippedExcludedBoard,
          added
        },
        excludedBoardDetails: excludedBoardDetails.slice(0, 10) // 최대 10개만 반환 (디버깅용)
      };
    }, { watchAuthors: WATCH_AUTHORS, excludedBoards });

    const postsList = posts.posts || posts; // 호환성: posts가 객체인 경우와 배열인 경우 모두 처리
    const extractionStats = posts.stats || {};
    const excludedBoardDetails = posts.excludedBoardDetails || [];

    // 제외된 게시판이 있으면 상세 로그 출력
    if (extractionStats.skippedExcludedBoard > 0) {
      logger.info('[NaverCafeWorker] Excluded boards detected', {
        boardId: board.id,
        excludedCount: extractionStats.skippedExcludedBoard,
        excludedBoards: excludedBoardDetails,
        configuredExcludedBoards: excludedBoards
      });
    }

    logger.info('[NaverCafeWorker] Post extraction summary', {
      boardId: board.id,
      url: targetUrl,
      totalRowsFound: extractionStats.totalRows || postsList.length,
      skippedNoLink: extractionStats.skippedNoLink || 0,
      skippedNoHref: extractionStats.skippedNoHref || 0,
      skippedNoTitle: extractionStats.skippedNoTitle || 0,
      skippedExcludedBoard: extractionStats.skippedExcludedBoard || 0,
      postsExtracted: postsList.length,
      domStats
    });

    // 키워드 로드
    const keywords = await loadMonitoringKeywords();

    // 각 게시글 처리
    let newPostsCount = 0;
    let lastArticleIdNum = board.lastArticleId ? parseInt(board.lastArticleId, 10) || 0 : 0;
    
    // lastScanAt 시간대 정보 로드 및 변환
    const lastScanAt = board.lastScanAt ? new Date(board.lastScanAt) : null;
    let lastScanAtUTC = lastScanAt ? new Date(lastScanAt.toISOString()) : null;
    const lastScanAtKST = lastScanAt ? new Date(lastScanAt.getTime() + (9 * 60 * 60 * 1000)) : null; // UTC + 9시간 = KST
    
    // 백필 모드: 최근 N일의 게시글을 다시 스캔하여 놓친 게시글 찾기
    // lastScanAt을 N일 전으로 조정 (실제 DB 값은 변경하지 않음)
    let backfillMode = false;
    let originalLastScanAtUTC = lastScanAtUTC;
    if (BACKFILL_DAYS > 0) {
      const backfillDate = new Date(Date.now() - (BACKFILL_DAYS * 24 * 60 * 60 * 1000));
      if (!lastScanAtUTC || backfillDate < lastScanAtUTC) {
        // lastScanAt이 없거나, 백필 기간이 lastScanAt보다 더 오래된 경우
        lastScanAtUTC = backfillDate;
        backfillMode = true;
        logger.info('[NaverCafeWorker] Backfill mode enabled', {
          boardId: board.id,
          backfillDays: BACKFILL_DAYS,
          originalLastScanAt: originalLastScanAtUTC ? originalLastScanAtUTC.toISOString() : null,
          adjustedLastScanAt: lastScanAtUTC.toISOString(),
          reason: 'Scanning recent posts to find missed ones'
        });
      }
    }
    
    logger.info('[NaverCafeWorker] Starting post processing', {
      boardId: board.id,
      totalPosts: postsList.length,
      lastArticleId: board.lastArticleId,
      lastArticleIdNum,
      lastScanAt: originalLastScanAtUTC ? originalLastScanAtUTC.toISOString() : null,
      lastScanAtUTC: lastScanAtUTC ? lastScanAtUTC.toISOString() : null,
      lastScanAtKST: lastScanAtKST ? lastScanAtKST.toISOString() : null,
      backfillMode,
      backfillDays: backfillMode ? BACKFILL_DAYS : null,
      keywordsCount: keywords.length
    });
    
    // 필터링 통계
    let skippedNoArticleId = 0;
    let skippedAlreadyProcessed = 0;
    let keywordMatchedCount = 0; // 키워드 매칭된 게시글 수
    let skippedByDate = 0; // 날짜로 인한 스킵
    let savedCount = 0;
    let errorCount = 0;

    for (const postInfo of postsList) {
      try {
        // articleId 추출
        const baseUrl = board.url || board.listUrl;
        const articleUrl = postInfo.href.startsWith('http') 
          ? postInfo.href 
          : new URL(postInfo.href, baseUrl).href;
        
        const articleId = extractArticleIdFromUrl(articleUrl);
        if (!articleId) {
          skippedNoArticleId++;
          logger.debug('[NaverCafeWorker] Skipped post (no articleId)', {
            boardId: board.id,
            href: postInfo.href,
            articleUrl,
            title: postInfo.title?.substring(0, 50)
          });
          continue;
        }

        const articleIdNum = parseInt(articleId, 10) || 0;
        
        // 날짜 기반 필터링 (시간대 문제 확인용)
        // 목록에서 추출한 날짜 텍스트 파싱 (KST로 가정)
        let postDateKST = null;
        let postDateUTC = null;
        if (postInfo.dateText) {
          const { createKSTDate, parseKSTDate } = require('../../utils/dateUtils');
          // 형식 1: "2024.12.04 09:55" 또는 "2024-12-04 09:55" 또는 "2024/12/04 09:55" (날짜 + 시간)
          // 더 포괄적인 정규식: 날짜 구분자가 . 또는 - 또는 / 또는 공백, 시간 구분자가 : 또는 .
          const dateMatch = postInfo.dateText.match(/(\d{4})[.\s\/-](\d{1,2})[.\s\/-](\d{1,2})[\s]+(\d{1,2})[:.](\d{2})/);
          if (dateMatch) {
            const [, year, month, day, hour, minute] = dateMatch;
            // createKSTDate는 이미 UTC로 변환된 Date를 반환하므로 바로 사용
            postDateUTC = createKSTDate(parseInt(year), parseInt(month), parseInt(day), parseInt(hour), parseInt(minute));
            postDateKST = postDateUTC; // 참조용 (실제로는 UTC Date이지만 한국 시간 값)
          } else {
            // 형식 2: "2024.12.04" 또는 "2025.12.12." 또는 "2024-12-04" (날짜만 - 자정(00:00)으로 간주)
            const dateOnlyMatch = postInfo.dateText.match(/(\d{4})[.\s\/-](\d{1,2})[.\s\/-](\d{1,2})/);
            if (dateOnlyMatch) {
              const [, year, month, day] = dateOnlyMatch;
              // 날짜만 있는 경우 자정(00:00)으로 간주
              // createKSTDate는 이미 UTC로 변환된 Date를 반환하므로 바로 사용
              postDateUTC = createKSTDate(parseInt(year), parseInt(month), parseInt(day), 0, 0);
              postDateKST = postDateUTC; // 참조용
            } else {
              // 형식 3: "09:55" 또는 "9:55" (시간만)
              // 목록 페이지에서는 시간만 있는 경우 날짜 추정이 어려우므로,
              // 상세 페이지에서 더 정확한 날짜 정보를 확인하도록 함
              // 여기서는 일단 오늘로 간주하되, 상세 페이지 파싱에서 재확인
              const timeOnlyMatch = postInfo.dateText.match(/^(\d{1,2})[:.](\d{2})$/);
              if (timeOnlyMatch) {
                const [, hour, minute] = timeOnlyMatch;
                // 목록 페이지에서는 시간만 있는 경우 날짜 추정이 어려우므로
                // 일단 오늘 날짜로 설정하되, 상세 페이지에서 더 정확한 날짜로 업데이트될 수 있음
                const now = new Date();
                const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
                const kstHour = kstNow.getHours();
                const kstMinute = kstNow.getMinutes();
                const parsedHour = parseInt(hour);
                const parsedMinute = parseInt(minute);
                
                // 크롤링 시간과 파싱된 시간 비교
                let targetDate = new Date(kstNow);
                const parsedTimeMinutes = parsedHour * 60 + parsedMinute;
                const crawlTimeMinutes = kstHour * 60 + kstMinute;
                
                if (parsedTimeMinutes > crawlTimeMinutes + 60) {
                  // 파싱된 시간이 크롤링 시간보다 1시간 이상 크면 어제로 간주
                  targetDate.setDate(targetDate.getDate() - 1);
                }
                
                const year = targetDate.getFullYear();
                const month = targetDate.getMonth() + 1;
                const day = targetDate.getDate();
                
                // createKSTDate는 이미 UTC로 변환된 Date를 반환하므로 바로 사용
                postDateUTC = createKSTDate(year, month, day, parsedHour, parsedMinute);
                postDateKST = postDateUTC; // 참조용
              }
            }
          }
        }
        
        // articleId 기반 필터링 (날짜 파싱 실패 시 대체 필터)
        // 날짜 파싱이 성공하면 날짜 기반 필터링 우선, 실패하면 articleId 기반 필터링 사용
        // 단, articleId가 더 크면 무조건 처리 (날짜 파싱 오류 가능성 고려)
        // 백필 모드에서는 articleId 필터링 완화 (놓친 게시글 찾기)
        let shouldSkipByArticleId = false;
        if (!postDateUTC && lastArticleIdNum > 0 && !backfillMode) {
          // 날짜 파싱 실패 시 articleId로 필터링 (백필 모드가 아닐 때만)
          if (articleIdNum <= lastArticleIdNum) {
            shouldSkipByArticleId = true;
            skippedAlreadyProcessed++;
            logger.debug('[NaverCafeWorker] Skipped post (already processed by articleId, date parsing failed)', {
              boardId: board.id,
              articleId,
              articleIdNum,
              lastArticleIdNum,
              title: postInfo.title?.substring(0, 50),
              dateText: postInfo.dateText
            });
          } else {
            // articleId가 더 크면 날짜 파싱 실패해도 처리
            logger.info('[NaverCafeWorker] Processing post (articleId is newer, date parsing failed)', {
              boardId: board.id,
              articleId,
              articleIdNum,
              lastArticleIdNum,
              title: postInfo.title?.substring(0, 50),
              dateText: postInfo.dateText
            });
          }
        }
        
        // lastScanAt과 비교 (UTC 기준) - 날짜 파싱 성공 시에만 적용
        // 날짜 필터링 완화: articleId가 더 크면 날짜와 관계없이 처리
        // 같은 시:분에 올라온 게시글도 처리하기 위해 >= 비교 사용
        if (lastScanAtUTC && postDateUTC) {
          // 같은 시:분 게시글도 처리하기 위해 >= 사용
          // 단, 같은 시간이면서 articleId가 더 작거나 같으면 스킵 (이미 처리된 게시글)
          const isNewPost = postDateUTC >= lastScanAtUTC;
          const isSameTime = postDateUTC.getTime() === lastScanAtUTC.getTime();
          
          logger.debug('[NaverCafeWorker] Date comparison for post', {
            boardId: board.id,
            articleId,
            articleIdNum,
            postDateText: postInfo.dateText,
            postDateKST: postDateKST ? postDateKST.toISOString() : null,
            postDateKSTLocal: postDateKST ? postDateKST.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : null,
            postDateUTC: postDateUTC ? postDateUTC.toISOString() : null,
            lastScanAtUTC: lastScanAtUTC.toISOString(),
            lastScanAtKST: lastScanAtKST ? lastScanAtKST.toISOString() : null,
            lastScanAtKSTLocal: lastScanAtKST ? lastScanAtKST.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : null,
            timeDiffMs: postDateUTC ? postDateUTC.getTime() - lastScanAtUTC.getTime() : null,
            timeDiffHours: postDateUTC ? (postDateUTC.getTime() - lastScanAtUTC.getTime()) / (1000 * 60 * 60) : null,
            isNewPost,
            isSameTime,
            articleIdNum,
            lastArticleIdNum,
            willProcess: isNewPost || articleIdNum > lastArticleIdNum || !lastScanAtUTC
          });
          
          // 날짜 필터링 완화: articleId가 더 크면 날짜와 관계없이 처리
          // 같은 시:분 게시글도 처리하되, 같은 시간이면서 articleId가 더 작거나 같으면 스킵 (이미 처리된 게시글)
          // 단, articleId가 더 크면 날짜와 관계없이 처리
          // 또한, 날짜가 lastScanAt 이후면 articleId와 관계없이 처리 (날짜가 더 정확한 기준)
          // 백필 모드에서는 날짜가 백필 기간 내에 있으면 articleId와 관계없이 처리
          if (postDateUTC < lastScanAtUTC && articleIdNum <= lastArticleIdNum && !backfillMode) {
            // 날짜가 오래되었고 articleId도 더 작거나 같으면 스킵 (백필 모드가 아닐 때만)
            skippedByDate++;
            logger.debug('[NaverCafeWorker] Skipped post (older than lastScanAt and articleId not newer)', {
              boardId: board.id,
              articleId,
              articleIdNum,
              lastArticleIdNum,
              postDateUTC: postDateUTC.toISOString(),
              lastScanAtUTC: lastScanAtUTC.toISOString(),
              timeDiffMs: postDateUTC.getTime() - lastScanAtUTC.getTime(),
              timeDiffHours: (postDateUTC.getTime() - lastScanAtUTC.getTime()) / (1000 * 60 * 60),
              title: postInfo.title?.substring(0, 50)
            });
            continue;
          } else if (isSameTime && articleIdNum <= lastArticleIdNum && !backfillMode) {
            // 같은 시:분이지만 articleId가 더 작거나 같으면 스킵 (이미 처리된 게시글, 백필 모드가 아닐 때만)
            skippedByDate++;
            logger.debug('[NaverCafeWorker] Skipped post (same time but articleId not newer)', {
              boardId: board.id,
              articleId,
              articleIdNum,
              lastArticleIdNum,
              postDateUTC: postDateUTC.toISOString(),
              lastScanAtUTC: lastScanAtUTC.toISOString(),
              isSameTime,
              title: postInfo.title?.substring(0, 50)
            });
            continue;
          } else if (postDateUTC >= lastScanAtUTC && articleIdNum <= lastArticleIdNum) {
            // 날짜가 lastScanAt 이후인데 articleId가 더 작거나 같으면 처리 (날짜가 더 정확한 기준, articleId 역순 가능성)
            logger.info('[NaverCafeWorker] Processing post despite smaller articleId (date is newer than lastScanAt)', {
              boardId: board.id,
              articleId,
              articleIdNum,
              lastArticleIdNum,
              postDateUTC: postDateUTC.toISOString(),
              lastScanAtUTC: lastScanAtUTC.toISOString(),
              timeDiffHours: (postDateUTC.getTime() - lastScanAtUTC.getTime()) / (1000 * 60 * 60),
              title: postInfo.title?.substring(0, 50)
            });
          } else if (postDateUTC < lastScanAtUTC && articleIdNum > lastArticleIdNum) {
            // 날짜는 오래되었지만 articleId가 더 크면 처리 (날짜 파싱 오류 가능성)
            logger.info('[NaverCafeWorker] Processing post despite old date (articleId is newer)', {
              boardId: board.id,
              articleId,
              articleIdNum,
              lastArticleIdNum,
              postDateUTC: postDateUTC.toISOString(),
              lastScanAtUTC: lastScanAtUTC.toISOString(),
              timeDiffHours: (postDateUTC.getTime() - lastScanAtUTC.getTime()) / (1000 * 60 * 60),
              title: postInfo.title?.substring(0, 50)
            });
          }
          // 날짜가 더 최신이면 무조건 처리 (이미 isNewPost가 true)
        } else if (postDateUTC && !lastScanAtUTC) {
          // lastScanAt이 없으면 날짜 정보만 로그
          logger.debug('[NaverCafeWorker] Post date parsed (no lastScanAt to compare)', {
            boardId: board.id,
            articleId,
            articleIdNum,
            postDateText: postInfo.dateText,
            postDateKST: postDateKST ? postDateKST.toISOString() : null,
            postDateUTC: postDateUTC ? postDateUTC.toISOString() : null
          });
        } else if (!postDateUTC && lastScanAtUTC) {
          // 날짜 파싱 실패 시 articleId로 필터링
          // articleId가 더 크면 무조건 처리
          // articleId가 더 작지만 차이가 작은 경우(100 이내)도 처리 (articleId 역순 가능성)
          // 백필 모드에서는 articleId와 관계없이 처리 (놓친 게시글 찾기)
          const articleIdDiff = lastArticleIdNum - articleIdNum;
          if (shouldSkipByArticleId && articleIdDiff > 100 && !backfillMode) {
            // articleId가 더 작고 차이가 100보다 크면 스킵 (오래된 게시글일 가능성, 백필 모드가 아닐 때만)
            logger.debug('[NaverCafeWorker] Skipped post (date parsing failed, articleId too old)', {
              boardId: board.id,
              articleId,
              articleIdNum,
              lastArticleIdNum,
              articleIdDiff,
              postDateText: postInfo.dateText,
              title: postInfo.title?.substring(0, 50)
            });
            continue;
          }
          // articleId가 더 크거나, 차이가 100 이내면 처리 (날짜 파싱 실패해도 새 게시글일 가능성)
          // 백필 모드에서는 articleId와 관계없이 처리 (차이가 100보다 커도 처리)
          if (backfillMode && articleIdDiff > 100) {
            logger.info('[NaverCafeWorker] Backfill mode: processing post despite large articleId difference', {
              boardId: board.id,
              articleId,
              articleIdNum,
              lastArticleIdNum,
              articleIdDiff,
              postDateText: postInfo.dateText,
              lastScanAtUTC: lastScanAtUTC.toISOString(),
              title: postInfo.title?.substring(0, 50)
            });
          } else {
            logger.info('[NaverCafeWorker] Date parsing failed, processing based on articleId', {
              boardId: board.id,
              articleId,
              articleIdNum,
              lastArticleIdNum,
              articleIdDiff,
              postDateText: postInfo.dateText,
              lastScanAtUTC: lastScanAtUTC.toISOString(),
              backfillMode,
              willProcess: true,
              reason: articleIdNum > lastArticleIdNum ? 'articleId is newer' : 'articleId difference is small (possible reverse order)',
              title: postInfo.title?.substring(0, 50)
            });
          }
        }
        
        // articleId 필터링 체크 (날짜 파싱 실패했거나 날짜 필터를 통과한 경우)
        // 백필 모드에서는 articleId 필터링 무시
        if (shouldSkipByArticleId && !backfillMode) {
          continue;
        }

        // 로그인 팝업/다이얼로그 감지를 위한 플래그
        let detectedLoginDialog = false;
        let detectedLoginModal = false;
        
        // JavaScript 다이얼로그 감지 (alert, confirm, prompt)
        const dialogHandler = (dialog) => {
          const dialogMessage = dialog.message().toLowerCase();
          if (dialogMessage.includes('로그인') || dialogMessage.includes('login') || 
              dialogMessage.includes('회원') || dialogMessage.includes('member')) {
            detectedLoginDialog = true;
            logger.info('[NaverCafeWorker] Login dialog detected', {
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
        
        // 게시글 상세 페이지 로드 (재시도 로직 적용)
        // networkidle 대신 domcontentloaded 사용 (네이버 카페는 동적 로딩이 많아 networkidle이 도달하지 않을 수 있음)
        await retryBrowserOperation(
          () => page.goto(articleUrl, { 
            waitUntil: 'domcontentloaded', // networkidle -> domcontentloaded로 변경 (더 빠름)
            timeout: 30000 // 45초 -> 30초로 단축
          }),
          {
            maxRetries: 3,
            initialDelay: 2000,
            maxDelay: 10000,
            onRetry: (attempt, error, delay) => {
              logger.warn(`[NaverCafeWorker] Retry ${attempt}/3 loading article after ${delay}ms`, {
                url: articleUrl,
                error: error.message
              });
              return delay;
            }
          }
        );
        
        // 페이지 로드 후 팝업/모달 감지를 위한 대기 시간
        await page.waitForTimeout(2000); // 5초 -> 2초로 단축
        
        // 상세 페이지도 iframe이 있을 수 있으므로 확인
        let detailFrame = null;
        try {
          const iframeExists = await page.evaluate(() => {
            const iframe = document.querySelector('iframe#cafe_main, iframe#cafe_main_original, iframe[name="cafe_main"]');
            return !!iframe;
          });
          
          if (iframeExists) {
            detailFrame = await page.frame({ name: 'cafe_main' });
            if (!detailFrame) {
              detailFrame = await page.frame({ url: /cafe_main/ });
            }
            if (detailFrame) {
              logger.debug('[NaverCafeWorker] Switched to iframe context for detail page', { articleId });
              await detailFrame.waitForTimeout(1000); // 2초 -> 1초로 단축
            }
          }
        } catch (e) {
          // iframe 처리 실패 시 무시
        }
        
        const detailContext = detailFrame || page;
        
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
            logger.info('[NaverCafeWorker] Login modal/popup detected', { articleId });
          }
        } catch (modalCheckError) {
          logger.debug('[NaverCafeWorker] Failed to check login modal', {
            articleId,
            error: modalCheckError.message
          });
        }
        
        // 다이얼로그 리스너 제거
        page.off('dialog', dialogHandler);

        // iframe 컨텍스트 확인 및 se-main-container 찾기 (개선된 로직)
        let seMainContainer = null;
        let isInIframe = false;
        let frame = null;
        
        // 1. 먼저 iframe 컨텍스트 확인
        try {
          // iframe이 로드될 때까지 대기
          await page.waitForTimeout(500); // 1초 -> 0.5초로 단축 // 2초 -> 1초로 단축
          
          // cafe_main iframe 찾기
          frame = await page.frame({ name: 'cafe_main' });
          if (!frame) {
            // URL 패턴으로 iframe 찾기
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
            logger.debug('[NaverCafeWorker] Found iframe context', { 
              articleId,
              frameUrl: frame.url() 
            });
            
            // iframe 내부 컨텐츠가 로드될 때까지 대기
            try {
              await frame.waitForSelector('.se-main-container, .article_view', { timeout: 5000 }); // 10초 -> 5초로 단축
              logger.debug('[NaverCafeWorker] Iframe content loaded', { articleId });
            } catch (e) {
              logger.debug('[NaverCafeWorker] Timeout waiting for iframe content, proceeding anyway', {
                articleId,
                error: e.message
              });
            }
          }
        } catch (frameError) {
          logger.debug('[NaverCafeWorker] No iframe context found, using main page', { 
            articleId,
            error: frameError.message 
          });
        }
        
        // 2. se-main-container 찾기 (iframe 우선, 없으면 메인 페이지)
        const contextToSearch = isInIframe && frame ? frame : page;
        const containerSelectors = [
          '.se-main-container',
          '.ContentRenderer',
          '.article_view',
          '#tbody',
          '.content_text',
          'div[class*="se-main"]',
          '.ArticleContent',
          '#articleBodyContents',
          '.se-viewer',
          '.article-body'
        ];
        
        let containerFound = false;
        
        try {
          await retryBrowserOperation(
            async () => {
              let foundContainer = null;
              let usedSelector = null;
              
              for (const selector of containerSelectors) {
                try {
                  await contextToSearch.waitForSelector(selector, { timeout: 10000 }); // 30초 -> 10초로 단축
                  foundContainer = await contextToSearch.$(selector);
                  if (foundContainer) {
                    usedSelector = selector;
                    logger.debug('[NaverCafeWorker] Found container', {
                      articleId,
                      selector,
                      isInIframe
                    });
                    break;
                  }
                } catch (e) {
                  // 다음 선택자 시도
                  continue;
                }
              }
              
              if (!foundContainer) {
                throw new Error(`Container not found with selectors: ${containerSelectors.join(', ')}`);
              }
              
              seMainContainer = foundContainer;
              containerFound = true;
              return foundContainer;
            },
          {
            maxRetries: 3,
            initialDelay: 3000,
            maxDelay: 10000,
            onRetry: (attempt, error, delay) => {
              logger.debug(`[NaverCafeWorker] Retry ${attempt}/3 waiting for content after ${delay}ms`, {
                url: articleUrl,
                articleId,
                isInIframe,
                error: error.message
              });
              return delay;
            }
          }
        ).then(container => {
          seMainContainer = container;
          containerFound = true;
          logger.debug('[NaverCafeWorker] Container found successfully', {
            articleId,
            isInIframe
          });
        }).catch(error => {
          logger.warn('[NaverCafeWorker] Failed to find container after retries', {
            url: articleUrl,
            articleId,
            isInIframe,
            error: error.message,
            selectors: containerSelectors
          });
          // 컨테이너를 찾지 못해도 크롤러가 죽지 않도록 처리
          containerFound = false;
          seMainContainer = null;
        });
        } catch (containerError) {
          logger.warn('[NaverCafeWorker] Error in container search', {
            articleId,
            error: containerError.message
          });
          containerFound = false;
          seMainContainer = null;
        }

        // 렌더링 완료 후 안정화 대기 시간 증가 (4초)
        await page.waitForTimeout(2000); // 4초 -> 2초로 단축

        // 로그인 필요 여부 감지: 팝업/다이얼로그 감지에만 의존
        // 상세 페이지 진입 시 팝업창이 뜨는 경우만 로그인 필요로 판단
        let requiresLogin = detectedLoginDialog || detectedLoginModal;
        
        if (requiresLogin) {
          logger.info('[NaverCafeWorker] Login required post detected (popup/dialog detected)', {
            articleId,
            detectedByDialog: detectedLoginDialog,
            detectedByModal: detectedLoginModal,
            hasCookie: !!NAVER_CAFE_COOKIE
          });
        }

        // 로그인이 필요한 게시글 처리
        // 팝업이 감지되었어도 본문 추출을 시도 (팝업 감지가 잘못되었을 수 있음)
        // 본문이 성공적으로 추출되면 requiresLogin을 false로 수정
        if (requiresLogin && !cookie) {
          logger.info('[NaverCafeWorker] Login popup detected but no cookie - attempting content extraction anyway (may be false positive)', {
            articleId,
            title: postInfo.title?.substring(0, 50)
          });
          // 본문 추출을 시도하되, 실패하면 requiresLogin=true로 유지
          // 아래 로직 계속 진행
        } else if (requiresLogin && cookie) {
          logger.info('[NaverCafeWorker] Login-required post detected but cookie available, attempting to crawl', {
            articleId,
            title: postInfo.title?.substring(0, 50)
          });
          // 쿠키가 있으면 본문 추출 시도 (아래 로직 계속 진행)
        }

        // 댓글 수집 여부 결정 (리스트 페이지에서 이미 추출한 commentCount 사용)
        let scrapedComments = null;
        let commentCount = postInfo.commentCount || 0;
        let isHotTopic = false;
        
        // 핫토픽 여부 판단: 작성자가 WATCH_AUTHORS에 포함되거나 댓글 수가 임계값 이상인 경우
        const isWatchedAuthor = postInfo.author && WATCH_AUTHORS.includes(postInfo.author);
        const isHighCommentCount = commentCount >= HOT_TOPIC_THRESHOLD;
        isHotTopic = isWatchedAuthor || isHighCommentCount;
        
        // 댓글 수집 여부 결정: 핫토픽인 경우에만 상세 댓글 내용 수집
        const shouldScrapeComments = isHotTopic;

        logger.debug('[NaverCafeWorker] Comment collection decision', {
          articleId,
          author: postInfo.author,
          commentCount,
          isWatchedAuthor,
          isHighCommentCount,
          isHotTopic,
          shouldScrapeComments
        });

        if (shouldScrapeComments) {
          try {
            logger.info('[NaverCafeWorker] Scraping comments', { articleId, commentCount });
            
            // 댓글 영역이 로드될 때까지 대기
            await retryBrowserOperation(
              async () => {
                // 다양한 댓글 영역 셀렉터 시도
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
                
                let commentElement = null;
                for (const selector of commentSelectors) {
                  try {
                    await page.waitForSelector(selector, { timeout: 5000 });
                    commentElement = await page.$(selector);
                    if (commentElement) break;
                  } catch (e) {
                    // 다음 셀렉터 시도
                    continue;
                  }
                }
                
                if (!commentElement) {
                  throw new Error('Comment area not found');
                }
                
                return commentElement;
              },
              {
                maxRetries: 2,
                initialDelay: 2000,
                maxDelay: 5000,
                onRetry: (attempt, error, delay) => {
                  logger.debug(`[NaverCafeWorker] Retry ${attempt}/2 waiting for comment area after ${delay}ms`, {
                    url: articleUrl,
                    error: error.message
                  });
                  return delay;
                }
              }
            ).catch(error => {
              logger.warn('[NaverCafeWorker] Failed to find comment area', {
                articleId,
                error: error.message
              });
            });

            // 댓글 추출
            const comments = await page.evaluate(() => {
              // eslint-disable-next-line no-undef
              const comments = [];
              
              // 다양한 댓글 셀렉터 시도
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
                // eslint-disable-next-line no-undef
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                  elements.forEach((el, index) => {
                    const text = el.textContent?.trim() || '';
                    const author = el.querySelector('.nickname, .nick, .author, [class*="nick"]')?.textContent?.trim() || '';
                    const date = el.querySelector('.date, .time, [class*="date"]')?.textContent?.trim() || '';
                    
                    if (text && text.length > 0) {
                      comments.push({
                        index: index + 1,
                        author: author || '익명',
                        text: text,
                        date: date || ''
                      });
                    }
                  });
                  
                  if (comments.length > 0) break; // 첫 번째 성공한 셀렉터 사용
                }
              }
              
              // 댓글 수가 0이면 전체 댓글 영역에서 텍스트 추출 시도
              if (comments.length === 0) {
                const commentArea = document.querySelector('.CommentBox, .comment_area, [class*="comment"]');
                if (commentArea) {
                  const allText = commentArea.textContent?.trim() || '';
                  if (allText.length > 0) {
                    comments.push({
                      index: 1,
                      author: '전체',
                      text: allText,
                      date: ''
                    });
                  }
                }
              }
              
              return comments;
            });

            if (comments && comments.length > 0) {
              scrapedComments = JSON.stringify(comments);
              // 리스트 페이지의 제목 옆 [숫자]가 가장 정확하므로, 수집한 댓글 개수로 덮어쓰지 않음
              // commentCount는 리스트 페이지 값(postInfo.commentCount)을 유지
              // isHotTopic은 이미 위에서 설정됨
              
              logger.info('[NaverCafeWorker] Comments scraped successfully', {
                articleId,
                listPageCommentCount: postInfo.commentCount || 0,
                scrapedCommentsCount: comments.length,
                isHotTopic,
                preview: comments.slice(0, 3).map(c => `${c.author || '익명'}: ${c.text.substring(0, 50)}`)
              });
            } else {
              logger.debug('[NaverCafeWorker] No comments found after scraping', { 
                articleId,
                commentCount: postInfo.commentCount || 0,
                isHotTopic
              });
            }
          } catch (commentError) {
            logger.warn('[NaverCafeWorker] Failed to scrape comments', {
              articleId,
              error: commentError.message
            });
            // 댓글 수집 실패해도 계속 진행
          }
        }

        // 상세 페이지에서 실제 댓글 수 확인 (리스트 페이지 값 검증)
        // 리스트 페이지에서 추출한 값이 잘못되었을 수 있으므로 항상 상세 페이지에서 확인
        try {
          const actualCommentCount = await detailContext.evaluate(() => {
            // 페이지 전체에서 "댓글 숫자" 패턴 찾기 (우선 시도)
            const allText = document.body.textContent || '';
            const commentMatches = allText.match(/댓글\s*(\d+)/g);
            if (commentMatches && commentMatches.length > 0) {
              // 가장 많이 나타나는 숫자 사용 (댓글 수는 보통 여러 곳에 표시됨)
              const numbers = commentMatches.map(m => {
                const numMatch = m.match(/(\d+)/);
                return numMatch ? parseInt(numMatch[1], 10) : 0;
              }).filter(n => n > 0 && n < 10000);
              
              if (numbers.length > 0) {
                // 가장 작은 숫자 사용 (댓글 수는 보통 작은 숫자)
                return Math.min(...numbers);
              }
            }
            
            // ReplyBox 찾기
            const replyBoxSelectors = [
              'div.ReplyBox',
              'div.replyBox',
              '.ReplyBox',
              '.replyBox',
              '[class*="ReplyBox"]',
              '[class*="replyBox"]'
            ];
            
            let replyBox = null;
            for (const selector of replyBoxSelectors) {
              replyBox = document.querySelector(selector);
              if (replyBox) break;
            }
            
            if (!replyBox) {
              return null;
            }
            
            // 기준: <div class="ReplyBox"> 댓글 옆 <strong class="num">숫자</strong>
            // "댓글" 텍스트를 찾고 그 옆의 <strong class="num">숫자</strong> 찾기
            const replyText = replyBox.textContent || '';
            const replyIndex = replyText.indexOf('댓글');
            
            if (replyIndex >= 0) {
              // "댓글" 텍스트 이후의 요소에서 <strong class="num"> 찾기
              const allElements = replyBox.querySelectorAll('*');
              for (const el of allElements) {
                // <strong class="num"> 요소인지 확인
                if (el.tagName === 'STRONG' && el.classList.contains('num')) {
                  const text = el.textContent?.trim() || '';
                  const numMatch = text.match(/^(\d+)$/);
                  if (numMatch) {
                    return parseInt(numMatch[1], 10) || 0;
                  }
                }
              }
              
              // "댓글" 텍스트 옆의 숫자 찾기 (텍스트 기반)
              const replyMatch = replyText.substring(replyIndex).match(/댓글\s*(\d+)/);
              if (replyMatch) {
                return parseInt(replyMatch[1], 10) || 0;
              }
            }
            
            // "댓글" 텍스트를 찾지 못한 경우, ReplyBox 내의 <strong class="num"> 찾기
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
          
          // 실제 수집한 댓글 개수와 비교 (더 정확함)
          const scrapedCommentsCount = scrapedComments ? JSON.parse(scrapedComments).length : 0;
          
          // 실제 댓글 요소 개수 확인 (ReplyBox 값 검증용)
          const actualCommentElementsCount = await detailContext.evaluate(() => {
            const commentSelectors = [
              // 네이버 카페 특정 구조
              'ul.comment_list > li',
              '.comment_list > li',
              '.comment_box > ul > li',
              '.reply_area > ul > li',
              '.CommentBox > ul > li',
              // 일반적인 선택자
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
          
          // 우선순위: 수집한 댓글 개수 > 실제 댓글 요소 개수 > 상세 페이지 ReplyBox > 리스트 페이지 값
          if (scrapedCommentsCount > 0) {
            // 실제 수집한 댓글 개수가 가장 정확함
            if (commentCount !== scrapedCommentsCount) {
              logger.info('[NaverCafeWorker] Comment count corrected from scraped comments', {
                articleId,
                listPageCount: commentCount,
                scrapedCount: scrapedCommentsCount,
                actualCount: actualCommentCount,
                actualElementsCount: actualCommentElementsCount
              });
              commentCount = scrapedCommentsCount;
            }
          } else if (actualCommentElementsCount > 0) {
            // 실제 댓글 요소가 있으면 그 개수를 사용 (가장 정확)
            if (commentCount !== actualCommentElementsCount) {
              logger.info('[NaverCafeWorker] Comment count corrected from actual comment elements', {
                articleId,
                listPageCount: commentCount,
                replyBoxCount: actualCommentCount,
                actualElementsCount: actualCommentElementsCount
              });
              commentCount = actualCommentElementsCount;
            }
          } else if (actualCommentCount !== null && actualCommentCount === 0) {
            // ReplyBox에서 0을 확인했으면 0으로 수정
            if (commentCount !== 0) {
              logger.info('[NaverCafeWorker] Comment count corrected: ReplyBox shows 0', {
                articleId,
                listPageCount: commentCount,
                actualCount: 0
              });
              commentCount = 0;
            }
          } else if (actualCommentCount !== null && actualCommentCount > 0) {
            // ReplyBox 값이 있지만 실제 댓글 요소가 없으면 0으로 수정 (ReplyBox 값이 잘못된 경우)
            if (actualCommentElementsCount === 0) {
              logger.warn('[NaverCafeWorker] Comment count corrected: ReplyBox had value but no actual comments', {
                articleId,
                listPageCount: commentCount,
                replyBoxCount: actualCommentCount,
                actualElementsCount: 0
              });
              commentCount = 0;
            } else if (commentCount !== actualCommentCount) {
              // ReplyBox 값과 실제 댓글 요소 개수가 다르면 실제 댓글 요소 개수 우선
              logger.info('[NaverCafeWorker] Comment count updated from detail page ReplyBox', {
                articleId,
                listPageCount: commentCount,
                actualCount: actualCommentCount,
                actualElementsCount: actualCommentElementsCount
              });
              commentCount = actualCommentCount;
            }
          } else if (commentCount > 0 && actualCommentElementsCount === 0) {
            // ReplyBox를 찾지 못했지만 리스트 페이지에 값이 있고, 실제 댓글도 없는 경우 → 0으로 수정
            logger.warn('[NaverCafeWorker] Comment count corrected: list page had value but no actual comments', {
              articleId,
              listPageCount: commentCount,
              actualCount: 0
            });
            commentCount = 0;
          }
        } catch (commentCountCheckError) {
          logger.debug('[NaverCafeWorker] Failed to verify comment count from detail page', {
            articleId,
            error: commentCountCheckError.message
          });
          // 실패해도 리스트 페이지 값 유지
        }

        // 이미지 감지 및 스크린샷 캡처 (개선된 로직)
        let screenshotPath = null;
        let postImagePaths = [];
        let hasImages = false;
        try {
          // 1. iframe 컨텍스트 확인
          let screenshotContext = page;
          let screenshotFrame = null;
          
          try {
            screenshotFrame = await page.frame({ name: 'cafe_main' });
            if (!screenshotFrame) {
              screenshotFrame = await page.frame({ url: /cafe_main/ });
            }
            if (screenshotFrame) {
              screenshotContext = screenshotFrame;
              logger.debug('[NaverCafeWorker] Using iframe context for screenshot', { articleId });
            }
          } catch (frameError) {
            logger.debug('[NaverCafeWorker] No iframe context for screenshot, using main page', { articleId });
          }

          // 2. 본문 컨테이너 찾기 (다중 선택자 지원)
          const containerSelectors = ['.se-main-container', '.ContentRenderer', '.article_view', '#tbody'];
          let foundContainer = null;
          let usedSelector = null;

          for (const selector of containerSelectors) {
            try {
              await screenshotContext.waitForSelector(selector, { timeout: 5000 });
              foundContainer = await screenshotContext.$(selector);
              if (foundContainer) {
                usedSelector = selector;
                logger.debug('[NaverCafeWorker] Found container for screenshot', { articleId, selector });
                break;
              }
            } catch (e) {
              // 다음 선택자 시도
              continue;
            }
          }

          // 컨테이너를 찾지 못했어도 이미지 감지는 계속 진행
          if (!foundContainer) {
            logger.warn('[NaverCafeWorker] Container not found, checking entire page for images', {
              articleId,
              selectors: containerSelectors
            });
            usedSelector = 'body'; // 전체 페이지에서 확인
          }

          // 3. 이미지 감지 및 스마트 대기 (강화된 감지 로직)
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
                imageSrcs: allImageArray.map(img => img.src).slice(0, 5),
                containerFound: false,
                hasBackgroundImage: hasBodyBackground,
                debugInfo: 'Container not found, checking entire page'
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
              imageSrcs: imageArray.map(img => ({
                src: img.src,
                complete: img.complete,
                naturalWidth: img.naturalWidth
              })).slice(0, 5),
              containerFound: true,
              hasBackgroundImage: hasAnyBackgroundImage,
              hasSvg: hasSvg,
              debugInfo: {
                directImages: imageArray.length,
                backgroundImages: hasAnyBackgroundImage,
                svgCount: svgImages.length
              }
            };
          }, usedSelector);

          hasImages = imageInfo.hasImages;
          
          logger.info('[NaverCafeWorker] Image detection result', {
            articleId,
            hasImages: imageInfo.hasImages,
            imageCount: imageInfo.imageCount || 0,
            containerFound: imageInfo.containerFound !== false,
            hasBackgroundImage: imageInfo.hasBackgroundImage || false,
            hasSvg: imageInfo.hasSvg || false,
            debugInfo: imageInfo.debugInfo
          });
          
          if (!imageInfo.hasImages) {
            logger.debug('[NaverCafeWorker] No images found, skipping screenshot', { 
              articleId,
              debugInfo: imageInfo.debugInfo
            });
            screenshotPath = null;
          } else {
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
              logger.warn('[NaverCafeWorker] Inline image download failed', {
                articleId,
                error: dlErr.message
              });
            }

            if (downloadedPaths.length > 0) {
              postImagePaths = downloadedPaths;
              screenshotPath = downloadedPaths[0];
              logger.info('[NaverCafeWorker] Saved inline post images', {
                articleId,
                count: downloadedPaths.length,
                screenshotPath
              });
            } else {
            logger.info('[NaverCafeWorker] Images detected, waiting for load', { 
              articleId, 
              imageCount: imageInfo.imageCount 
            });

            // 이미지 로드 완료 대기 (최대 10초)
            const maxWaitTime = 5000; // 10초 -> 5초로 단축 (이미지 로딩 대기)
            const startTime = Date.now();
            let allImagesLoaded = false;

            try {
              await screenshotContext.evaluate(async (selector, maxWait) => {
                const container = document.querySelector(selector);
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

              allImagesLoaded = true;
              const waitTime = Date.now() - startTime;
              logger.debug('[NaverCafeWorker] Images loaded', { articleId, waitTime });
            } catch (loadError) {
              logger.warn('[NaverCafeWorker] Image load check failed, proceeding anyway', {
                articleId,
                error: loadError.message
              });
            }

            // 안정화 대기 (0.5초)
            await screenshotContext.waitForTimeout(300); // 0.5초 -> 0.3초로 단축

            // 4. 경로 생성 및 디렉토리 생성
            const pathInfo = generateScreenshotPath(articleId);
            await ensureScreenshotDirectory(pathInfo.uploadsDir);

            // 5. 폰트 로딩 대기 (한글 폰트가 완전히 로드될 때까지)
            await screenshotContext.waitForTimeout(500); // 1초 -> 0.5초로 단축
            
            // 폰트가 로드되었는지 확인
            const fontLoaded = await screenshotContext.evaluate(() => {
              return document.fonts.check('12px "Noto Sans KR"') || 
                     document.fonts.check('12px "Nanum Gothic"') ||
                     document.fonts.check('12px "Noto Sans CJK KR"');
            });
            
            if (!fontLoaded) {
              logger.warn('[NaverCafeWorker] Korean fonts may not be loaded, waiting additional time', { articleId });
              await screenshotContext.waitForTimeout(1000); // 2초 -> 1초로 단축
            }
            
            // 6. 스크린샷 캡처
            const containerLocator = screenshotContext.locator(usedSelector);
            await containerLocator.screenshot({ 
              path: pathInfo.fullPath,
              fullPage: false
            });

            screenshotPath = pathInfo.relativePath;
            postImagePaths = screenshotPath ? [screenshotPath] : [];
            
            logger.info('[NaverCafeWorker] Screenshot captured successfully', { 
              articleId, 
              screenshotPath,
              usedSelector,
              imageCount: imageInfo.imageCount,
              allImagesLoaded
            });
            }
          }
        } catch (screenshotError) {
          // 상세한 에러 정보 로깅
          let errorReason = 'Unknown error';
          if (screenshotError.message.includes('Container not found')) {
            errorReason = 'Container not found';
          } else if (screenshotError.message.includes('timeout')) {
            errorReason = 'Image load timeout';
          } else if (screenshotError.message.includes('ENOENT') || screenshotError.message.includes('permission')) {
            errorReason = 'File permission or directory creation failed';
          } else if (screenshotError.message.includes('screenshot')) {
            errorReason = 'Screenshot capture failed';
          }

          logger.warn('[NaverCafeWorker] Failed to capture screenshot', {
            articleId,
            error: screenshotError.message,
            errorReason,
            stack: screenshotError.stack
          });
          // 스크린샷 실패해도 계속 진행 (null로 저장)
          screenshotPath = null;
          postImagePaths = [];
        }

        // 게시글 내용 추출
        // se-main-container 내부의 실제 텍스트 노드만 수집 (Playwright API 사용)
        // iframe 컨텍스트를 사용하여 텍스트 요소 수집
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
                    seenTexts.delete(seenText);
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
          logger.debug('[NaverCafeWorker] Failed to extract text elements', { error: e.message });
        }

        // iframe 컨텍스트를 사용하여 본문 추출
        const contextToUse = isInIframe && frame ? frame : page;
        
        let postData = await contextToUse.evaluate((elementTextsArray) => {
          // 제목 추출
          const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                       document.querySelector('.title_text, .article_title, .ArticleTitle')?.textContent?.trim() ||
                       document.title;
          
          // 제목에서 ": 네이버 카페" 제거
          const cleanTitle = title ? title.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim() : '';
          
          // 본문 추출: se-main-container를 우선적으로 시도
          let content = '';
          let usedSelector = '';
          
          // 방법 1: se-main-container 내부의 텍스트 요소들을 직접 수집
          const seMainContainer = document.querySelector('.se-main-container');
          if (seMainContainer) {
            let collectedText = '';
            
            // Playwright에서 수집한 텍스트 요소 배열이 있으면 사용
            if (elementTextsArray && elementTextsArray.length > 0) {
              collectedText = elementTextsArray.join('\n');
            } else {
              // 대체 방법: DOM에서 직접 수집 (중복 제거 포함)
              const textElements = seMainContainer.querySelectorAll('.se-text, .se-component-text, .se-section-text, p, div[class*="se-"]');
              const textArray = [];
              const seenTexts = new Set(); // 중복 제거를 위한 Set
              
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
              
              if (textArray.length > 0) {
                collectedText = textArray.join('\n');
              } else {
                // 최후의 수단: 전체 텍스트 사용
                collectedText = seMainContainer.textContent?.trim() || '';
              }
            }
            
            // elementTextsArray가 비어있고 collectedText도 비어있으면 textContent 직접 사용
            if (!collectedText || collectedText.length === 0) {
              collectedText = seMainContainer.textContent?.trim() || '';
            }
            
            // collectedText가 여전히 비어있지 않으면 처리
            if (collectedText && collectedText.length > 0) {
              // 제목 제거 (보수적인 로직 - startsWith만 사용)
              // 단, 제거 후 남은 본문이 충분히 길 때만 제거 (본문이 제목만 있는 경우가 아님을 확인)
              if (cleanTitle && cleanTitle.length > 0) {
                // 1. 본문이 제목으로 '시작'하는 경우만 제거 (가장 안전)
                if (collectedText.startsWith(cleanTitle)) {
                  let trimmed = collectedText.substring(cleanTitle.length).trim();
                  trimmed = trimmed.replace(/^[\s\n\r:]+/, '').trim();
                  // 제거 후 남은 본문이 3자 이상일 때만 제거
                  // 원본 본문이 제목보다 충분히 길어도, 제거 후 남은 본문이 3자 미만이면 제거하지 않음
                  if (trimmed.length >= 3) {
                    collectedText = trimmed;
                  }
                  // 제거 후 남은 본문이 3자 미만이면 제거하지 않음 (제목만 있는 것으로 간주하거나, 본문 추출이 제대로 안 된 경우)
                }
                
                // *주의* includes 검사는 제거 - 본문에 제목이 포함되어 있어도 제거하지 않음
              }
              
              // ": 네이버 카페" 제거
              collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
              collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*\n/g, '\n').trim();
              collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*/g, '').trim();
              
              // 최소 길이 체크 (3자 이상)
              // 제목과 동일한 경우는 나중에 제목 제거 로직에서 처리하므로 여기서는 길이만 확인
              if (collectedText.length >= 3) {
                content = collectedText;
                usedSelector = '.se-main-container (internal)';
              }
            }
          }
          
          // 방법 2: se-main-container가 실패하면 다른 셀렉터 시도
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
                
                // 제목 제거 (보수적인 로직 - startsWith만 사용)
                // 단, 제거 후 남은 본문이 충분히 길 때만 제거
                if (cleanTitle && cleanTitle.length > 0) {
                  // 1. 본문이 제목으로 '시작'하는 경우만 제거
                  if (text.startsWith(cleanTitle)) {
                    let trimmed = text.substring(cleanTitle.length).trim();
                    trimmed = trimmed.replace(/^[\s\n\r:]+/, '').trim();
                    // 제거 후 남은 본문이 3자 이상일 때만 제거
                    if (trimmed.length >= 3) {
                      text = trimmed;
                    }
                    // 제거 후 남은 본문이 3자 미만이면 제거하지 않음
                  }
                  
                  // *주의* includes 검사는 제거 - 본문에 제목이 포함되어 있어도 제거하지 않음
                }
                
                // ": 네이버 카페" 제거
                text = text.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
                text = text.replace(/\s*:\s*네이버\s*카페\s*\n/g, '\n').trim();
                text = text.replace(/\s*:\s*네이버\s*카페\s*/g, '').trim();
                
                // 최소 길이 체크 (3자 이상)
                // 제목과 동일한 경우는 나중에 제목 제거 로직에서 처리하므로 여기서는 길이만 확인
                if (text.length >= 3) {
                  content = text;
                  usedSelector = selector;
                  break;
                }
              }
            }
          }
          
          // 본문이 없으면 빈 문자열
          if (content.length === 0) {
            content = '';
          }
          
          // 불필요한 텍스트 제거 (에러 메시지, UI 텍스트 등)
          // 주의: cleanContent 함수는 브라우저 컨텍스트 밖에서 실행되므로 여기서는 기본 정리만 수행
          // 실제 cleanContent는 저장 전에 적용됨

          // 날짜 텍스트 추출: 여러 소스에서 시도 (시간 정보 포함 우선)
          let dateText = '';
          
          // 1. datetime 속성 우선 확인 (가장 정확, ISO 8601 형식)
          const timeElement = document.querySelector('time[datetime]');
          if (timeElement) {
            dateText = timeElement.getAttribute('datetime') || '';
            if (!dateText) {
              dateText = timeElement.textContent?.trim() || '';
            }
          }
          
          // 2. datetime 속성이 없으면 텍스트에서 추출 (시간 정보 포함 우선)
          if (!dateText) {
            // 먼저 시간 정보가 포함된 텍스트를 찾음
            // 더 많은 선택자 시도
            const dateSelectors = [
              '.article_info .date',
              '.article_info .time',
              '.date',
              '.time',
              '.article-date',
              'time[datetime]',
              '[class*="date"]',
              '[class*="time"]',
              '[class*="Date"]',
              '[class*="Time"]',
              '.ArticleInfo .date',
              '.ArticleInfo .time',
              '.article_info_date',
              '.article_info_time'
            ];
            
            // 모든 선택자에서 시간 정보가 포함된 텍스트 찾기
            for (const selector of dateSelectors) {
              const elements = document.querySelectorAll(selector);
              for (const el of elements) {
                const text = el.textContent?.trim() || el.getAttribute('datetime') || el.getAttribute('title') || '';
                // 시간 정보가 포함된 텍스트 우선 (예: "2024.12.04 09:55", "2024-12-04 09:55", "2024/12/04 09:55", "2026.01.02. 11:17")
                // 날짜 구분자 뒤에 점이 있을 수 있으므로 [.\s]* 추가
                if (text && text.match(/(\d{4})[.\s\/-](\d{1,2})[.\s\/-](\d{1,2})[.\s]*[\s]+(\d{1,2})[:.](\d{2})/)) {
                  dateText = text;
                  break;
                }
              }
              if (dateText) break;
            }
            
            // 시간 정보가 포함된 텍스트를 찾지 못한 경우 날짜만 있는 텍스트 사용
            if (!dateText) {
              for (const selector of dateSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                  const text = el.textContent?.trim() || el.getAttribute('datetime') || '';
                  if (text && text.match(/\d{4}[.\s\/-]\d{1,2}[.\s\/-]\d{1,2}/)) {
                    dateText = text;
                    break;
                  }
                }
              }
            }
          }
          
          // 3. 여전히 없으면 다른 선택자 시도 (시간 정보 포함 우선)
          if (!dateText) {
            const dateElements = document.querySelectorAll('.date, time, [class*="date"], [class*="time"]');
            // 먼저 시간 정보가 포함된 텍스트 찾기
            for (const el of dateElements) {
              const text = el.textContent?.trim() || el.getAttribute('datetime') || '';
              // 날짜 구분자 뒤에 점이 있을 수 있으므로 [.\s]* 추가
              if (text && text.match(/(\d{4})[.\s\/-](\d{1,2})[.\s\/-](\d{1,2})[.\s]*[\s]+(\d{1,2})[:.](\d{2})/)) {
                dateText = text;
                break;
              }
            }
            // 시간 정보가 없으면 날짜만 있는 텍스트 사용
            if (!dateText) {
              for (const el of dateElements) {
                const text = el.textContent?.trim() || el.getAttribute('datetime') || '';
                if (text && text.match(/\d{4}[.\s\/-]\d{1,2}[.\s\/-]\d{1,2}/)) {
                  dateText = text;
                  break;
                }
              }
            }
          }
          
          const author = document.querySelector('.article_info .nick, .nickname, .author')?.textContent?.trim() || null;

          return { title: cleanTitle, content, dateText, author, usedSelector };
        }, elementTexts);

        // Legacy-style fallback: iframe 전체 텍스트
        // iframe 컨텍스트를 이미 사용 중이면 fallback 불필요
        if (!postData.content || postData.content.trim().length === 0) {
          try {
            // iframe 컨텍스트를 사용하지 않은 경우에만 fallback 시도
            if (!isInIframe) {
              const legacyFallback = await page.evaluate(() => {
                const iframe = document.querySelector('iframe#cafe_main, iframe#cafe_main_original, iframe[name="cafe_main"]');
                let doc = null;
                if (iframe && iframe.contentWindow && iframe.contentWindow.document) {
                  doc = iframe.contentWindow.document;
                }
                const pickText = (root) => root?.innerText?.trim() || '';
                let content = '';
                let author = '';
                let dateText = '';
                if (doc) {
                  content = pickText(doc.body);
                  author = doc.querySelector('.nickname, .nick, .writer')?.innerText?.trim() || '';
                  dateText = doc.querySelector('.date, .time, .article_info .date')?.innerText?.trim() || '';
                }
                if (!content) {
                  content = pickText(document.body);
                }
                return {
                  content: content || '',
                  author: author || '',
                  dateText: dateText || '',
                  usedSelector: 'iframe-body'
                };
              });

              if (legacyFallback?.content) {
                postData = {
                  ...postData,
                  content: legacyFallback.content,
                  author: postData.author || legacyFallback.author || null,
                  dateText: postData.dateText || legacyFallback.dateText || '',
                  usedSelector: legacyFallback.usedSelector || postData.usedSelector
                };
                logger.debug('[NaverCafeWorker] Legacy fallback content used', {
                  articleId,
                  contentLength: legacyFallback.content.length
                });
              }
            }
          } catch (legacyError) {
            logger.warn('[NaverCafeWorker] Legacy fallback extraction failed', {
              articleId,
              error: legacyError.message
            });
          }
        }

        // 추가 fallback: 본문이 여전히 비어있으면 더 적극적으로 텍스트 추출 시도
        // 팝업이 감지되었어도 본문 추출을 시도 (팝업 감지가 잘못되었을 수 있음)
        // 본문이 추출되면 나중에 requiresLogin을 false로 수정
        if (!postData.content || postData.content.trim().length === 0) {
          try {
            const aggressiveFallback = await contextToUse.evaluate(() => {
              // 더 많은 셀렉터 시도 (네이버 카페의 다양한 구조 대응)
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
                // 네이버 카페 특정 셀렉터 추가
                '.article-body',
                '.article-body-contents',
                '.article-content-wrapper',
                '.article-content-body',
                '.se-viewer .se-component',
                '.se-viewer .se-section',
                '.se-viewer .se-module'
              ];

              let content = '';
              let usedSelector = '';

              for (const selector of additionalSelectors) {
                try {
                  const element = document.querySelector(selector);
                  if (element) {
                    // textContent와 innerText 모두 시도
                    let text = element.textContent?.trim() || element.innerText?.trim() || '';
                    
                    // 제목 제거 (제목이 포함된 경우)
                    const pageTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                                     document.querySelector('.title_text, .article_title')?.textContent?.trim() ||
                                     document.title || '';
                    const cleanTitle = pageTitle.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
                    
                    if (cleanTitle && text.startsWith(cleanTitle)) {
                      text = text.substring(cleanTitle.length).trim();
                      text = text.replace(/^[\s\n\r:]+/, '').trim();
                    }
                    
                    // ": 네이버 카페" 제거
                    text = text.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
                    text = text.replace(/\s*:\s*네이버\s*카페\s*\n/g, '\n').trim();
                    
                    // 의미 있는 텍스트인지 확인 (최소 3자 이상, UI 요소가 아닌지, 제목과 다를 때만)
                    // cleanTitle은 이미 위에서 선언됨
                    if (text.length >= 3 && 
                        text.trim() !== cleanTitle.trim() &&
                        !text.match(/^(다음글목록|말머리|인기멤버|1:1 채팅|조회 \d+|댓글 \d+|URL 복사|배틀그라운드 공식카페)/i) &&
                        !text.match(/^[\s\n\r:]+$/)) {
                      content = text;
                      usedSelector = selector;
                      break;
                    }
                  }
                } catch (e) {
                  // 셀렉터 오류 무시하고 계속
                }
              }

              // 여전히 없으면 body에서 직접 추출 (하지만 UI 요소 제외)
              if (!content || content.length < 5) {
                const body = document.body;
                if (body) {
                  // article 관련 요소만 추출
                  const articleElements = body.querySelectorAll('article, [class*="article"], [id*="article"], [class*="post"], [id*="post"], [class*="se-"]');
                  const textParts = [];
                  
                  articleElements.forEach(el => {
                    let text = el.textContent?.trim() || el.innerText?.trim() || '';
                    
                    // 제목 제거
                    const pageTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                                     document.querySelector('.title_text, .article_title')?.textContent?.trim() ||
                                     document.title || '';
                    const cleanTitle = pageTitle.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
                    
                    if (cleanTitle && text.startsWith(cleanTitle)) {
                      text = text.substring(cleanTitle.length).trim();
                      text = text.replace(/^[\s\n\r:]+/, '').trim();
                    }
                    
                    // ": 네이버 카페" 제거
                    text = text.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
                    text = text.replace(/\s*:\s*네이버\s*카페\s*\n/g, '\n').trim();
                    
                    // UI 요소 패턴 제외, 제목과 다를 때만
                    // cleanTitle은 이미 위에서 선언됨
                    if (text.length >= 3 && 
                        text.trim() !== cleanTitle.trim() &&
                        !text.match(/^(다음글목록|말머리|인기멤버|1:1 채팅|조회 \d+|댓글 \d+|URL 복사|배틀그라운드 공식카페)/i) &&
                        !text.match(/^[\s\n\r:]+$/)) {
                      textParts.push(text);
                    }
                  });

                  if (textParts.length > 0) {
                    // 가장 긴 텍스트 사용
                    content = textParts.sort((a, b) => b.length - a.length)[0];
                    usedSelector = 'article-elements';
                  }
                }
              }

              return {
                content: content || '',
                usedSelector: usedSelector || 'none'
              };
            });

            if (aggressiveFallback?.content && aggressiveFallback.content.length >= 3) {
              // 제목 제거 (본문이 제목으로 시작하는 경우)
              let finalContent = aggressiveFallback.content;
              if (postData.title && finalContent.startsWith(postData.title)) {
                finalContent = finalContent.substring(postData.title.length).trim();
                finalContent = finalContent.replace(/^[\s\n\r:]+/, '').trim();
              }

              // 제목과 동일한 경우 제외
              if (finalContent.length >= 3 && finalContent.trim() !== postData.title.trim()) {
                postData = {
                  ...postData,
                  content: finalContent,
                  usedSelector: aggressiveFallback.usedSelector || postData.usedSelector
                };
                logger.info('[NaverCafeWorker] Aggressive fallback content extracted', {
                  articleId,
                  contentLength: finalContent.length,
                  contentPreview: finalContent.substring(0, 100),
                  usedSelector: aggressiveFallback.usedSelector
                });
              }
            }
          } catch (aggressiveError) {
            logger.warn('[NaverCafeWorker] Aggressive fallback extraction failed', {
              articleId,
              error: aggressiveError.message
            });
          }
        }
        
        // 디버깅 로그
        logger.info('[NaverCafeWorker] Content extracted', {
          articleId,
          title: postData.title?.substring(0, 50),
          contentLength: postData.content?.length || 0,
          contentPreview: postData.content?.substring(0, 100) || '(empty)',
          usedSelector: postData.usedSelector || 'none',
          url: articleUrl
        });
        
        // 본문이 비어있거나 너무 짧으면 상세 디버깅 정보 로그 (저장은 계속 진행)
        if (!postData.content || postData.content.length < 3) {
          // 페이지에서 실제 DOM 상태 확인 (iframe 컨텍스트 사용)
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
              seElementsTexts: Array.from(allSeElements).slice(0, 5).map(el => ({
                className: el.className,
                textLength: el.textContent?.trim().length || 0,
                textPreview: el.textContent?.trim().substring(0, 100) || '(none)'
              })),
              pageTitle: document.title,
              pageUrl: window.location.href
            };
          });
          
          logger.warn('[NaverCafeWorker] Content extraction incomplete - continuing with available data', {
            articleId,
            title: postData.title?.substring(0, 50),
            contentLength: postData.content?.length || 0,
            usedSelector: postData.usedSelector || 'none',
            url: articleUrl,
            debugInfo
          });
        }

        // postData 안전성 검사 (크리티컬: 이슈 승격에 필수)
        if (!postData || typeof postData !== 'object') {
          logger.error('[NaverCafeWorker] postData is invalid, skipping post', {
            articleId,
            postDataType: typeof postData,
            postDataValue: String(postData)
          });
          continue; // 이 게시글 스킵하고 다음 게시글 처리
        }

        // 로그인 필요 여부는 팝업/다이얼로그 감지에만 의존
        // 본문 추출 후에도 팝업 감지 결과를 유지 (팝업이 감지되지 않았으면 로그인 필요 아님)
        // 본문이 추출되었지만 팝업이 감지되지 않았으면 로그인 필요 아님
        const extractedContentLength = (postData.content && typeof postData.content === 'string') 
          ? postData.content.trim().length 
          : 0;
        const postTitle = (postData.title && typeof postData.title === 'string') 
          ? postData.title.trim() 
          : '';
        const postContent = (postData.content && typeof postData.content === 'string') 
          ? postData.content.trim() 
          : '';
        const isContentSameAsTitle = postContent === postTitle;
        
        // 본문 추출 결과를 우선적으로 확인하여 requiresLogin 재평가
        // 본문이 성공적으로 추출되면 requiresLogin을 false로 설정 (팝업 감지가 잘못되었을 수 있음)
        if (extractedContentLength > 0 && 
            !isContentSameAsTitle && 
            extractedContentLength >= 3) {
          // 실제 본문이 추출되었으면 로그인 필요 없음 (팝업 감지가 잘못되었을 수 있음)
          requiresLogin = false;
          logger.info('[NaverCafeWorker] Real content extracted, overriding requiresLogin=false (popup detection may have been false positive)', {
            articleId,
            title: postTitle.substring(0, 50),
            contentLength: extractedContentLength,
            contentPreview: postContent.substring(0, 100),
            hadPopupDetected: detectedLoginDialog || detectedLoginModal
          });
        } else if (extractedContentLength === 0 && requiresLogin) {
          // 본문이 추출되지 않았지만 이미지가 있는 경우, 로그인 필요 없음으로 재설정
          // (이미지만 있는 게시글은 본문이 비어있을 수 있음)
          if (hasImages) {
            requiresLogin = false;
            logger.info('[NaverCafeWorker] Images detected but no text content, overriding requiresLogin=false (image-only post)', {
              articleId,
              title: postTitle.substring(0, 50),
              hasImages: true,
              hadPopupDetected: detectedLoginDialog || detectedLoginModal
            });
          } else {
            // 본문도 없고 이미지도 없는 경우에만 로그인 필요로 유지
            logger.debug('[NaverCafeWorker] No content extracted and popup detected, keeping requiresLogin=true', {
              articleId,
              title: postTitle.substring(0, 50),
              detectedByDialog: detectedLoginDialog,
              detectedByModal: detectedLoginModal
            });
          }
        }

        // 키워드 매칭 확인 (필터링하지 않고 표시만)
        const fullText = `${postTitle || ''} ${postContent || ''}`.trim();
        const hasKeywordMatch = matchesKeywords(fullText, keywords);
        
        if (hasKeywordMatch) {
          keywordMatchedCount++;
          logger.debug('[NaverCafeWorker] Post matches keyword', {
            boardId: board.id,
            articleId,
            articleIdNum,
            title: postData.title?.substring(0, 50),
            keywordsCount: keywords.length
          });
        }

        // 날짜 파싱 (상세 페이지에서 추출한 날짜 사용, 없으면 목록에서 추출한 날짜 사용)
        // 한국 시간 기준으로 정확히 파싱
        let timestamp = new Date();
        let timestampKST = null;
        let timestampUTC = null;
        
        const { createKSTDate } = require('../../utils/dateUtils');
        
        // 상세 페이지에서 datetime 속성 확인 (가장 정확한 날짜 정보)
        // 일반 이슈의 경우 상세 페이지를 방문하므로, 상세 페이지의 dateText를 우선 사용
        // 하지만 목록 페이지에 시간 정보가 있고 상세 페이지에 없으면 목록 페이지 사용
        let dateTextToParse = null;
        
        // 1. 목록 페이지 dateText에 시간 정보가 있는지 먼저 확인 (목록 페이지가 더 정확할 수 있음)
        // 날짜+시간 형식 또는 시간만 있는 형식 모두 확인
        let listHasTimeInfo = false;
        let listHasTimeOnly = false;
        if (postInfo.dateText) {
          // 날짜+시간 형식: "2024.12.04 09:55" 또는 "2026.01.02. 11:17" (마지막 점 포함)
          // 날짜 구분자 뒤에 점이 있을 수 있으므로 [.\s]* 추가
          listHasTimeInfo = !!postInfo.dateText.match(/(\d{4})[.\s\/-](\d{1,2})[.\s\/-](\d{1,2})[.\s]*[\s]+(\d{1,2})[:.](\d{2})/);
          // 시간만 있는 형식: "09:55" (오늘 작성된 게시글)
          if (!listHasTimeInfo) {
            listHasTimeOnly = !!postInfo.dateText.match(/^(\d{1,2})[:.](\d{2})$/);
          }
        }
        
        // 2. 상세 페이지 dateText 확인
        let detailHasTimeInfo = false;
        let detailHasTimeOnly = false;
        if (postData.dateText) {
          // 날짜+시간 형식: "2024.12.04 09:55" 또는 "2026.01.02. 11:17" (마지막 점 포함)
          // 날짜 구분자 뒤에 점이 있을 수 있으므로 [.\s]* 추가
          detailHasTimeInfo = !!postData.dateText.match(/(\d{4})[.\s\/-](\d{1,2})[.\s\/-](\d{1,2})[.\s]*[\s]+(\d{1,2})[:.](\d{2})/);
          // 시간만 있는 형식: "09:55" (오늘 작성된 게시글)
          if (!detailHasTimeInfo) {
            detailHasTimeOnly = !!postData.dateText.match(/^(\d{1,2})[:.](\d{2})$/);
          }
        }
        
        // 3. 우선순위: 시간 정보가 있는 것을 우선 사용 (날짜+시간 > 시간만 > 날짜만)
        if (listHasTimeInfo && detailHasTimeInfo) {
          // 둘 다 날짜+시간 정보가 있으면 상세 페이지 사용 (더 정확할 수 있음)
          dateTextToParse = postData.dateText;
          logger.info('[NaverCafeWorker] Using detail page dateText (both have date+time info)', {
            boardId: board.id,
            articleId,
            detailDateText: postData.dateText,
            listDateText: postInfo.dateText,
            requiresLogin
          });
        } else if (listHasTimeInfo) {
          // 목록 페이지에만 날짜+시간 정보가 있으면 목록 페이지 사용
          dateTextToParse = postInfo.dateText;
          logger.info('[NaverCafeWorker] Using list page dateText (has date+time info, detail page has no date+time)', {
            boardId: board.id,
            articleId,
            detailDateText: postData.dateText,
            listDateText: postInfo.dateText,
            requiresLogin
          });
        } else if (detailHasTimeInfo) {
          // 상세 페이지에만 날짜+시간 정보가 있으면 상세 페이지 사용
          dateTextToParse = postData.dateText;
          logger.info('[NaverCafeWorker] Using detail page dateText (has date+time info)', {
            boardId: board.id,
            articleId,
            dateText: postData.dateText,
            requiresLogin
          });
        } else if (listHasTimeOnly && detailHasTimeOnly) {
          // 둘 다 시간만 있으면 상세 페이지 사용 (더 정확할 수 있음)
          dateTextToParse = postData.dateText;
          logger.info('[NaverCafeWorker] Using detail page dateText (both have time only - 오늘 작성)', {
            boardId: board.id,
            articleId,
            detailDateText: postData.dateText,
            listDateText: postInfo.dateText,
            requiresLogin
          });
        } else if (listHasTimeOnly) {
          // 목록 페이지에만 시간만 있으면 목록 페이지 사용
          dateTextToParse = postInfo.dateText;
          logger.info('[NaverCafeWorker] Using list page dateText (has time only - 오늘 작성, detail page has no time)', {
            boardId: board.id,
            articleId,
            detailDateText: postData.dateText,
            listDateText: postInfo.dateText,
            requiresLogin
          });
        } else if (detailHasTimeOnly) {
          // 상세 페이지에만 시간만 있으면 상세 페이지 사용
          dateTextToParse = postData.dateText;
          logger.info('[NaverCafeWorker] Using detail page dateText (has time only - 오늘 작성)', {
            boardId: board.id,
            articleId,
            dateText: postData.dateText,
            requiresLogin
          });
        } else if (postData.dateText) {
          // 둘 다 시간 정보가 없으면 상세 페이지 사용 (날짜만 또는 없음)
          dateTextToParse = postData.dateText;
          logger.warn('[NaverCafeWorker] Using detail page dateText (no time info in both) - 시간 정보 없음', {
            boardId: board.id,
            articleId,
            detailDateText: postData.dateText,
            listDateText: postInfo.dateText,
            requiresLogin,
            title: postData.title?.substring(0, 50)
          });
        } else if (postInfo.dateText) {
          // 상세 페이지 dateText가 없으면 목록 페이지 사용
          dateTextToParse = postInfo.dateText;
          logger.warn('[NaverCafeWorker] Using list page dateText (detail page has no dateText) - 시간 정보 없음', {
            boardId: board.id,
            articleId,
            listDateText: postInfo.dateText,
            requiresLogin,
            title: postData.title?.substring(0, 50)
          });
        } else {
          logger.error('[NaverCafeWorker] No dateText found in both list and detail page', {
            boardId: board.id,
            articleId,
            requiresLogin,
            title: postData.title?.substring(0, 50)
          });
        }
        
        // datetime 속성이 있으면 우선 사용 (ISO 8601 형식)
        if (postData.dateText && postData.dateText.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/)) {
          // datetime 속성은 ISO 8601 형식이므로 직접 파싱
          try {
            const datetimeDate = new Date(postData.dateText);
            if (!isNaN(datetimeDate.getTime())) {
              // datetime 속성의 날짜를 한국 시간으로 해석
              const kstParts = datetimeDate.toLocaleString('en-US', {
                timeZone: 'Asia/Seoul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
              });
              const [datePart, timePart] = kstParts.split(', ');
              const [month, day, year] = datePart.split('/');
              const [hour, minute] = timePart.split(':');
              
              timestampUTC = createKSTDate(parseInt(year), parseInt(month), parseInt(day), parseInt(hour), parseInt(minute));
              timestampKST = timestampUTC;
              timestamp = timestampUTC;
              
              logger.debug('[NaverCafeWorker] Post timestamp parsed from datetime attribute', {
                boardId: board.id,
                articleId,
                articleIdNum,
                datetimeAttribute: postData.dateText,
                timestampKST: timestampKST.toISOString(),
                timestampKSTLocal: timestampKST.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
                timestampUTC: timestampUTC.toISOString()
              });
              
              dateTextToParse = null; // 이미 파싱했으므로 다음 로직 스킵
            }
          } catch (e) {
            logger.warn('[NaverCafeWorker] Failed to parse datetime attribute', {
              boardId: board.id,
              articleId,
              datetimeAttribute: postData.dateText,
              error: e.message
            });
          }
        }
        
        if (dateTextToParse) {
          // 형식 1: "2024.12.04 09:55" 또는 "2024-12-04 09:55" 또는 "2024/12/04 09:55" 또는 "2026.01.02. 11:17" (날짜 + 시간)
          // 더 포괄적인 정규식: 날짜 구분자가 . 또는 - 또는 / 또는 공백, 시간 구분자가 : 또는 .
          // 날짜 구분자 뒤에 점이 있을 수 있으므로 [.\s]* 추가
          const dateMatch = dateTextToParse.match(/(\d{4})[.\s\/-](\d{1,2})[.\s\/-](\d{1,2})[.\s]*[\s]+(\d{1,2})[:.](\d{2})/);
          if (dateMatch) {
            const [, year, month, day, hour, minute] = dateMatch;
            // createKSTDate는 이미 UTC로 변환된 Date를 반환하므로 바로 사용
            timestampUTC = createKSTDate(parseInt(year), parseInt(month), parseInt(day), parseInt(hour), parseInt(minute));
            timestampKST = timestampUTC; // 참조용 (실제로는 UTC Date이지만 한국 시간 값)
            // createKSTDate로 생성된 Date는 이미 UTC로 저장되어 있으므로 toISOString() 직접 사용
            // toKSTISOString을 사용하면 이중 변환되어 시간이 잘못 저장됨
            timestamp = timestampUTC;
            
            logger.debug('[NaverCafeWorker] Post timestamp parsed', {
              boardId: board.id,
              articleId,
              articleIdNum,
              dateText: dateTextToParse,
              timestampKST: timestampKST.toISOString(),
              timestampKSTLocal: timestampKST.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
              timestampUTC: timestampUTC.toISOString(),
              timestampForDB: timestamp.toISOString()
            });
          } else {
            // 형식 2: "2024.12.04" 또는 "2025.12.12." 또는 "2024-12-04" (날짜만)
            // 날짜만 있는 경우, 상세 페이지와 목록 페이지의 dateText를 비교하여
            // 상세 페이지에 시간 정보가 있는지 다시 확인
            const dateOnlyMatch = dateTextToParse.match(/(\d{4})[.\s\/-](\d{1,2})[.\s\/-](\d{1,2})/);
            if (dateOnlyMatch) {
              // 상세 페이지와 목록 페이지의 dateText가 다르면 상세 페이지를 우선 사용
              if (postData.dateText && postInfo.dateText && postData.dateText !== postInfo.dateText) {
                // 상세 페이지 dateText에 시간 정보가 있는지 다시 확인
                const detailDateMatch = postData.dateText.match(/(\d{4})[.\s\/-](\d{1,2})[.\s\/-](\d{1,2})[\s]+(\d{1,2})[:.](\d{2})/);
                if (detailDateMatch) {
                  const [, year, month, day, hour, minute] = detailDateMatch;
                  timestampUTC = createKSTDate(parseInt(year), parseInt(month), parseInt(day), parseInt(hour), parseInt(minute));
                  timestampKST = timestampUTC;
                  timestamp = timestampUTC;
                  
                  logger.debug('[NaverCafeWorker] Post timestamp parsed from detail page (dateText comparison)', {
                    boardId: board.id,
                    articleId,
                    articleIdNum,
                    listDateText: postInfo.dateText,
                    detailDateText: postData.dateText,
                    timestampKST: timestampKST.toISOString(),
                    timestampKSTLocal: timestampKST.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                  });
                } else {
                  // 상세 페이지에도 시간 정보가 없으면 자정으로 설정
                  const [, year, month, day] = dateOnlyMatch;
                  timestampUTC = createKSTDate(parseInt(year), parseInt(month), parseInt(day), 0, 0);
                  timestampKST = timestampUTC;
                  timestamp = timestampUTC;
                  
                  logger.warn('[NaverCafeWorker] Post timestamp parsed (date only, assumed midnight) - 시간 정보 없음 (상세 페이지 확인했으나 시간 정보 없음)', {
                    boardId: board.id,
                    articleId,
                    articleIdNum,
                    listDateText: postInfo.dateText,
                    detailDateText: postData.dateText,
                    timestampKST: timestampKST.toISOString(),
                    timestampKSTLocal: timestampKST.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                  });
                }
              } else {
                // 상세 페이지와 목록 페이지가 같거나 상세 페이지가 없으면 자정으로 설정
                const [, year, month, day] = dateOnlyMatch;
                timestampUTC = createKSTDate(parseInt(year), parseInt(month), parseInt(day), 0, 0);
                timestampKST = timestampUTC;
                timestamp = timestampUTC;
                
                logger.warn('[NaverCafeWorker] Post timestamp parsed (date only, assumed midnight) - 시간 정보 없음', {
                  boardId: board.id,
                  articleId,
                  articleIdNum,
                  dateText: dateTextToParse,
                  postDataDateText: postData.dateText,
                  postInfoDateText: postInfo.dateText,
                  timestampKST: timestampKST.toISOString(),
                  timestampKSTLocal: timestampKST.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                });
              }
            } else {
              // 형식 3: "09:55" 또는 "9:55" (시간만)
              // 네이버 카페에서는 오늘 작성된 게시글만 시간만 표시하지만,
              // 크롤러 실행 시점에 따라 어제 밤에 작성된 게시글이 오늘 아침에 크롤링될 수 있음
              // 따라서 시간만 있는 경우, 상세 페이지에서 더 정확한 날짜 정보를 확인하거나,
              // 게시글 수집 시간(createdAt)을 기준으로 날짜를 추정
              const timeOnlyMatch = dateTextToParse.match(/^(\d{1,2})[:.](\d{2})$/);
              if (timeOnlyMatch) {
                const [, hour, minute] = timeOnlyMatch;
                
                // 시간만 있는 경우 날짜 추정 로직
                // 1. 상세 페이지에서 날짜 정보가 있는지 확인 (postData.dateText가 postInfo.dateText와 다른 경우)
                // 2. 없으면 게시글 수집 시간을 기준으로 날짜 추정
                //    - 크롤링 시간이 자정 이후이고 파싱된 시간이 크롤링 시간보다 크면 어제로 간주
                //    - 예: 크롤링 시간이 01:00이고 파싱된 시간이 23:30이면 어제 23:30
                
                const now = new Date();
                const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
                const kstHour = kstNow.getHours();
                const kstMinute = kstNow.getMinutes();
                const parsedHour = parseInt(hour);
                const parsedMinute = parseInt(minute);
                
                // 크롤링 시간과 파싱된 시간 비교
                // 파싱된 시간이 크롤링 시간보다 크면 어제로 간주 (예: 크롤링 01:00, 파싱 23:30 → 어제 23:30)
                let targetDate = new Date(kstNow);
                const parsedTimeMinutes = parsedHour * 60 + parsedMinute;
                const crawlTimeMinutes = kstHour * 60 + kstMinute;
                
                if (parsedTimeMinutes > crawlTimeMinutes + 60) {
                  // 파싱된 시간이 크롤링 시간보다 1시간 이상 크면 어제로 간주
                  targetDate.setDate(targetDate.getDate() - 1);
                  logger.debug('[NaverCafeWorker] Time-only date: assuming yesterday (parsed time is later than crawl time)', {
                    boardId: board.id,
                    articleId,
                    parsedTime: `${parsedHour}:${parsedMinute.toString().padStart(2, '0')}`,
                    crawlTime: `${kstHour}:${kstMinute.toString().padStart(2, '0')}`,
                    timeDiffMinutes: parsedTimeMinutes - crawlTimeMinutes
                  });
                }
                
                const year = targetDate.getFullYear();
                const month = targetDate.getMonth() + 1;
                const day = targetDate.getDate();
                
                // createKSTDate는 이미 UTC로 변환된 Date를 반환하므로 바로 사용
                timestampUTC = createKSTDate(year, month, day, parsedHour, parsedMinute);
                timestampKST = timestampUTC; // 참조용
                // createKSTDate로 생성된 Date는 이미 UTC로 저장되어 있으므로 toISOString() 직접 사용
                timestamp = timestampUTC;
                
                logger.debug('[NaverCafeWorker] Post timestamp parsed (time only, date estimated)', {
                  boardId: board.id,
                  articleId,
                  articleIdNum,
                  dateText: dateTextToParse,
                  estimatedDate: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
                  parsedTime: `${parsedHour}:${parsedMinute.toString().padStart(2, '0')}`,
                  crawlTime: `${kstHour}:${kstMinute.toString().padStart(2, '0')}`,
                  timestampKST: timestampKST.toISOString(),
                  timestampKSTLocal: timestampKST.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
                  timestampUTC: timestampUTC.toISOString(),
                  timestampForDB: timestamp.toISOString()
                });
              } else {
                // 파싱 실패 - 원본 dateText 로깅
                logger.warn('[NaverCafeWorker] Failed to parse dateText - 형식을 인식할 수 없음', {
                  boardId: board.id,
                  articleId,
                  articleIdNum,
                  dateText: dateTextToParse,
                  postDataDateText: postData.dateText,
                  postInfoDateText: postInfo.dateText
                });
              }
            }
          }
        } else {
          logger.warn('[NaverCafeWorker] dateText가 없음 - timestamp를 현재 시간으로 설정', {
            boardId: board.id,
            articleId,
            articleIdNum,
            postDataDateText: postData?.dateText,
            postInfoDateText: postInfo?.dateText
          });
        }
        
        // timestamp가 설정되지 않았으면 현재 시간 사용 (UTC)
        if (!timestampUTC) {
          timestamp = new Date();
          logger.debug('[NaverCafeWorker] Using current time as timestamp (date parsing failed)', {
            boardId: board.id,
            articleId,
            articleIdNum,
            timestampUTC: timestamp.toISOString()
          });
        }

        // RawLog 저장 (제목과 본문 분리) - 안전성 보장
        // 로그인 필요 게시글의 경우, 상세 페이지에서 추출한 제목이 일반적인 제목("네이버 카페", "배틀그라운드 공식카페 - PUBG: BATTLEGROUNDS")인 경우
        // 리스트 페이지에서 추출한 원래 제목을 우선 사용
        let title = '';
        if (postData && postData.title && typeof postData.title === 'string') {
          const postDataTitle = postData.title.trim();
          // 일반적인 제목 패턴 체크
          const genericTitlePatterns = [
            /^네이버\s*카페$/i,
            /^배틀그라운드\s*공식카페\s*-\s*PUBG:? ?BATTLEGROUNDS/i
          ];
          const isGenericTitle = genericTitlePatterns.some((re) => re.test(postDataTitle));
          
          // 상세 페이지 제목이 일반적인 제목이고, 리스트 페이지에 원래 제목이 있으면 리스트 페이지 제목 사용
          if (isGenericTitle && postInfo && postInfo.title && typeof postInfo.title === 'string' && postInfo.title.trim().length > 0) {
            title = postInfo.title.trim();
            logger.debug('[NaverCafeWorker] Using list page title instead of generic detail page title', {
              articleId,
              listTitle: title.substring(0, 50),
              detailTitle: postDataTitle.substring(0, 50),
              requiresLogin
            });
          } else {
            title = postDataTitle;
          }
        } else if (postInfo && postInfo.title && typeof postInfo.title === 'string') {
          title = postInfo.title.trim();
        }
        let content = (postData && postData.content && typeof postData.content === 'string') 
          ? postData.content 
          : '';
        content = stripTrailingSignature(content);
        
        // 본문 추출 성공 여부 확인 (원본 본문 길이 저장)
        const originalContentLength = content?.trim().length || 0;
        const originalContent = content; // 원본 본문 백업
        
        // 제목과 본문이 동일한 경우 본문 제거 (더 엄격한 체크)
        // 단, 이미지가 있는 경우에는 본문을 보존 (이미지와 함께 본문이 있는 경우)
        if (content && title && !hasImages) {
          const contentTrimmed = content.trim();
          const titleTrimmed = title.trim();
          
          // 정확히 동일한 경우 (이미지가 없을 때만 제거)
          if (contentTrimmed === titleTrimmed) {
            logger.debug('[NaverCafeWorker] Content is identical to title, removing content (no images)', {
              articleId,
              title: title.substring(0, 50)
            });
            content = '';
          }
          // 본문이 제목으로 시작하고 제목 길이와 비슷한 경우 (제목만 있는 것으로 간주)
          else if (contentTrimmed.startsWith(titleTrimmed) && contentTrimmed.length <= titleTrimmed.length + 5) {
            const trimmed = contentTrimmed.substring(titleTrimmed.length).trim();
            // 제목 뒤에 의미 있는 내용이 없으면 빈 문자열
            if (trimmed.length < 3) {
              logger.debug('[NaverCafeWorker] Content is mostly title, removing content (no images)', {
                articleId,
                title: title.substring(0, 50),
                contentLength: contentTrimmed.length,
                titleLength: titleTrimmed.length
              });
              content = '';
            } else {
              // 제목 뒤에 의미 있는 내용이 있으면 제목 부분만 제거
              content = trimmed;
              logger.debug('[NaverCafeWorker] Removed title prefix from content', {
                articleId,
                originalLength: contentTrimmed.length,
                newLength: trimmed.length
              });
            }
          }
          // 본문이 제목으로 시작하는 경우 제목 부분 제거
          else if (contentTrimmed.startsWith(titleTrimmed)) {
            const trimmed = contentTrimmed.substring(titleTrimmed.length).trim();
            if (trimmed.length >= 3) {
              content = trimmed;
              logger.debug('[NaverCafeWorker] Removed title prefix from content', {
                articleId,
                originalLength: contentTrimmed.length,
                newLength: trimmed.length
              });
            } else {
              // 제목 뒤에 의미 있는 내용이 없으면 빈 문자열
              content = '';
            }
          }
        } else if (content && title && hasImages) {
          // 이미지가 있는 경우, 본문이 제목과 동일하거나 제목으로 시작해도 본문을 보존
          // 단, 제목 뒤에 실제 본문이 있는 경우에만 제목 부분 제거
          const contentTrimmed = content.trim();
          const titleTrimmed = title.trim();
          
          // 본문이 제목으로 시작하고 제목 뒤에 실제 본문이 있는 경우에만 제목 부분 제거
          if (contentTrimmed.startsWith(titleTrimmed) && contentTrimmed.length > titleTrimmed.length + 5) {
            const trimmed = contentTrimmed.substring(titleTrimmed.length).trim();
            if (trimmed.length >= 10) {
              // 제목 뒤에 충분한 본문이 있으면 제목 부분만 제거
              content = trimmed;
              logger.debug('[NaverCafeWorker] Removed title prefix from content (has images)', {
                articleId,
                originalLength: contentTrimmed.length,
                newLength: trimmed.length
              });
            }
            // 제목 뒤에 본문이 충분하지 않으면 본문 전체 보존
          }
          // 본문이 제목과 동일하거나 제목만 있는 경우에도 본문 보존 (이미지가 있으므로)
        }
        
        // 본문이 비어있을 때 처리
        // 중요: 원본 본문이 있었는데 제목 제거 후 비어졌다면, 원본 본문을 사용 (이미지와 함께 본문이 있는 경우)
        const finalContentLength = content?.trim().length || 0;
        if (finalContentLength === 0 && originalContentLength > 0 && originalContentLength >= 3) {
          // 원본 본문이 있었는데 제목 제거로 인해 비어졌다면 원본 본문 사용
          // 단, 제목과 정확히 동일한 경우는 제외 (이미 위에서 처리됨)
          if (originalContent.trim() !== title.trim()) {
            content = originalContent;
            logger.debug('[NaverCafeWorker] Restored original content after title removal (content was removed but original exists)', {
              articleId,
              originalLength: originalContentLength,
              title: title.substring(0, 50)
            });
          }
        }
        
        // 본문이 여전히 비어있을 때 처리
        if (!content || content.trim().length === 0) {
          if (requiresLogin) {
            // 로그인 필요 게시글은 본문을 비워둠
            content = '';
            logger.debug('[NaverCafeWorker] Login required post, keeping content empty', {
              articleId,
              title: title.substring(0, 50)
            });
          } else {
            // 로그인 필요가 아닌데 본문이 비어있는 경우
            // 본문 추출 실패 시 빈 문자열 유지 (제목을 본문으로 사용하지 않음)
            // naverCafeIssues.service.js에서 detail이 summary와 동일하면 자동으로 비워지므로
            // 여기서는 빈 문자열을 유지하는 것이 맞음
            if (hasImages) {
              // 이미지가 있는 경우에만 placeholder 사용
              content = '[이미지/미디어 포함]';
              logger.warn('[NaverCafeWorker] Content extraction failed for public post with images, using placeholder', {
                articleId,
                title: title.substring(0, 50),
                containerFound
              });
            } else {
              // 이미지도 없고 본문도 없는 경우는 빈 문자열 유지
              // 제목을 본문으로 사용하지 않음 (제목과 본문이 같아지는 문제 방지)
              content = '';
              logger.warn('[NaverCafeWorker] Content extraction failed for public post, keeping content empty', {
                articleId,
                title: title.substring(0, 50),
                containerFound
              });
            }
          }
        }

        // 컨테이너를 찾지 못한 경우 isError 플래그 설정
        const isError = !containerFound;
        
        // 본문에서 불필요한 텍스트 제거 (에러 메시지, UI 텍스트 등)
        const cleanedContent = cleanContent(content);

        await saveRawLog({
          url: articleUrl,
          title: title,
          content: cleanedContent, // 정리된 본문 저장
          author: postData.author || postInfo.author,
          timestamp,
          externalPostId: articleId,
          cafeGame: board.cafeGame,
          monitoredBoardId: board.id,
          screenshotPath: screenshotPath,
          postImagePaths: postImagePaths.length > 0 ? postImagePaths : null,
          hasImages: hasImages,
          requiresLogin: requiresLogin,
          commentCount: commentCount,
          scrapedComments: scrapedComments,
          isHotTopic: isHotTopic,
          isError: isError, // 컨테이너를 찾지 못한 경우 에러 플래그
          hasKeywordMatch: hasKeywordMatch // 키워드 매칭 여부
        });

        savedCount++;
        newPostsCount++;
        lastArticleIdNum = Math.max(lastArticleIdNum, articleIdNum);

        logger.debug('[NaverCafeWorker] Post saved successfully', {
          boardId: board.id,
          articleId,
          articleIdNum,
          title: postData.title?.substring(0, 50),
          commentCount,
          hasScrapedComments: !!scrapedComments,
          isHotTopic
        });

        // 요청 간 딜레이 (서버 부하 방지)
        await page.waitForTimeout(500); // 1초 -> 0.5초로 단축

      } catch (error) {
        errorCount++;
        logger.error('[NaverCafeWorker] Failed to process post', {
          boardId: board.id,
          articleId: postInfo.href,
          title: postInfo.title?.substring(0, 50),
          error: error.message,
          stack: error.stack
        });
        // 개별 게시글 실패는 계속 진행
      }
    }

    // 최종 결과 요약 로그
    logger.info('[NaverCafeWorker] Post processing summary', {
      boardId: board.id,
      boardName: board.name || board.label,
      url: targetUrl,
      summary: {
        totalFound: postsList.length,
        skipped: {
          noArticleId: skippedNoArticleId,
          alreadyProcessed: skippedAlreadyProcessed,
          skippedByDate: skippedByDate,
          total: skippedNoArticleId + skippedAlreadyProcessed + skippedByDate
        },
        keywordMatched: keywordMatchedCount,
        saved: savedCount,
        errors: errorCount,
        newPostsCount: newPostsCount,
        processingRate: postsList.length > 0 ? ((savedCount / postsList.length) * 100).toFixed(1) + '%' : '0%'
      },
      lastArticleId: String(lastArticleIdNum),
      message: `총 ${postsList.length}개 발견 -> ${skippedNoArticleId + skippedAlreadyProcessed + skippedByDate}개 스킵 (articleId: ${skippedAlreadyProcessed}, 날짜: ${skippedByDate}) -> ${savedCount}개 저장 시도 (키워드 매칭: ${keywordMatchedCount}개, 에러: ${errorCount}개)`
    });

    // lastArticleId 업데이트
    const now = new Date().toISOString();
    if (lastArticleIdNum > 0) {
      execute(
        'UPDATE MonitoredBoard SET lastArticleId = ?, lastScanAt = ?, updatedAt = ? WHERE id = ?',
        [String(lastArticleIdNum), now, now, board.id]
      );
    } else {
      execute(
        'UPDATE MonitoredBoard SET lastScanAt = ?, updatedAt = ? WHERE id = ?',
        [now, now, board.id]
      );
    }

    logger.info('[NaverCafeWorker] Board scan completed', {
      boardId: board.id,
      newPostsCount,
      lastArticleId: String(lastArticleIdNum)
    });

  } catch (error) {
    logger.error('[NaverCafeWorker] Failed to scan board', {
      boardId: board.id,
      error: error.message,
      stack: error.stack
    });
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(err => logger.warn('[NaverCafeWorker] Page close failed', { error: err.message }));
    }
  }
}

/**
 * 모든 활성화된 게시판 스캔
 * DB에서 동적으로 활성화된 게시판 목록을 가져와서 스캔합니다.
 */
async function scanAllBoards() {
  if (!isRunning) return;

  try {
    // 매 스캔마다 DB에서 최신 활성화된 게시판 목록을 가져옵니다
    // 클랜 워커와 동일 타깃 id는 일반 워커에서 제외(이름 패턴 행 또는 explicit 부모판)
    const clanDedicatedIds = getClanWorkerTargetMonitoredBoardIds();
    const clanPh = clanDedicatedIds.length > 0 ? clanDedicatedIds.map(() => '?').join(',') : null;
    const boards = query(
      `SELECT * FROM MonitoredBoard 
       WHERE isActive = 1 AND enabled = 1 
       AND (name NOT LIKE '%클랜%' AND name NOT LIKE '%클랜/방송/디스코드%' AND name NOT LIKE '%클랜 홍보%')
       ${clanPh ? `AND id NOT IN (${clanPh})` : ''}
       ORDER BY createdAt ASC`,
      clanPh ? clanDedicatedIds : []
    );

    if (boards.length === 0) {
      logger.debug('[NaverCafeWorker] No active boards to scan');
      return;
    }

    logger.info('[NaverCafeWorker] Starting scan', { 
      count: boards.length,
      boardIds: boards.map(b => b.id)
    });

    let runSuccess = 0;
    let runFail = 0;
    for (const board of boards) {
      // Interval 체크 (checkInterval 또는 interval 사용, 기본값 300초 = 5분)
      // 시스템 부하를 고려하여 최소 간격을 180초(3분)로 설정
      const interval = board.checkInterval || board.interval || 300;
      const minInterval = 180; // 최소 3분 간격 (시스템 부하 감소)
      const effectiveInterval = Math.max(minInterval, interval);
      
      if (board.lastScanAt) {
        const diffSec = (Date.now() - new Date(board.lastScanAt).getTime()) / 1000;
        if (diffSec < effectiveInterval) {
          logger.debug('[NaverCafeWorker] Skipping board (too recent)', {
            boardId: board.id,
            name: board.name || board.label,
            interval: effectiveInterval,
            lastScanAt: board.lastScanAt,
            diffSec: Math.round(diffSec)
          });
          continue;
        }
      }

      try {
        await scanBoard(board);
        runSuccess++;
      } catch (e) {
        runFail++;
        logBoardScanFailure('NaverCafeWorker', board, e);
      }
    }

    const attempted = runSuccess + runFail;
    logScanCycleAllFailed('NaverCafeWorker', {
      attempted,
      success: runSuccess,
      fail: runFail
    });

    try {
      const { reportWorkerStats } = require('../../utils/workerStatsReporter');
      reportWorkerStats('naverCafe', runSuccess, runFail);
    } catch (_) {}

  } catch (error) {
    logger.error('[NaverCafeWorker] Scan failed', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * 워커 시작
 */
async function start() {
  if (isRunning) {
    logger.warn('[NaverCafeWorker] Already running');
    return;
  }

  isRunning = true;
  logger.info('[NaverCafeWorker] Starting...');

  try {
    // 초기 설정 로드
    NAVER_CAFE_COOKIE = await loadNaverCafeCookie();
    SCAN_INTERVAL_MS = await loadScanInterval();
    
    if (NAVER_CAFE_COOKIE) {
      logger.info('[NaverCafeWorker] Cookie loaded from config');
    } else {
      logger.info('[NaverCafeWorker] No cookie configured - public content only');
    }
    
    logger.info('[NaverCafeWorker] Scan interval', { 
      intervalMs: SCAN_INTERVAL_MS, 
      intervalSec: SCAN_INTERVAL_MS / 1000 
    });
    
    // 브라우저 초기화 (한글 폰트 지원 및 크래시 방지)
    browser = await chromium.launch({
      headless: BROWSER_HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        // 메모리 및 크래시 방지
        '--disable-software-rasterizer',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        // 한글 폰트 렌더링 개선
        '--font-render-hinting=none',
        '--disable-font-subpixel-positioning',
        '--enable-font-antialiasing',
        // 메모리 절감
        '--disable-extensions',
        '--disable-sync',
        '--disable-default-apps',
        '--mute-audio',
        '--no-first-run',
        '--disable-hang-monitor',
        '--disable-client-side-phishing-detection',
        '--disable-popup-blocking',
        '--no-default-browser-check',
        '--disable-breakpad'
      ],
      timeout: 60000
    });

    logger.info('[NaverCafeWorker] Browser launched');

    // 즉시 한 번 스캔
    await scanAllBoards();

    // 랜덤 대기 후 다음 스캔 스케줄링 (재귀 함수)
    let lastManualTriggerCheck = 0;
    
    /**
     * 다음 스캔을 랜덤 대기 시간 후에 실행하는 재귀 함수
     */
    async function scheduleNextScan() {
      if (!isRunning) {
        return; // 워커가 중지되었으면 스케줄링 중단
      }

      try {
        // 수동 트리거 플래그 체크
        const now = Date.now();
        if (now - lastManualTriggerCheck > 30000) {
          lastManualTriggerCheck = now;
          
          const triggerConfig = queryOne('SELECT * FROM MonitoringConfig WHERE key = ?', ['manual_scan_trigger']);
          
          if (triggerConfig) {
            const triggerTime = parseInt(triggerConfig.value, 10);
            // 트리거가 최근 1분 이내에 설정되었으면 스캔 실행
            if (now - triggerTime < 60000) {
              logger.info('[NaverCafeWorker] Manual scan trigger detected, starting scan...');
              // 트리거 플래그 삭제 (한 번만 실행)
              try {
                execute('DELETE FROM MonitoringConfig WHERE key = ?', ['manual_scan_trigger']);
              } catch (err) {
                // 삭제 실패해도 무시
              }
              
              await scanAllBoards();
              // 수동 스캔 후에도 랜덤 대기 후 다음 스캔 스케줄링
              const waitTime = getRandomWaitTime();
              logger.info('[NaverCafeWorker] Next scan scheduled after manual trigger', {
                waitTimeMs: waitTime,
                waitTimeSec: Math.round(waitTime / 1000),
                waitTimeMin: (waitTime / 60000).toFixed(2)
              });
              scheduledScanTimeout = setTimeout(scheduleNextScan, waitTime);
              return;
            }
          }
        }
        
        // 정기 스캔 실행
        await scanAllBoards();
        
        // 스캔 완료 후 랜덤 대기 시간 계산
        const waitTime = getRandomWaitTime();
        logger.info('[NaverCafeWorker] Scan completed, next scan scheduled', {
          waitTimeMs: waitTime,
          waitTimeSec: Math.round(waitTime / 1000),
          waitTimeMin: (waitTime / 60000).toFixed(2)
        });
        
        // 랜덤 대기 시간 후 다음 스캔 스케줄링
        scheduledScanTimeout = setTimeout(scheduleNextScan, waitTime);
        
      } catch (err) {
        logger.error('[NaverCafeWorker] Scheduled scan failed', { 
          error: err.message,
          stack: err.stack 
        });
        
        // 에러 발생 시에도 다음 스캔 스케줄링 (랜덤 대기)
        const waitTime = getRandomWaitTime();
        logger.info('[NaverCafeWorker] Rescheduling after error', {
          waitTimeMs: waitTime,
          waitTimeSec: Math.round(waitTime / 1000)
        });
        scheduledScanTimeout = setTimeout(scheduleNextScan, waitTime);
      }
    }

    // 첫 번째 랜덤 대기 후 스캔 시작
    const initialWaitTime = getRandomWaitTime();
    logger.info('[NaverCafeWorker] Started with random interval', { 
      minWaitSec: MIN_WAIT_MS / 1000,
      maxWaitSec: MAX_WAIT_MS / 1000,
      initialWaitTimeMs: initialWaitTime,
      initialWaitTimeSec: Math.round(initialWaitTime / 1000),
      initialWaitTimeMin: (initialWaitTime / 60000).toFixed(2)
    });
    scheduledScanTimeout = setTimeout(scheduleNextScan, initialWaitTime);

  } catch (error) {
    logger.error('[NaverCafeWorker] Failed to start', {
      error: error.message,
      stack: error.stack
    });
    isRunning = false;
    process.exit(1);
  }
}

/**
 * 워커 종료
 */
async function stop() {
  if (!isRunning) return;

  isRunning = false;
  logger.info('[NaverCafeWorker] Stopping...');

  // 기존 interval 제거 (레거시 호환성)
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }

  // 랜덤 대기 timeout 제거
  if (scheduledScanTimeout) {
    clearTimeout(scheduledScanTimeout);
    scheduledScanTimeout = null;
  }

  // 브라우저 종료 (모든 페이지 닫기)
  if (browser) {
    try {
      // 모든 페이지 닫기
      const pages = await browser.pages();
      await Promise.all(pages.map(page => {
        return page.close().catch(err => {
          logger.warn('[NaverCafeWorker] Error closing page', { error: err.message });
        });
      }));
      
      // 브라우저 종료
      await browser.close();
      browser = null;
      logger.info('[NaverCafeWorker] Browser closed');
    } catch (error) {
      logger.error('[NaverCafeWorker] Error closing browser', { 
        error: error.message,
        stack: error.stack
      });
      browser = null;
    }
  }

  logger.info('[NaverCafeWorker] Stopped');
  
  // 정리 완료 후 프로세스 종료
  process.exit(0);
}

// 프로세스 종료 시 정리 (강화된 버전)
process.on('SIGTERM', async () => {
  logger.info('[NaverCafeWorker] SIGTERM received');
  await stop();
});

process.on('SIGINT', async () => {
  logger.info('[NaverCafeWorker] SIGINT received');
  await stop();
});

// 예상치 못한 종료 처리
process.on('uncaughtException', async (error) => {
  logger.error('[NaverCafeWorker] Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  await stop();
  process.exit(1);
});

// 예상치 못한 종료 처리
process.on('unhandledRejection', async (reason, promise) => {
  logger.error('[NaverCafeWorker] Unhandled rejection', {
    reason: String(reason),
    promise
  });
  // unhandledRejection은 프로세스를 종료하지 않고 로그만 남김
  // (일부 Promise rejection은 복구 가능할 수 있음)
});

// 시작
start().catch(err => {
  logger.error('[NaverCafeWorker] Startup failed', { error: err.message });
  process.exit(1);
});

