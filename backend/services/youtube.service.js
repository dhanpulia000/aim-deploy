// YouTube Data API v3 서비스
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');
const logger = require('../utils/logger');
const { recordQuotaUsage } = require('./youtubeQuotaTracker');
const { query, queryOne, execute } = require('../libs/db');
const { getWeeklyPeriod, getMonthWeekLabel } = require('../utils/periodUtils');

/** KST 기준 YYYY-MM-DD */
function toKstDateOnly(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(iso));
}

/**
 * 유튜브 URL에서 채널 ID 추출
 * @param {string} url - 유튜브 URL
 * @returns {string|null} 채널 ID 또는 커스텀 URL 식별자
 */
function extractChannelIdFromUrl(url) {
  if (!url) return null;
  
  try {
    // 채널 URL 형식들:
    // https://www.youtube.com/channel/UCxxxxx
    // https://www.youtube.com/@channelname
    // https://www.youtube.com/c/channelname
    // https://www.youtube.com/user/channelname
    // https://www.youtube.com/channelname (직접 채널명)
    
    // 정식 채널 ID 형식 (UC로 시작)
    const channelIdMatch = url.match(/\/channel\/([a-zA-Z0-9_-]+)/);
    if (channelIdMatch) {
      const id = channelIdMatch[1];
      // UC로 시작하는 경우 정식 채널 ID
      if (id.startsWith('UC')) {
        return id;
      }
    }
    
    // 커스텀 URL의 경우 (@username, /c/username, /user/username)
    // URL 디코딩 처리
    let decodedUrl = decodeURIComponent(url);
    
    // @username, /c/username, /user/username 형식
    const customMatch = decodedUrl.match(/youtube\.com\/(?:@|c\/|user\/)([a-zA-Z0-9가-힣_-]+)/);
    if (customMatch) {
      let customId = customMatch[1];
      // @ 기호 제거
      customId = customId.replace(/^@/, '');
      // /shorts, /videos 등 경로 제거
      customId = customId.split('/')[0];
      return customId;
    }
    
    // 직접 채널명 형식: https://www.youtube.com/channelname
    // (예: https://www.youtube.com/군림보)
    const directNameMatch = decodedUrl.match(/youtube\.com\/([a-zA-Z0-9가-힣_-]+)(?:\/|$|\?|#)/);
    if (directNameMatch) {
      const directName = directNameMatch[1];
      // 'channel', 'c', 'user', 'watch', 'playlist' 등은 제외 (일반 경로)
      if (!['channel', 'c', 'user', 'watch', 'playlist', 'shorts', 'feed', 'gaming', 'music', 'sports', 'news', 'learning'].includes(directName.toLowerCase())) {
        return directName;
      }
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to extract channel ID from URL', { url, error: error.message });
    return null;
  }
}

/**
 * 커스텀 채널명으로 채널 ID 조회 (search.list 사용 안 함 - 할당량 절약)
 * @param {Object} youtube - YouTube API 클라이언트
 * @param {string} channelName - 채널명 또는 커스텀 URL (예: @seongjang2005)
 * @returns {Promise<string|null>} 채널 ID (찾을 수 없으면 null)
 */
async function getChannelIdByName(youtube, channelName) {
  try {
    // @ 기호 제거 및 URL 디코딩
    let cleanName = channelName.replace(/^@/, '').trim();
    
    // URL 인코딩된 한글 처리
    try {
      cleanName = decodeURIComponent(cleanName);
    } catch (e) {
      // 디코딩 실패 시 원본 사용
    }
    
    logger.debug('Searching channel by name (forHandle/forUsername, no search.list)', { originalName: channelName, cleanName });
    
    // 할당량 절약: channels.list의 forHandle 또는 forUsername 파라미터만 사용 (1 unit만 소비)
    // search.list는 100 units를 소비하므로 사용하지 않음
    
    // 1. 최신 @username 형식 시도 (forHandle - 2023년부터 지원)
    try {
      const handleResponse = await youtube.channels.list({
        part: ['id'],
        forHandle: cleanName
      });
      
      if (handleResponse.data.items && handleResponse.data.items.length > 0) {
        const channelId = handleResponse.data.items[0].id;
        recordQuotaUsage(1); // channels.list: 1 unit
        logger.info('Found channel ID by forHandle', { 
          channelName: cleanName, 
          channelId
        });
        return channelId;
      }
    } catch (handleError) {
      // forHandle이 지원되지 않거나 실패한 경우 (일부 API 버전에서는 지원 안 함)
      logger.debug('forHandle not supported or failed, trying forUsername', { 
        channelName: cleanName,
        error: handleError.message 
      });
    }
    
    // 2. 오래된 채널명 형식 시도 (forUsername - deprecated이지만 일부 채널에서 작동)
    try {
      const usernameResponse = await youtube.channels.list({
        part: ['id'],
        forUsername: cleanName
      });
      
      if (usernameResponse.data.items && usernameResponse.data.items.length > 0) {
        const channelId = usernameResponse.data.items[0].id;
        recordQuotaUsage(1); // channels.list: 1 unit
        logger.info('Found channel ID by forUsername', { 
          channelName: cleanName, 
          channelId
        });
        return channelId;
      }
    } catch (usernameError) {
      // forUsername 실패
      logger.debug('forUsername failed', { 
        channelName: cleanName,
        error: usernameError.message 
      });
    }
    
    // search.list를 사용하지 않으므로 null 반환
    logger.warn('No channel found by forHandle/forUsername (search.list not used to save quota)', { channelName: cleanName });
    return null;
  } catch (error) {
    logger.error('Failed to get channel ID by name', { 
      channelName, 
      error: error.message,
      stack: error.stack 
    });
    return null;
  }
}

/**
 * 라이브 URL에서 플랫폼 정보 추출
 * @param {string} url - 라이브 방송 URL
 * @returns {string} 플랫폼명 (SOOP, 아프리카, 치지직, 트위치, 기타)
 */
function extractLivePlatform(url) {
  if (!url) return '기타';
  
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('sooplive.co.kr') || urlLower.includes('soop')) {
    return 'SOOP';
  } else if (urlLower.includes('afreecatv.com') || urlLower.includes('afreeca')) {
    return '아프리카';
  } else if (urlLower.includes('chzzk.naver.com') || urlLower.includes('chzzk')) {
    return '치지직';
  } else if (urlLower.includes('twitch.tv') || urlLower.includes('twitch')) {
    return '트위치';
  }
  
  return '기타';
}

/**
 * 배틀그라운드 관련 영상인지 확인
 * @param {Object} video - 영상 정보 (snippet 포함)
 * @returns {boolean} 배틀그라운드 관련 여부
 */
/**
 * OAuth2 클라이언트 생성 (자막 다운로드용)
 * @returns {Object|null} YouTube API OAuth2 클라이언트 또는 null
 */
function getYouTubeOAuthClient() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  
  if (!clientId || !clientSecret || !refreshToken) {
    return null; // OAuth2 설정이 없으면 null 반환
  }
  
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost' // 리다이렉트 URI (자막 다운로드에는 필요 없음)
  );
  
  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });
  
  return google.youtube({
    version: 'v3',
    auth: oauth2Client
  });
}

/**
 * 영상의 자막 다운로드 및 텍스트 추출 (캐싱 포함)
 * @param {string} videoId - 영상 ID
 * @param {string} preferredLanguage - 선호 언어 (기본값: 'ko', 'en')
 * @param {boolean} forceRefresh - 캐시 무시하고 강제 새로고침 (기본값: false)
 * @returns {Promise<string|null>} 자막 텍스트 또는 null
 */
async function getVideoCaptions(videoId, preferredLanguage = 'ko', forceRefresh = false) {
  try {
    // 1. 캐시에서 먼저 확인 (forceRefresh가 false인 경우)
    if (!forceRefresh) {
      const cached = queryOne(
        'SELECT * FROM YouTubeVideoCaptionCache WHERE videoId = ?',
        [videoId]
      );
      
      if (cached && cached.captionText) {
        logger.debug('자막 캐시에서 조회', { 
          videoId,
          cachedAt: cached.analyzedAt,
          textLength: cached.captionText.length
        });
        return cached.captionText;
      }
    }
    
    // 2. 캐시에 없거나 forceRefresh인 경우 API 호출
    const youtubeOAuth = getYouTubeOAuthClient();
    
    if (!youtubeOAuth) {
      logger.debug('OAuth2 클라이언트가 설정되지 않아 자막 분석을 건너뜁니다');
      return null;
    }
    
    // 자막 목록 조회
    recordQuotaUsage(50); // captions.list: 50 units
    const captionsResponse = await youtubeOAuth.captions.list({
      part: ['snippet'],
      videoId: videoId
    });
    
    if (!captionsResponse.data.items || captionsResponse.data.items.length === 0) {
      logger.debug('자막이 없는 영상', { videoId });
      
      // 자막이 없다는 정보도 캐시에 저장 (재시도 방지)
      const now = new Date().toISOString();
      const existing = queryOne(
        'SELECT videoId FROM YouTubeVideoCaptionCache WHERE videoId = ?',
        [videoId]
      );
      
      if (existing) {
        execute(
          'UPDATE YouTubeVideoCaptionCache SET captionText = ?, analyzedAt = ? WHERE videoId = ?',
          [null, now, videoId]
        );
      } else {
        execute(
          'INSERT INTO YouTubeVideoCaptionCache (id, videoId, captionText, isBattlegroundsRelated, analyzedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [`caption_${videoId}`, videoId, null, 0, now, now, now]
        );
      }
      
      return null;
    }
    
    // 선호 언어 자막 찾기 (한국어 우선, 없으면 영어)
    let captionId = null;
    const languages = [preferredLanguage, 'en', 'ko'];
    
    for (const lang of languages) {
      const caption = captionsResponse.data.items.find(
        item => item.snippet.language === lang || item.snippet.language.startsWith(lang)
      );
      if (caption) {
        captionId = caption.id;
        break;
      }
    }
    
    // 선호 언어가 없으면 첫 번째 자막 사용
    if (!captionId && captionsResponse.data.items.length > 0) {
      captionId = captionsResponse.data.items[0].id;
    }
    
    if (!captionId) {
      return null;
    }
    
    // 자막 다운로드 (텍스트 형식)
    recordQuotaUsage(50); // captions.download: 50 units
    const captionContent = await youtubeOAuth.captions.download({
      id: captionId,
      tfmt: 'srt' // SRT 형식으로 다운로드
    });
    
    // SRT 형식에서 텍스트만 추출 (타임스탬프 제거)
    const textContent = captionContent.data
      .replace(/\d+\n/g, '') // 번호 제거
      .replace(/\d{2}:\d{2}:\d{2},\d{3}\s-->\s\d{2}:\d{2}:\d{2},\d{3}\n/g, '') // 타임스탬프 제거
      .replace(/\n+/g, ' ') // 줄바꿈을 공백으로
      .trim();
    
    // 3. 캐시에 저장
    const now = new Date().toISOString();
    const existing = queryOne(
      'SELECT videoId FROM YouTubeVideoCaptionCache WHERE videoId = ?',
      [videoId]
    );
    
    if (existing) {
      execute(
        'UPDATE YouTubeVideoCaptionCache SET captionText = ?, analyzedAt = ?, updatedAt = ? WHERE videoId = ?',
        [textContent, now, now, videoId]
      );
    } else {
      execute(
        'INSERT INTO YouTubeVideoCaptionCache (id, videoId, captionText, isBattlegroundsRelated, analyzedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [`caption_${videoId}`, videoId, textContent, 0, now, now, now]
      );
    }
    
    logger.debug('자막 다운로드 완료 및 캐시 저장', { 
      videoId, 
      captionId,
      textLength: textContent.length,
      preview: textContent.substring(0, 100)
    });
    
    return textContent;
  } catch (error) {
    logger.warn('자막 다운로드 실패', { 
      videoId, 
      error: error.message,
      code: error.code
    });
    return null;
  }
}

/**
 * 배틀그라운드 관련 영상인지 확인 (자막 분석 포함)
 * @param {Object} video - 영상 정보 (snippet 포함)
 * @param {boolean} useCaptions - 자막 분석 사용 여부 (기본값: false, OAuth2 설정 시 자동 활성화)
 * @returns {Promise<boolean>} 배틀그라운드 관련 여부
 */
async function isBattlegroundsRelated(video, useCaptions = false) {
  const title = (video.snippet?.title || '').toLowerCase();
  const fullDescription = (video.snippet?.description || '').toLowerCase();
  const tags = (video.snippet?.tags || []).join(' ').toLowerCase();
  
  // 설명의 앞부분만 확인 (기본 템플릿 제외, 최대 500자)
  // 채널 기본 설명 템플릿이 뒷부분에 포함되어 오탐을 유발할 수 있음
  const description = fullDescription.substring(0, 500);
  
  // 제목과 설명을 우선 확인 (태그는 보조적으로만 사용)
  const titleAndDescription = `${title} ${description}`;
  
  // 배틀그라운드 관련 키워드 (배틀그라운드 전용 키워드만 포함)
  const battlegroundsKeywords = [
    // 게임명 키워드
    '배그', '배틀그라운드', 'pubg', 'battlegrounds',
    '배틀그라운드 모바일', 'pubg mobile', 'pubg: battlegrounds',
    '배틀그라운드 pc', 'pubg pc', 'pubg:new state',
    '배틀그라운드 뉴스테이트', 'new state',
    // 맵 이름 (배틀그라운드 전용)
    '에란겔', '미라마', '사녹', '비켄디', '타이고', '태이고', '데스턴', '카라킨', '파라모', '헤이븐', '리비에라',
    'erangel', 'miramar', 'sanhok', 'vikendi', 'taego', 'deston', 'karakin', 'paramo', 'haven', 'riviera',
    // 배틀그라운드 특화 용어 (다른 게임과 겹치지 않는 키워드만)
    '배그 패치', 'pubg patch', '배틀그라운드 패치',
    '배그 업데이트', 'pubg update', '배틀그라운드 업데이트',
    '배그 공지', 'pubg notice', '배틀그라운드 공지',
    '배그 이벤트', 'pubg event', '배틀그라운드 이벤트'
  ];
  
  // 키워드 매칭 함수
  const checkKeyword = (keyword, text) => {
    // 영문 키워드인 경우 단어 경계 고려 (정규식 사용)
    if (/^[a-z0-9\s:]+$/i.test(keyword)) {
      // 영문 키워드는 단어 경계로 매칭 (단, 공백이 포함된 경우는 그대로)
      if (keyword.includes(' ')) {
        // 공백이 포함된 키워드 (예: "pubg mobile", "new state")
        const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedKeyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
        return regex.test(text);
      } else {
        // 단일 영문 키워드 (예: "pubg", "battlegrounds")
        const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return regex.test(text);
      }
    } else {
      // 한글 키워드는 공백, 특수문자, 문자열 시작/끝으로 구분
      // 단, 한글은 단어 경계 개념이 없으므로 더 유연하게 처리
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 한글 키워드 앞뒤가 공백, 특수문자, 숫자, 영문이 아닌 경우도 매칭
      // 예: "태이고에서"에서 "태이고"는 매칭되어야 함
      // lookahead를 사용하여 "태이고에서" 같은 경우도 매칭되도록 개선
      const regex = new RegExp(`(^|[^\\w가-힣])${escapedKeyword}(?=[^\\w가-힣]|$)|^${escapedKeyword}`, 'i');
      return regex.test(text);
    }
  };
  
  // 1. 제목과 설명에서 먼저 확인 (우선순위 높음)
  const foundInTitleOrDescription = battlegroundsKeywords.some(keyword => 
    checkKeyword(keyword, titleAndDescription)
  );
  
  if (foundInTitleOrDescription) {
    return true;
  }
  
  // 2. 제목/설명에 키워드가 없을 때만 태그 확인
  // 태그에 배틀그라운드 관련 키워드가 있으면 배틀그라운드 영상으로 간주
  // (태그는 크리에이터가 직접 설정한 것이므로 신뢰도가 높음)
  const foundInTags = battlegroundsKeywords.some(keyword => 
    checkKeyword(keyword, tags)
  );
  
  if (foundInTags) {
    return true;
  }
  
  // 3. 자막 분석 (OAuth2 설정되어 있고 useCaptions가 true인 경우)
  // 제목/설명/태그에서 키워드를 찾지 못한 경우에만 자막 분석
  if (useCaptions || getYouTubeOAuthClient()) {
    const videoId = video.id?.videoId || video.id;
    if (videoId) {
      try {
        // 캐시에서 분석 결과 확인
        const cached = queryOne(
          'SELECT * FROM YouTubeVideoCaptionCache WHERE videoId = ?',
          [videoId]
        );
        
        // 캐시에 분석 결과가 있고 자막 텍스트가 있으면 사용
        // (자막이 없는 경우도 캐시에 저장되므로, captionText가 null이면 분석이 완료된 것으로 간주)
        if (cached && cached.analyzedAt) {
          logger.debug('자막 분석 결과 캐시에서 조회', { 
            videoId,
            isBattlegroundsRelated: cached.isBattlegroundsRelated === 1,
            hasCaption: !!cached.captionText,
            cachedAt: cached.analyzedAt
          });
          return cached.isBattlegroundsRelated === 1;
        }
        
        // 캐시에 없거나 분석 결과가 없으면 자막 다운로드 및 분석
        const captionText = await getVideoCaptions(videoId);
        
        if (captionText) {
          // 자막이 있는 경우 분석
          const foundInCaptions = battlegroundsKeywords.some(keyword => 
            checkKeyword(keyword, captionText.toLowerCase())
          );
          
          // 분석 결과를 캐시에 저장
          const now = new Date().toISOString();
          const existing = queryOne(
            'SELECT videoId FROM YouTubeVideoCaptionCache WHERE videoId = ?',
            [videoId]
          );
          
          if (existing) {
            execute(
              'UPDATE YouTubeVideoCaptionCache SET isBattlegroundsRelated = ?, analyzedAt = ?, updatedAt = ? WHERE videoId = ?',
              [foundInCaptions ? 1 : 0, now, now, videoId]
            );
          } else {
            execute(
              'INSERT INTO YouTubeVideoCaptionCache (id, videoId, captionText, isBattlegroundsRelated, analyzedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [`caption_${videoId}`, videoId, captionText, foundInCaptions ? 1 : 0, now, now, now]
            );
          }
          
          if (foundInCaptions) {
            logger.debug('자막 분석으로 배틀그라운드 관련 영상 확인', { 
              videoId,
              title: title.substring(0, 50)
            });
            return true;
          }
        } else {
          // 자막이 없는 경우도 캐시에 저장 (getVideoCaptions에서 이미 저장됨)
          // 하지만 분석 결과는 false로 설정
          const now = new Date().toISOString();
          const existing = queryOne(
            'SELECT videoId FROM YouTubeVideoCaptionCache WHERE videoId = ?',
            [videoId]
          );
          
          if (existing) {
            execute(
              'UPDATE YouTubeVideoCaptionCache SET isBattlegroundsRelated = ?, analyzedAt = ?, updatedAt = ? WHERE videoId = ?',
              [0, now, now, videoId]
            );
          } else {
            execute(
              'INSERT INTO YouTubeVideoCaptionCache (id, videoId, captionText, isBattlegroundsRelated, analyzedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [`caption_${videoId}`, videoId, null, 0, now, now, now]
            );
          }
        }
      } catch (error) {
        logger.warn('자막 분석 중 오류 발생', { 
          videoId, 
          error: error.message 
        });
      }
    }
  }
  
  return false;
}

/**
 * 영상 유형 분류 (타게임 제외)
 * @param {Object} video - 영상 정보 (snippet 포함)
 * @returns {string} 영상 유형
 */
function classifyVideoType(video) {
  const title = (video.snippet?.title || '').toLowerCase();
  const description = (video.snippet?.description || '').toLowerCase();
  const tags = (video.snippet?.tags || []).join(' ').toLowerCase();
  const fullText = `${title} ${description} ${tags}`;
  
  // 유료 키워드 (최우선)
  const paidKeywords = ['광고', 'ppl', '협찬', '스폰서', '지원받아 제작', 'sponsored', 'ad', 'advertisement'];
  if (paidKeywords.some(keyword => fullText.includes(keyword))) {
    return '유료';
  }
  
  // 이슈 정보 공유 키워드
  const issueKeywords = ['패치노트', '공지', '이벤트 안내', '업데이트', '이슈', '버그', '정보 공유', '공지사항', '업데이트', 'patch', 'update', 'notice'];
  if (issueKeywords.some(keyword => fullText.includes(keyword))) {
    return '이슈 정보 공유';
  }
  
  // 게임 플레이 키워드
  const gameplayKeywords = ['#배그', '#배틀그라운드', 'pubg', '게임 플레이', 'gameplay', '랭크', '솔로', '듀오', '스쿼드', 'rank', 'solo', 'duo', 'squad', '배틀그라운드'];
  if (gameplayKeywords.some(keyword => fullText.includes(keyword))) {
    return '게임 플레이';
  }
  
  // 게임 외 영상 키워드
  const otherKeywords = ['브이로그', 'vlog', '일상', '토크', 'talk', 'q&a', 'qa', '인터뷰', 'interview', '잡담', 'chat'];
  if (otherKeywords.some(keyword => fullText.includes(keyword))) {
    return '게임 외 영상';
  }
  
  // 기본값: 게임 플레이로 분류
  return '게임 플레이';
}

/**
 * YouTube API 클라이언트 초기화
 * @param {string} apiKey - YouTube Data API v3 API 키
 * @returns {Object} YouTube API 클라이언트
 */
function getYouTubeClient(apiKey) {
  if (!apiKey) {
    throw new Error('YouTube API key is required');
  }
  
  return google.youtube({
    version: 'v3',
    auth: apiKey
  });
}

/**
 * 채널 ID로 채널 정보 조회
 * @param {Object} youtube - YouTube API 클라이언트
 * @param {string} channelId - 채널 ID
 * @returns {Promise<Object>} 채널 정보
 */
async function getChannelInfo(youtube, channelId) {
  try {
    const response = await youtube.channels.list({
      part: ['snippet', 'statistics'],
      id: [channelId]
    });
    
    recordQuotaUsage(1); // channels.list: 1 unit
    
    if (response.data.items && response.data.items.length > 0) {
      return response.data.items[0];
    }
    throw new Error(`Channel not found: ${channelId}`);
  } catch (error) {
    logger.error('Failed to get channel info', { error: error.message, channelId });
    throw error;
  }
}

/**
 * 채널의 주간 영상 목록 조회 (할당량 최적화: playlistItems.list 사용, 1 unit만 소비)
 * @param {Object} youtube - YouTube API 클라이언트
 * @param {string} channelId - 채널 ID (UC로 시작)
 * @param {string} startDate - 시작 날짜 (ISO 8601)
 * @param {string} endDate - 종료 날짜 (ISO 8601)
 * @returns {Promise<Array>} 영상 목록
 */
async function getWeeklyVideos(youtube, channelId, startDate, endDate) {
  try {
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    
    logger.info('Fetching weekly videos', { channelId, startDate, endDate });
    
    // 채널 ID가 UC로 시작하는 경우 playlistItems.list 사용 (1 unit만 소비)
    // 채널의 "업로드" 플레이리스트 ID는 UU{channelId.substring(2)} 형식
    if (channelId && channelId.startsWith('UC')) {
      try {
        const uploadsPlaylistId = `UU${channelId.substring(2)}`;
        const videos = [];
        let nextPageToken = null;
        let hasMore = true;
        let pageCount = 0;
        const MAX_PAGES = 20; // 최대 20페이지 (1000개 영상)로 제한
        
        // playlistItems.list는 1 unit만 소비하므로 더 많이 가져올 수 있음
        while (hasMore && pageCount < MAX_PAGES) {
          const response = await youtube.playlistItems.list({
            part: ['snippet', 'contentDetails'],
            playlistId: uploadsPlaylistId,
            maxResults: 50,
            pageToken: nextPageToken
          });
          
          recordQuotaUsage(1); // playlistItems.list: 1 unit per page
          
          if (response.data.items) {
            // 날짜 필터링 (클라이언트 측에서 수행)
            for (const item of response.data.items) {
              const publishedAt = item.snippet?.publishedAt;
              if (publishedAt) {
                const videoDate = new Date(publishedAt);
                // 날짜 비교: startDate <= videoDate <= endDate
                // 타임존 문제 방지를 위해 타임스탬프로 비교
                const videoTime = videoDate.getTime();
                const startTime = startDateObj.getTime();
                const endTime = endDateObj.getTime();
                
                if (videoTime >= startTime && videoTime <= endTime) {
                  // search.list 형식과 동일하게 변환
                  videos.push({
                    id: { videoId: item.contentDetails?.videoId || item.snippet?.resourceId?.videoId },
                    snippet: item.snippet
                  });
                } else if (videoTime < startTime) {
                  // 날짜가 시작일보다 이전이면 더 이상 조회할 필요 없음 (최신순이므로)
                  hasMore = false;
                  break;
                }
              }
            }
          }
          
          nextPageToken = response.data.nextPageToken;
          hasMore = !!nextPageToken && hasMore;
          pageCount++;
          
          // API 할당량 고려하여 약간의 지연 (playlistItems.list는 1 unit만 소비하므로 지연 최소화)
          if (hasMore && pageCount < MAX_PAGES) {
            await new Promise(resolve => setTimeout(resolve, 50)); // 100ms → 50ms로 감소
          }
        }
        
        if (pageCount >= MAX_PAGES) {
          logger.warn('Reached max pages limit for channel', { 
            channelId, 
            videoCount: videos.length,
            maxPages: MAX_PAGES
          });
        }
        
        logger.info('Fetched videos count using playlistItems', { 
          count: videos.length, 
          channelId, 
          pages: pageCount,
          startDate: startDate,
          endDate: endDate,
          filteredFrom: pageCount * 50 // 대략적인 전체 조회 영상 수
        });
        return videos;
      } catch (playlistError) {
        // playlistItems.list 실패 시 빈 배열 반환 (search.list 사용 안 함)
        logger.warn('playlistItems.list failed, returning empty array (search.list not used)', { 
          channelId, 
          error: playlistError.message 
        });
      }
    }
    
    // search.list는 사용하지 않음 (할당량 절약)
    // 채널 ID가 UC로 시작하지 않거나 playlistItems 실패 시 빈 배열 반환
    logger.warn('Cannot use playlistItems.list (channelId must start with UC), returning empty array', { channelId });
    return [];
  } catch (error) {
    logger.error('Failed to get weekly videos', { error: error.message, channelId });
    throw error;
  }
}

/**
 * 영상 상세 정보 조회 (조회수, 좋아요 등)
 * @param {Object} youtube - YouTube API 클라이언트
 * @param {Array<string>} videoIds - 영상 ID 배열
 * @returns {Promise<Array>} 영상 상세 정보
 */
async function getVideoDetails(youtube, videoIds) {
  try {
    const allDetails = [];
    
    // YouTube API는 한 번에 최대 50개까지 조회 가능
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      
      const response = await youtube.videos.list({
        part: ['snippet', 'statistics'],
        id: batch
      });
      
      recordQuotaUsage(1); // videos.list: 1 unit per batch (max 50 videos)
      
      if (response.data.items) {
        allDetails.push(...response.data.items);
      }
      
      // API 할당량 고려하여 약간의 지연 (videos.list는 1 unit만 소비하므로 지연 최소화)
      if (i + 50 < videoIds.length) {
        await new Promise(resolve => setTimeout(resolve, 50)); // 100ms → 50ms로 감소
      }
    }
    
    return allDetails;
  } catch (error) {
    logger.error('Failed to get video details', { error: error.message });
    throw error;
  }
}

/**
 * 엑셀 파일에서 채널 리스트 읽기
 * @param {string} filePath - 엑셀 파일 경로
 * @returns {Promise<Array>} 채널 리스트 [{ channelName, youtubeUrl, liveUrl }]
 */
async function readChannelListFromExcel(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // 첫 번째 행은 헤더로 간주
    const headers = data[0] || [];
    const channelNameIndex = headers.findIndex(h => 
      ['채널명', 'channelname', 'channel name', '채널', 'name'].includes(String(h).toLowerCase())
    );
    const youtubeUrlIndex = headers.findIndex(h => 
      ['유튜브 url', 'youtube url', 'youtube', '유튜브', 'youtubeurl', 'url'].includes(String(h).toLowerCase())
    );
    const channelIdIndex = headers.findIndex(h => 
      ['채널 id', 'channel id', 'channelid', 'id'].includes(String(h).toLowerCase())
    );
    const liveUrlIndex = headers.findIndex(h => 
      ['라이브 url', 'live url', 'live', '라이브', 'liveurl', '라이브 방송 url'].includes(String(h).toLowerCase())
    );
    
    if (channelNameIndex === -1 || (youtubeUrlIndex === -1 && channelIdIndex === -1)) {
      throw new Error('엑셀 파일에 필수 컬럼(채널명, 유튜브 URL 또는 채널 ID)이 없습니다.');
    }
    
    const channels = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const channelName = row[channelNameIndex];
      const youtubeUrl = youtubeUrlIndex !== -1 ? row[youtubeUrlIndex] : '';
      const channelId = channelIdIndex !== -1 ? row[channelIdIndex] : '';
      const liveUrl = liveUrlIndex !== -1 ? row[liveUrlIndex] : '';
      
      if (channelName && (youtubeUrl || channelId)) {
        channels.push({
          channelName: String(channelName).trim(),
          youtubeUrl: youtubeUrl ? String(youtubeUrl).trim() : '',
          channelId: channelId ? String(channelId).trim() : null,
          liveUrl: liveUrl ? String(liveUrl).trim() : ''
        });
      }
    }
    
    logger.info('Channels loaded from Excel', { count: channels.length, filePath });
    return channels;
  } catch (error) {
    logger.error('Failed to read channel list from Excel', { error: error.message, filePath });
    throw error;
  }
}

/**
 * 영상 메타데이터를 CSV 형식으로 변환
 * @param {Array} videoDetails - 영상 상세 정보 배열 (getVideoDetails 반환값)
 * @returns {string} CSV 내용
 */
function convertToCSV(videoDetails) {
  const headers = [
    '업로드 날짜',
    '영상 제목',
    '영상 주소',
    '뷰어쉽 수',
    '좋아요 수',
    '코멘트 수',
    '영상 유형'
  ];
  
  // CSV 이스케이프 함수
  const escapeCSV = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  
  // 헤더 행
  const rows = [headers.map(escapeCSV).join(',')];
  
  // 데이터 행 생성
  for (const video of videoDetails) {
    const videoId = video.id;
    const title = video.snippet?.title || '';
    const publishedAt = video.snippet?.publishedAt || '';
    const viewCount = video.statistics?.viewCount || '0';
    const likeCount = video.statistics?.likeCount || '0';
    const commentCount = video.statistics?.commentCount || '0';
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const videoType = classifyVideoType(video);
    
    const date = publishedAt ? toKstDateOnly(publishedAt) : '';
    
    const row = [
      date,
      title,
      url,
      viewCount,
      likeCount,
      commentCount,
      videoType
    ];
    
    rows.push(row.map(escapeCSV).join(','));
  }
  
  return rows.join('\n');
}

/**
 * 영상 데이터를 행으로 변환하는 헬퍼 함수
 * @param {Array} videoData - 영상 데이터 배열 [{ video, channelName, liveUrl, weekNumber, period }]
 * @returns {Array} 행 배열
 */
function convertVideoDataToRows(videoData) {
  return videoData.map(item => {
    const { video, channelName, liveUrl, weekNumber, period } = item;
    const videoId = video.id;
    const title = video.snippet?.title || '';
    const publishedAt = video.snippet?.publishedAt || '';
    const viewCount = video.statistics?.viewCount || '0';
    const likeCount = video.statistics?.likeCount || '0';
    const commentCount = video.statistics?.commentCount || '0';
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const videoType = classifyVideoType(video);
    const livePlatform = extractLivePlatform(liveUrl);
    
    const date = publishedAt ? toKstDateOnly(publishedAt) : '';
    const weekLabel =
      period.yearMonthWeekLabel ||
      `${period.year}년 ${getMonthWeekLabel(period) || `${weekNumber}주차`}`;

    return [
      weekLabel,
      channelName,
      livePlatform,
      '유튜브',
      date,
      title,
      'LINK',
      viewCount,
      likeCount,
      commentCount,
      videoType
    ];
  });
}

/**
 * 워크시트에 하이퍼링크 스타일 적용
 * @param {Object} worksheet - XLSX 워크시트 객체
 * @param {number} urlColIndex - URL 컬럼 인덱스
 * @param {Array} videoData - 영상 데이터 배열 (URL 추출용)
 */
function applyHyperlinkStyle(worksheet, urlColIndex, videoData = null) {
  const range = XLSX.utils.decode_range(worksheet['!ref']);
  
  // 각 행의 URL 셀에 하이퍼링크 설정
  for (let row = 1; row <= range.e.r; row++) { // 헤더 제외 (row 1부터)
    const cellAddress = XLSX.utils.encode_cell({ r: row, c: urlColIndex });
    if (worksheet[cellAddress]) {
      let url;
      
      // videoData가 제공된 경우 실제 URL 추출
      if (videoData && videoData[row - 1]) {
        const video = videoData[row - 1].video;
        const videoId = video.id;
        url = `https://www.youtube.com/watch?v=${videoId}`;
      } else {
        // 기존 방식 (셀 값에서 URL 추출 시도)
        const cellValue = worksheet[cellAddress].v;
        // LINK(구 [링크]) 텍스트인 경우 videoData에서 찾기
        if ((cellValue === 'LINK' || cellValue === '[링크]') && videoData && videoData[row - 1]) {
          const video = videoData[row - 1].video;
          const videoId = video.id;
          url = `https://www.youtube.com/watch?v=${videoId}`;
        } else {
          url = cellValue; // 기존 URL 그대로 사용
        }
      }
      
      if (url) {
        worksheet[cellAddress].v = 'LINK';
        worksheet[cellAddress].l = { Target: url, Tooltip: url };
        worksheet[cellAddress].s = {
          font: { color: { rgb: '0563C1' }, underline: true },
          alignment: { horizontal: 'left', vertical: 'center' }
        };
      }
    }
  }
}

/**
 * 영상 메타데이터를 통합 XLSX 형식으로 변환 (하이퍼링크 포함, 배틀그라운드 관련/그 외 시트 분리)
 * @param {Array} videoData - 영상 데이터 배열 [{ video, channelName, liveUrl, weekNumber, period }]
 * @returns {Promise<Object>} XLSX 워크북 객체 (배틀그라운드 관련, 그 외 두 개의 시트 포함)
 */
async function convertToIntegratedXLSX(videoData) {
  const headers = [
    'N주차',
    '파트너명',
    '라이브 플랫폼',
    '영상 플랫폼',
    '업로드 날짜',
    '영상 제목',
    '영상 주소',
    '뷰어쉽 수',
    '좋아요 수',
    '코멘트 수',
    '영상 유형'
  ];
  
  // 배틀그라운드 관련 영상과 그 외 영상으로 분리
  // 자막 분석은 할당량이 많이 소비되므로 기본적으로 사용하지 않음
  const battlegroundsVideos = [];
  const otherVideos = [];
  
  for (const item of videoData) {
    // 기본적으로 자막 분석 없이 분류 (할당량 절약)
    const isBG = await isBattlegroundsRelated(item.video, false);
    if (isBG) {
      battlegroundsVideos.push(item);
    } else {
      otherVideos.push(item);
    }
  }
  
  // 컬럼 너비 설정
  const colWidths = [
    { wch: 15 }, // N주차
    { wch: 20 }, // 파트너명
    { wch: 15 }, // 라이브 플랫폼
    { wch: 12 }, // 영상 플랫폼
    { wch: 20 }, // 업로드 날짜
    { wch: 50 }, // 영상 제목
    { wch: 40 }, // 영상 주소
    { wch: 12 }, // 뷰어쉽 수
    { wch: 12 }, // 좋아요 수
    { wch: 12 }, // 코멘트 수
    { wch: 15 }  // 영상 유형
  ];
  
  const workbook = XLSX.utils.book_new();
  const urlColIndex = 6; // '영상 주소' 컬럼 (0-based)
  
  // 배틀그라운드 관련 영상 시트 생성 (항상 생성)
  const bgRows = battlegroundsVideos.length > 0 
    ? convertVideoDataToRows(battlegroundsVideos)
    : [];
  const bgWorksheet = XLSX.utils.aoa_to_sheet([headers, ...bgRows]);
  bgWorksheet['!cols'] = colWidths;
  if (battlegroundsVideos.length > 0) {
    applyHyperlinkStyle(bgWorksheet, urlColIndex, battlegroundsVideos);
  }
  XLSX.utils.book_append_sheet(workbook, bgWorksheet, '배틀그라운드 관련');
  
  // 그 외 영상 시트 생성 (항상 생성)
  const otherRows = otherVideos.length > 0
    ? convertVideoDataToRows(otherVideos)
    : [];
  const otherWorksheet = XLSX.utils.aoa_to_sheet([headers, ...otherRows]);
  otherWorksheet['!cols'] = colWidths;
  if (otherVideos.length > 0) {
    applyHyperlinkStyle(otherWorksheet, urlColIndex, otherVideos);
  }
  XLSX.utils.book_append_sheet(workbook, otherWorksheet, '그 외 영상');
  
  return workbook;
}

/**
 * 주간 영상 메타데이터 수집 및 CSV 저장
 * @param {string} apiKey - YouTube Data API v3 API 키
 * @param {string} channelId - 채널 ID
 * @param {Date} date - 기준 날짜 (기본값: 현재 날짜)
 * @returns {Promise<Object>} { csvPath, videoCount, period }
 */
async function collectWeeklyVideoMetadata(apiKey, channelId, date = new Date()) {
  try {
    // 주간 기간 계산
    const period = getWeeklyPeriod(date);
    logger.info('Weekly period calculated', period);
    
    // YouTube API 클라이언트 초기화
    const youtube = getYouTubeClient(apiKey);
    
    // 채널 정보 조회
    const channelInfo = await getChannelInfo(youtube, channelId);
    const channelName = channelInfo.snippet?.title || channelId;
    logger.info('Channel info retrieved', { channelName, channelId });
    
    // 주간 영상 목록 조회
    const videoList = await getWeeklyVideos(youtube, channelId, period.startDate, period.endDate);
    
    if (videoList.length === 0) {
      logger.info('No videos found in the weekly period', { channelId, period });
      return {
        csvPath: null,
        videoCount: 0,
        period,
        channelName,
        message: '주간 기간 동안 업로드된 영상이 없습니다.'
      };
    }
    
    // 배틀그라운드 관련 영상만 필터링
    // 기본적으로 자막 분석 없이 분류 (할당량 절약)
    const battlegroundsVideos = [];
    for (const video of videoList) {
      if (video.snippet) {
        const isBG = await isBattlegroundsRelated(video, false);
        if (isBG) {
          battlegroundsVideos.push(video);
        }
      }
    }
    
    if (battlegroundsVideos.length === 0) {
      logger.info('No battlegrounds-related videos found in the weekly period', { channelId, period, totalVideos: videoList.length });
      return {
        csvPath: null,
        videoCount: 0,
        period,
        channelName,
        message: '주간 기간 동안 배틀그라운드 관련 영상이 없습니다.'
      };
    }
    
    // 영상 ID 추출
    const videoIds = battlegroundsVideos
      .map(video => video.id?.videoId || video.id)
      .filter(id => id); // null/undefined 제거
    
    // 영상 상세 정보 조회
    const videoDetails = await getVideoDetails(youtube, videoIds);
    
    // 상세 정보를 가져온 후에도 배틀그라운드 관련 영상만 필터링
    // 기본적으로 자막 분석 없이 분류 (할당량 절약)
    const filteredVideoDetails = [];
    for (const video of videoDetails) {
      const isBG = await isBattlegroundsRelated(video, false);
      if (isBG) {
        filteredVideoDetails.push(video);
      }
    }
    
    // CSV 변환
    const csvContent = convertToCSV(filteredVideoDetails);
    
    // 파일 저장
    const uploadsDir = path.join(__dirname, '../uploads/youtube');
    await fs.mkdir(uploadsDir, { recursive: true });
    
    const filename = `youtube_${channelId}_${period.startDateFormatted}_${period.endDateFormatted}.csv`;
    const filePath = path.join(uploadsDir, filename);
    await fs.writeFile(filePath, '\uFEFF' + csvContent, 'utf8'); // BOM 추가 (Excel 호환성)
    
    logger.info('CSV file created', { filePath, videoCount: filteredVideoDetails.length, totalVideos: videoList.length });
    
    return {
      csvPath: `/uploads/youtube/${filename}`,
      videoCount: filteredVideoDetails.length,
      period,
      channelName,
      channelId
    };
  } catch (error) {
    logger.error('Failed to collect weekly video metadata', { error: error.message, channelId });
    throw error;
  }
}

/**
 * 엑셀 파일 기반 다중 채널 주간 영상 메타데이터 수집
 * @param {string} apiKey - YouTube Data API v3 API 키
 * @param {string} excelFilePath - 엑셀 파일 경로
 * @param {Date} date - 기준 날짜 (기본값: 현재 날짜)
 * @returns {Promise<Object>} { csvPath, totalVideoCount, channelCount, period }
 */
async function collectMultiChannelWeeklyMetadata(apiKey, excelFilePath, date = new Date()) {
  try {
    // 주간 기간 계산
    const period = getWeeklyPeriod(date);
    logger.info('Weekly period calculated', period);
    
    // 엑셀에서 채널 리스트 읽기
    const channels = await readChannelListFromExcel(excelFilePath);
    
    if (channels.length === 0) {
      throw new Error('엑셀 파일에 채널 정보가 없습니다.');
    }
    
    // YouTube API 클라이언트 초기화
    const youtube = getYouTubeClient(apiKey);
    
    const allVideoData = [];
    let successCount = 0;
    let errorCount = 0;
    const errorDetails = []; // 오류 상세 정보 저장
    
    // 각 채널에 대해 영상 수집
    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      logger.info(`Processing channel ${i + 1}/${channels.length}`, { channelName: channel.channelName, youtubeUrl: channel.youtubeUrl });
      
      try {
        // 채널 ID 추출 (엑셀에 직접 입력된 채널 ID 우선 사용)
        let channelId = channel.channelId || null;
        
        // 채널 ID가 없으면 URL에서 추출 시도
        if (!channelId && channel.youtubeUrl) {
          channelId = extractChannelIdFromUrl(channel.youtubeUrl);
          logger.debug('Extracted channel ID from URL', { channelName: channel.channelName, channelId, youtubeUrl: channel.youtubeUrl });
        }
        
        // UC로 시작하지 않으면 커스텀 URL 식별자일 수 있으므로 실제 채널 ID 조회 시도
        if (channelId && !channelId.startsWith('UC')) {
          logger.info('Extracted value is not UC format, trying to resolve channel ID by name', { 
            channelName: channel.channelName, 
            extractedValue: channelId,
            youtubeUrl: channel.youtubeUrl
          });
          const resolvedChannelId = await getChannelIdByName(youtube, channelId);
          if (resolvedChannelId) {
            channelId = resolvedChannelId;
            logger.info('Successfully resolved channel ID from custom URL', { 
              channelName: channel.channelName, 
              originalValue: channel.channelId || extractChannelIdFromUrl(channel.youtubeUrl),
              resolvedChannelId: channelId
            });
          } else {
            const errorMsg = `채널 ID를 찾을 수 없습니다: ${channel.channelName} (URL: ${channel.youtubeUrl || '없음'}). UC로 시작하는 정식 채널 ID를 엑셀의 channelId 컬럼에 직접 입력해주세요.`;
            logger.warn('Failed to resolve channel ID from custom URL', { 
              channelName: channel.channelName, 
              extractedValue: channelId,
              youtubeUrl: channel.youtubeUrl
            });
            errorDetails.push({ channelName: channel.channelName, error: errorMsg });
            errorCount++;
            continue;
          }
        }
        
        // 정식 채널 ID(UC로 시작) 검증
        if (!channelId) {
          const errorMsg = `채널 ID가 없습니다: ${channel.channelName} (URL: ${channel.youtubeUrl || '없음'})`;
          logger.warn('Channel ID missing', { 
            channelName: channel.channelName, 
            youtubeUrl: channel.youtubeUrl
          });
          errorDetails.push({ channelName: channel.channelName, error: errorMsg });
          errorCount++;
          continue;
        }
        
        // UC로 시작하지 않으면 에러 처리
        if (!channelId.startsWith('UC')) {
          const errorMsg = `잘못된 채널 ID 형식입니다: ${channel.channelName} (ID: ${channelId}). UC로 시작하는 정식 채널 ID를 입력해주세요.`;
          logger.warn('Invalid channel ID format (must start with UC)', { 
            channelName: channel.channelName, 
            channelId: channelId,
            youtubeUrl: channel.youtubeUrl
          });
          errorDetails.push({ channelName: channel.channelName, error: errorMsg });
          errorCount++;
          continue;
        }
        
        logger.info('Using channel ID from Excel/URL', { channelName: channel.channelName, channelId });
        
        // 채널 정보 확인 (유효한 채널인지 검증)
        try {
          await getChannelInfo(youtube, channelId);
        } catch (channelError) {
          const errorMsg = `채널 정보를 조회할 수 없습니다: ${channel.channelName} (ID: ${channelId}) - ${channelError.message}`;
          logger.error('Channel info check failed', { channelName: channel.channelName, channelId, error: channelError.message });
          errorDetails.push({ channelName: channel.channelName, error: errorMsg });
          errorCount++;
          continue;
        }
        
        // 주간 영상 목록 조회
        const videoList = await getWeeklyVideos(youtube, channelId, period.startDate, period.endDate);
        
        if (videoList.length === 0) {
          logger.info('No videos found for channel', { channelName: channel.channelName, channelId });
          // 영상이 없는 것은 오류가 아님
          continue;
        }
        
        // 모든 영상의 ID 추출 (배틀그라운드 필터링 제거)
        const videoIds = videoList
          .map(video => video.id?.videoId || video.id)
          .filter(id => id); // null/undefined 제거
        
        if (videoIds.length === 0) {
          logger.warn('No valid video IDs found', { channelName: channel.channelName, channelId });
          continue;
        }
        
        // 영상 상세 정보 조회
        const videoDetails = await getVideoDetails(youtube, videoIds);
        
        // 모든 영상에 채널 정보 추가 (배틀그라운드 필터링 제거)
        videoDetails.forEach(video => {
          allVideoData.push({
            video,
            channelName: channel.channelName,
            liveUrl: channel.liveUrl,
            weekNumber: period.weekNumber,
            period
          });
        });
        
        logger.info('Collected all videos for channel', { 
          channelName: channel.channelName,
          totalVideos: videoList.length,
          collectedVideos: videoDetails.length
        });
        
        successCount++;
        logger.info('Channel processed successfully', { channelName: channel.channelName, videoCount: videoDetails.length });
        
        // API 할당량 고려하여 지연
        if (i < channels.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        const errorMsg = `채널 처리 중 오류 발생: ${channel.channelName} - ${error.message}`;
        logger.error('Failed to process channel', { 
          channelName: channel.channelName,
          youtubeUrl: channel.youtubeUrl,
          error: error.message,
          stack: error.stack
        });
        errorDetails.push({ channelName: channel.channelName, error: errorMsg });
        errorCount++;
      }
    }
    
    // 배틀그라운드 관련 영상과 그 외 영상 수 계산
    // 기본적으로 자막 분석 없이 분류 (할당량 절약)
    let battlegroundsCount = 0;
    for (const item of allVideoData) {
      const isBG = await isBattlegroundsRelated(item.video, false);
      if (isBG) {
        battlegroundsCount++;
      }
    }
    const otherVideosCount = allVideoData.length - battlegroundsCount;
    
    if (allVideoData.length === 0) {
      return {
        csvPath: null,
        xlsxPath: null,
        totalVideoCount: 0,
        battlegroundsCount: 0,
        otherVideosCount: 0,
        channelCount: successCount,
        errorCount,
        errorDetails: errorDetails.slice(0, 20), // 최대 20개 오류만 반환
        period,
        message: '주간 기간 동안 업로드된 영상이 없습니다.'
      };
    }
    
    // XLSX 변환 (하이퍼링크 포함, 배틀그라운드 관련/그 외 시트 분리)
    const workbook = await convertToIntegratedXLSX(allVideoData);
    
    // 파일 저장
    const uploadsDir = path.join(__dirname, '../uploads/youtube');
    await fs.mkdir(uploadsDir, { recursive: true });
    
    const filename = `youtube_weekly_${period.year}_${period.weekNumber}주차_${period.startDateFormatted}_${period.endDateFormatted}.xlsx`;
    const filePath = path.join(uploadsDir, filename);
    XLSX.writeFile(workbook, filePath);
    
    logger.info('XLSX file created', { 
      filePath, 
      totalVideoCount: allVideoData.length,
      battlegroundsCount,
      otherVideosCount,
      channelCount: successCount,
      errorCount
    });
    
    return {
      csvPath: `/uploads/youtube/${filename}`, // 경로는 csvPath로 유지 (하위 호환성)
      xlsxPath: `/uploads/youtube/${filename}`, // 명시적으로 xlsxPath 추가
      totalVideoCount: allVideoData.length,
      battlegroundsCount,
      otherVideosCount,
      channelCount: successCount,
      errorCount,
      errorDetails: errorDetails.slice(0, 20), // 최대 20개 오류만 반환
      period
    };
  } catch (error) {
    logger.error('Failed to collect multi-channel weekly metadata', { error: error.message });
    throw error;
  }
}

module.exports = {
  getWeeklyPeriod,
  collectWeeklyVideoMetadata,
  collectMultiChannelWeeklyMetadata,
  getChannelInfo,
  getChannelIdByName,
  getWeeklyVideos,
  getVideoDetails,
  readChannelListFromExcel,
  extractChannelIdFromUrl,
  extractLivePlatform,
  classifyVideoType,
  isBattlegroundsRelated
};

