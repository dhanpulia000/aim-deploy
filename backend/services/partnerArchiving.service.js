const fs = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');
const logger = require('../utils/logger');
const youtubeService = require('./youtube.service');
const tiktokService = require('./tiktok.service');
const instagramService = require('./instagram.service');
const { getWeeklyPeriod, getMonthWeekLabel } = require('../utils/periodUtils');

// 진행 상황 추적을 위한 메모리 저장소 (jobId -> 진행 상황)
const progressStore = new Map();

function normPlatform(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return 'youtube';
  if (v === 'youtube' || v === '유튜브' || v.includes('youtube')) return 'youtube';
  if (v === 'tiktok' || v === '틱톡' || v.includes('tiktok')) return 'tiktok';
  if (v === 'instagram' || v === '인스타' || v === '인스타그램' || v.includes('instagram')) return 'instagram';
  return 'youtube';
}

function safeString(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function extractTikTokInput(rowObj) {
  const tiktokUrl = safeString(rowObj.tiktokUrl || rowObj['틱톡 url'] || rowObj['틱톡'] || rowObj.tiktok || rowObj.url || '');
  const username = safeString(rowObj.username || rowObj['유저네임'] || rowObj['username'] || rowObj['@'] || '');
  return tiktokUrl || username;
}

/**
 * 엑셀 파일에서 파트너 리스트 읽기 (YouTube + TikTok 혼합)
 * - 첫 번째 시트 기준
 * - 필요 컬럼:
 *   - 채널명(파트너명): 필수
 *   - 플랫폼(선택): youtube/tiktok (없으면 youtube)
 *   - YouTube: 유튜브 URL 또는 채널 ID 중 하나
 *   - TikTok: 틱톡 URL 또는 username 중 하나
 *   - 라이브 URL(선택)
 */
async function readPartnerListFromExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  const headers = (data[0] || []).map(h => String(h || '').trim());
  const headerLower = headers.map(h => h.toLowerCase());

  const idx = (candidates) => headerLower.findIndex(h => candidates.includes(h));

  const channelNameIndex = idx(['채널명', 'channelname', 'channel name', '채널', 'name', '파트너명', 'partner', 'partnername']);
  const platformIndex = idx(['플랫폼', 'platform', 'source', '소스']);
  const youtubeUrlIndex = idx(['유튜브 url', 'youtube url', 'youtube', '유튜브', 'youtubeurl', 'url']);
  const channelIdIndex = idx(['채널 id', 'channel id', 'channelid', 'id']);
  const liveUrlIndex = idx(['라이브 url', 'live url', 'live', '라이브', 'liveurl', '라이브 방송 url']);
  const tiktokUrlIndex = idx(['틱톡 url', 'tiktok url', 'tiktok', '틱톡', 'tiktokurl']);
  const instagramUrlIndex = idx(['인스타그램 url', 'instagram url', 'instagram', '인스타', '인스타그램', 'instagramurl']);
  const usernameIndex = idx(['username', '유저네임', 'user name', 'handle', '@username', '@']);

  if (channelNameIndex === -1) {
    throw new Error('엑셀 파일에 필수 컬럼(채널명/파트너명)이 없습니다.');
  }

  const partners = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i] || [];
    const channelName = row[channelNameIndex];
    if (!channelName) continue;

    let platform = platformIndex !== -1 ? normPlatform(row[platformIndex]) : 'youtube';
    const youtubeUrl = youtubeUrlIndex !== -1 ? safeString(row[youtubeUrlIndex]) : '';
    const channelId = channelIdIndex !== -1 ? safeString(row[channelIdIndex]) : '';
    const liveUrl = liveUrlIndex !== -1 ? safeString(row[liveUrlIndex]) : '';
    const tiktokUrl = tiktokUrlIndex !== -1 ? safeString(row[tiktokUrlIndex]) : '';
    const instagramUrl = instagramUrlIndex !== -1 ? safeString(row[instagramUrlIndex]) : '';
    const username = usernameIndex !== -1 ? safeString(row[usernameIndex]) : '';

    // 플랫폼 컬럼이 비어 있으면 URL/username으로 자동 추론
    if (platform === 'youtube' && !youtubeUrl && !channelId) {
      if (tiktokUrl || (username && (username.startsWith('@') || /tiktok\.com/i.test(username)))) {
        platform = 'tiktok';
      } else if (instagramUrl || (username && /instagram\.com/i.test(String(username)))) {
        platform = 'instagram';
      }
    }

    partners.push({
      platform,
      channelName: safeString(channelName),
      youtubeUrl,
      channelId: channelId || null,
      liveUrl,
      tiktok: tiktokUrl || (platform === 'tiktok' ? username : '') || '',
      instagram: instagramUrl || (platform === 'instagram' ? username : '') || ''
    });
  }

  return partners;
}

/** 업로드일: KST 기준 YYYY-MM-DD */
function toKstDateOnly(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function buildVideoUrl(video) {
  // TikTok normalized url
  const norm = video && video._normalized;
  if (norm && typeof norm.url === 'string' && norm.url.trim()) return norm.url.trim();

  // YouTube
  const id = video && (video.id?.videoId || video.id);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  return '';
}

function videoPlatformLabel(video) {
  const p = video && video._normalized && video._normalized.platform;
  if (p === 'tiktok') return '틱톡';
  if (p === 'instagram') return '인스타그램';
  return '유튜브';
}

function convertItemsToRows(items) {
  return items.map(item => {
    const { video, channelName, username = '', liveUrl, period } = item;
    const title = video.snippet?.title || '';
    const publishedAt = video.snippet?.publishedAt || '';
    const viewCount = video.statistics?.viewCount || '0';
    const likeCount = video.statistics?.likeCount || '0';
    const commentCount = video.statistics?.commentCount || '0';
    const url = buildVideoUrl(video);
    const videoType = youtubeService.classifyVideoType(video);
    const livePlatform = youtubeService.extractLivePlatform(liveUrl);
    const weekLabel =
      period.yearMonthWeekLabel ||
      `${period.year}년 ${getMonthWeekLabel(period) || `${item.weekNumber}주차`}`;

    const date = publishedAt ? toKstDateOnly(publishedAt) : '';

    return [
      weekLabel,
      username,
      channelName,
      livePlatform,
      videoPlatformLabel(video),
      date,
      title,
      'LINK',
      viewCount,
      likeCount,
      commentCount,
      videoType,
      url // hidden helper field for hyperlink application
    ];
  });
}

function applyHyperlinks(worksheet, urlColIndex, rows, urlHelperIndex) {
  const range = XLSX.utils.decode_range(worksheet['!ref']);
  for (let row = 1; row <= range.e.r; row++) {
    const url = rows[row - 1] ? rows[row - 1][urlHelperIndex] : '';
    if (!url) continue;
    const cellAddress = XLSX.utils.encode_cell({ r: row, c: urlColIndex });
    if (!worksheet[cellAddress]) continue;

    worksheet[cellAddress].v = 'LINK';
    worksheet[cellAddress].l = { Target: url, Tooltip: url };
    worksheet[cellAddress].s = {
      font: { color: { rgb: '0563C1' }, underline: true },
      alignment: { horizontal: 'left', vertical: 'center' }
    };
  }
}

async function convertToIntegratedXlsx(items) {
  const headers = [
    'N주차',
    '유저 네임',
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

  const battlegrounds = [];
  const others = [];

  for (const item of items) {
    const isBG = await youtubeService.isBattlegroundsRelated(item.video, false);
    if (isBG) battlegrounds.push(item);
    else others.push(item);
  }

  const colWidths = [
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    { wch: 15 },
    { wch: 12 },
    { wch: 12 },
    { wch: 50 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 }
  ];

  const workbook = XLSX.utils.book_new();
  const urlColIndex = 7; // '영상 주소' (0-based)
  const urlHelperIndex = headers.length; // appended at end of row

  const bgRowsWithUrl = convertItemsToRows(battlegrounds);
  const bgRows = bgRowsWithUrl.map(r => r.slice(0, headers.length));
  const bgWs = XLSX.utils.aoa_to_sheet([headers, ...bgRows]);
  bgWs['!cols'] = colWidths;
  applyHyperlinks(bgWs, urlColIndex, bgRowsWithUrl, urlHelperIndex);
  XLSX.utils.book_append_sheet(workbook, bgWs, '배틀그라운드 관련');

  const otherRowsWithUrl = convertItemsToRows(others);
  const otherRows = otherRowsWithUrl.map(r => r.slice(0, headers.length));
  const otherWs = XLSX.utils.aoa_to_sheet([headers, ...otherRows]);
  otherWs['!cols'] = colWidths;
  applyHyperlinks(otherWs, urlColIndex, otherRowsWithUrl, urlHelperIndex);
  XLSX.utils.book_append_sheet(workbook, otherWs, '그 외 영상');

  return { workbook, battlegroundsCount: battlegrounds.length, otherVideosCount: others.length };
}

async function collectYouTubeWeeklyForPartner(youtube, partner, period) {
  // Resolve channelId similar to existing youtube multi-channel logic
  let channelId = partner.channelId || null;
  let extractedFromUrl = false;
  
  if (!channelId && partner.youtubeUrl) {
    channelId = youtubeService.extractChannelIdFromUrl(partner.youtubeUrl);
    extractedFromUrl = !!channelId;
  }

  // UC로 시작하지 않는 경우 (커스텀 URL, 채널명 등) 채널 ID 조회 시도
  if (channelId && !channelId.startsWith('UC')) {
    logger.info('Resolving channel ID from custom URL/name', { 
      channelName: partner.channelName, 
      extractedId: channelId 
    });
    const resolved = await youtubeService.getChannelIdByName(youtube, channelId);
    if (resolved) {
      channelId = resolved;
      logger.info('Channel ID resolved successfully', { 
        channelName: partner.channelName, 
        resolvedId: channelId 
      });
    }
  }

  if (!channelId || !channelId.startsWith('UC')) {
    const errorMsg = extractedFromUrl 
      ? `채널 URL에서 채널 ID를 찾을 수 없습니다. 정식 채널 ID(UC로 시작)를 직접 입력하거나 올바른 채널 URL을 확인해주세요. (channelName=${partner.channelName}, url=${partner.youtubeUrl || '없음'})`
      : `채널 ID가 없거나 잘못된 형식입니다. UC로 시작하는 정식 채널 ID를 입력하거나 채널 URL을 입력해주세요. (channelName=${partner.channelName})`;
    throw new Error(errorMsg);
  }

  await youtubeService.getChannelInfo(youtube, channelId); // validate
  const list = await youtubeService.getWeeklyVideos(youtube, channelId, period.startDate, period.endDate);
  if (!list || list.length === 0) return [];

  const videoIds = list.map(v => v.id?.videoId || v.id).filter(Boolean);
  if (videoIds.length === 0) return [];

  const details = await youtubeService.getVideoDetails(youtube, videoIds);
  details.forEach(v => {
    // Mark platform explicitly for XLSX
    v._normalized = { platform: 'youtube' };
  });

  return details.map(video => ({
    video,
    channelName: partner.channelName,
    username: '', // YouTube는 채널 ID 기반, 유저네임 별도 미수집
    liveUrl: partner.liveUrl || '',
    weekNumber: period.weekNumber,
    period
  }));
}

/**
 * 진행 상황 조회
 * @param {string} jobId
 * @returns {Object|null} 진행 상황 정보
 */
function getProgress(jobId) {
  return progressStore.get(jobId) || null;
}

/**
 * 진행 상황 업데이트
 * @param {string} jobId
 * @param {Object} progress
 */
function updateProgress(jobId, progress) {
  progressStore.set(jobId, {
    ...progress,
    updatedAt: new Date().toISOString()
  });
}

/**
 * 진행 상황 삭제
 * @param {string} jobId
 */
function deleteProgress(jobId) {
  progressStore.delete(jobId);
}

/**
 * 엑셀 기반 파트너 영상(YouTube+TikTok) 주간 메타데이터 수집
 * @param {string} excelFilePath
 * @param {Date} date
 * @param {string} jobId - 진행 상황 추적용 jobId
 */
async function collectMultiPlatformWeeklyMetadata(excelFilePath, date = new Date(), jobId = null) {
  const period = getWeeklyPeriod(date);
  const partners = await readPartnerListFromExcel(excelFilePath);
  if (partners.length === 0) throw new Error('엑셀 파일에 채널 정보가 없습니다.');

  const apiKey = process.env.YOUTUBE_API_KEY;
  const { google } = require('googleapis');
  if (!apiKey) {
    throw new Error('Missing YOUTUBE_API_KEY in server configuration');
  }
  const ytClient = google.youtube({ version: 'v3', auth: apiKey });

  const allItems = [];
  let successCount = 0;
  let errorCount = 0;
  const errorDetails = [];
  
  // 진행 상황 초기화
  if (jobId) {
    updateProgress(jobId, {
      total: partners.length,
      processed: 0,
      success: 0,
      error: 0,
      currentChannel: null,
      status: 'processing',
      videoCount: 0
    });
  }

  // === 파트너 수집 헬퍼 (플랫폼별 로직 공통화) ===
  async function processSinglePartner(p, index, total) {
    const label = `${p.channelName || '알 수 없음'} (${p.platform || 'youtube'})`;
    
    // 진행 상황 업데이트: 현재 처리 중인 채널
    if (jobId) {
      updateProgress(jobId, {
        total,
        processed: index - 1,
        success: successCount,
        error: errorCount,
        currentChannel: p.channelName,
        status: 'processing',
        videoCount: allItems.length
      });
    }
    
    logger.info('Partner archiving: 시작', {
      index,
      total,
      platform: p.platform,
      channelName: p.channelName
    });

    try {
      let videos = [];

      if (p.platform === 'tiktok') {
        const creator = p.tiktok;
        if (!creator) {
          throw new Error('틱톡 URL 또는 username이 없습니다.');
        }
        const result = await tiktokService.collectWeeklyCreatorMetadataApify({
          creator,
          date,
          partnerName: p.channelName,
          liveUrl: p.liveUrl
        });
        videos = result.videos || [];
      } else if (p.platform === 'instagram') {
        const creator = p.instagram;
        if (!creator) {
          throw new Error('인스타그램 URL 또는 username이 없습니다.');
        }
        const result = await instagramService.collectWeeklyCreatorMetadataApify({
          creator,
          date,
          partnerName: p.channelName,
          liveUrl: p.liveUrl
        });
        videos = result.videos || [];
      } else {
        // youtube
        if (!p.youtubeUrl && !p.channelId) {
          throw new Error('유튜브 URL 또는 채널 ID가 없습니다.');
        }
        const items = await collectYouTubeWeeklyForPartner(ytClient, p, period);
        videos = items || [];
      }

      // 각 채널별 영상 수 로깅
      logger.info('Partner archiving: 채널별 영상 수', {
        channelName: p.channelName,
        platform: p.platform,
        videoCount: videos.length,
        period: `${period.startDateFormatted} ~ ${period.endDateFormatted}`
      });

      videos.forEach(v => allItems.push(v));
      successCount++;
      
      // 진행 상황 업데이트: 성공
      if (jobId) {
        updateProgress(jobId, {
          total,
          processed: index,
          success: successCount,
          error: errorCount,
          currentChannel: null,
          status: 'processing',
          videoCount: allItems.length
        });
      }

      logger.info('Partner archiving: 완료', {
        index,
        total,
        platform: p.platform,
        channelName: p.channelName,
        videoCount: videos.length,
        progress: `${index}/${total}`
      });
    } catch (e) {
      errorCount++;
      let errMsg = e.message || String(e);
      if (errMsg.includes('TIKTOK_APIFY_API_TOKEN') || errMsg.includes('INSTAGRAM_APIFY_API_TOKEN')) {
        errMsg += ' (.env에 Apify API 토큰 설정 후 백엔드 재시작 필요)';
      }
      errorDetails.push({ channelName: p.channelName, platform: p.platform, error: errMsg });
      
      // 진행 상황 업데이트: 에러
      if (jobId) {
        updateProgress(jobId, {
          total,
          processed: index,
          success: successCount,
          error: errorCount,
          currentChannel: null,
          status: 'processing',
          videoCount: allItems.length
        });
      }
      
      logger.warn('Partner archiving item failed', {
        index,
        total,
        channelName: p.channelName,
        platform: p.platform,
        error: e.message,
        stack: e.stack
      });
    }
  }

  // === 배치 처리: 한 번에 너무 많은 채널을 처리하지 않도록 분할 ===
  const batchSize = Number(process.env.PARTNER_ARCHIVING_BATCH_SIZE || 10); // 기본 10개씩 (5 → 10으로 증가)
  const batchDelayMs = Number(process.env.PARTNER_ARCHIVING_BATCH_DELAY_MS || 200); // 배치 사이 200ms 대기 (1초 → 200ms로 감소)

  logger.info('Partner archiving: 수집 시작', {
    partnerCount: partners.length,
    batchSize,
    batchDelayMs,
    period
  });

  for (let startIndex = 0; startIndex < partners.length; startIndex += batchSize) {
    const endIndex = Math.min(startIndex + batchSize, partners.length);
    const batch = partners.slice(startIndex, endIndex);

    logger.info('Partner archiving: 배치 시작', {
      batchStart: startIndex + 1,
      batchEnd: endIndex,
      total: partners.length
    });

    // 배치 내에서는 병렬 처리 (비동기 처리 강화)하되, 전체 API 부하는 batchSize로 제한
    // 개별 파트너 에러는 catch에서 처리되므로 Promise.allSettled 사용
    // eslint-disable-next-line no-await-in-loop
    await Promise.allSettled(
      batch.map((p, idx) => processSinglePartner(p, startIndex + idx + 1, partners.length))
    );

    logger.info('Partner archiving: 배치 완료', {
      batchStart: startIndex + 1,
      batchEnd: endIndex,
      total: partners.length,
      accumulatedVideos: allItems.length,
      successCount,
      errorCount
    });

    if (endIndex < partners.length) {
      // 다음 배치 전 짧은 대기 (API 과부하 및 504 완화 목적)
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, batchDelayMs));
    }
  }

  if (allItems.length === 0) {
    return {
      csvPath: null,
      xlsxPath: null,
      totalVideoCount: 0,
      battlegroundsCount: 0,
      otherVideosCount: 0,
      channelCount: successCount,
      errorCount,
      errorDetails: errorDetails.slice(0, 20),
      period,
      message: '주간 기간 동안 업로드된 영상이 없습니다.'
    };
  }

  const { workbook, battlegroundsCount, otherVideosCount } = await convertToIntegratedXlsx(allItems);

  const uploadsDir = path.join(__dirname, '../uploads/partner-archiving');
  await fs.mkdir(uploadsDir, { recursive: true });

  const filename = `partner_weekly_${period.year}_${period.weekNumber}주차_${period.startDateFormatted}_${period.endDateFormatted}.xlsx`;
  const filePath = path.join(uploadsDir, filename);
  XLSX.writeFile(workbook, filePath);

  const discordWebhook = process.env.PARTNER_ARCHIVING_DISCORD_WEBHOOK_URL;
  if (discordWebhook && allItems.length > 0) {
    try {
      const discordService = require('./discord.service');
      await discordService.sendPartnerArchivingEmbed(discordWebhook, allItems, {
        monthWeekLabel: period.yearMonthWeekLabel || `${period.year}년 ${getMonthWeekLabel(period)}`
      });
    } catch (discordErr) {
      logger.warn('Partner archiving Discord 알림 전송 실패 (엑셀은 정상 생성됨)', {
        error: discordErr.message
      });
    }
  }

  const result = {
    csvPath: `/uploads/partner-archiving/${filename}`,
    xlsxPath: `/uploads/partner-archiving/${filename}`,
    totalVideoCount: allItems.length,
    battlegroundsCount,
    otherVideosCount,
    channelCount: successCount,
    errorCount,
    errorDetails: errorDetails.slice(0, 20),
    period
  };
  
  // 진행 상황 완료로 업데이트
  if (jobId) {
    updateProgress(jobId, {
      total: partners.length,
      processed: partners.length,
      success: successCount,
      error: errorCount,
      currentChannel: null,
      status: 'completed',
      videoCount: allItems.length
    });
    
    // 5분 후 진행 상황 자동 삭제 (메모리 정리)
    setTimeout(() => {
      deleteProgress(jobId);
    }, 5 * 60 * 1000);
  }
  
  return result;
}

module.exports = {
  readPartnerListFromExcel,
  collectMultiPlatformWeeklyMetadata,
  getProgress,
  deleteProgress
};

