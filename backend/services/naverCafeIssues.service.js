/**
 * Naver Cafe 포스트를 Issue/Comment로 변환하는 서비스
 */

const { query, queryOne, execute } = require('../libs/db');
const { classifyIssueCategory } = require('./issueClassifier');
const { broadcastIssueCreated, broadcastIssueUpdated } = require('../realtime/publisher');
const logger = require('../utils/logger');
const { toKSTISOString, toKSTDateString, nowKSTISOString, nowKSTDateString } = require('../utils/dateUtils');

/**
 * 특정 시간에 근무 중인 에이전트 찾기
 * @param {Date} targetTime - 확인할 시간
 * @param {number|null} projectId - 프로젝트 ID (선택)
 * @returns {Promise<string|null>} 에이전트 ID 또는 null
 */
async function findAgentByWorkSchedule(targetTime, projectId = null) {
  if (!targetTime || !(targetTime instanceof Date) || isNaN(targetTime.getTime())) {
    return null;
  }

  try {
    // UTC 시간을 한국 시간(KST, UTC+9)으로 변환
    // Date 객체는 UTC 기준이므로, KST 시간을 얻기 위해 9시간을 더함
    const kstOffset = 9 * 60 * 60 * 1000; // 9시간을 밀리초로
    const kstTimeMs = targetTime.getTime() + kstOffset;
    const kstTime = new Date(kstTimeMs);
    
    // KST 시간 파싱 (HH:mm 형식)
    // kstTimeMs는 UTC+9 시간을 나타내므로, getUTCHours()로 KST 시간을 얻을 수 있음
    const hour = kstTime.getUTCHours();
    const minute = kstTime.getUTCMinutes();
    const timeInMinutes = hour * 60 + minute;
    
    // 요일 확인 (0=일요일, 1=월요일, ..., 6=토요일) - KST 기준
    // kstTimeMs는 UTC+9 시간을 나타내므로, getUTCDay()로 KST 요일을 얻을 수 있음
    const dayOfWeek = kstTime.getUTCDay();
    
    // 날짜 확인 (YYYY-MM-DD 형식) - KST 기준
    // getUTC* 메서드를 사용하여 KST 날짜 계산
    const year = kstTime.getUTCFullYear();
    const month = String(kstTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kstTime.getUTCDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    logger.info('[NaverCafeIssues] Finding agent by work schedule', {
      targetTime: targetTime.toISOString(),
      kstTime: kstTime.toISOString(),
      kstHour: hour,
      kstMinute: minute,
      kstTimeInMinutes: timeInMinutes,
      kstDayOfWeek: dayOfWeek,
      kstDate: dateStr,
      projectId
    });
    
    // 프로젝트에 속한 활성 에이전트 조회
    let agentsQuery = `
      SELECT DISTINCT a.id, a.name, a.projectId
      FROM Agent a
      WHERE a.isActive = 1
    `;
    const agentsParams = [];
    
    if (projectId) {
      agentsQuery += ' AND a.projectId = ?';
      agentsParams.push(projectId);
    }
    
    const agents = query(agentsQuery, agentsParams);
    
    if (agents.length === 0) {
      logger.info('[NaverCafeIssues] No active agents found for project', { projectId });
      return null;
    }
    
    logger.info('[NaverCafeIssues] Active agents found', {
      projectId,
      agentsCount: agents.length,
      agentIds: agents.map(a => a.id)
    });
    
    const agentIds = agents.map(a => a.id);
    const placeholders = agentIds.map(() => '?').join(',');
    
    // 해당 시간에 근무 중인 스케줄 찾기
    const schedules = query(
      `SELECT s.*, a.projectId
       FROM AgentSchedule s
       JOIN Agent a ON s.agentId = a.id
       WHERE s.agentId IN (${placeholders})
         AND s.isActive = 1
         AND a.isActive = 1`,
      agentIds
    );
    
    logger.info('[NaverCafeIssues] Schedules found', {
      projectId,
      schedulesCount: schedules.length,
      schedules: schedules.map(s => ({
        agentId: s.agentId,
        scheduleType: s.scheduleType,
        dayOfWeek: s.dayOfWeek,
        specificDate: s.specificDate,
        startTime: s.startTime,
        endTime: s.endTime
      }))
    });
    
    const matchingAgents = [];
    
    for (const schedule of schedules) {
      let isMatch = false;
      
      // 시간 파싱 (HH:mm 형식)
      const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
      const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
      const startTimeInMinutes = startHour * 60 + startMinute;
      const endTimeInMinutes = endHour * 60 + endMinute;
      
      // 야간 근무 체크 (22:00-07:00 같은 경우)
      const isOvernight = endTimeInMinutes < startTimeInMinutes;
      
      if (schedule.scheduleType === 'weekly') {
        // 주간 반복 스케줄
        if (schedule.dayOfWeek === dayOfWeek) {
          if (isOvernight) {
            // 야간 근무: 시작 시간 이후 또는 종료 시간 이전
            isMatch = timeInMinutes >= startTimeInMinutes || timeInMinutes <= endTimeInMinutes;
          } else {
            // 일반 근무: 시작 시간과 종료 시간 사이
            isMatch = timeInMinutes >= startTimeInMinutes && timeInMinutes <= endTimeInMinutes;
          }
        }
      } else if (schedule.scheduleType === 'specific') {
        // 특정 날짜 스케줄
        if (schedule.specificDate === dateStr) {
          if (isOvernight) {
            // 야간 근무: 시작 시간 이후 또는 종료 시간 이전
            isMatch = timeInMinutes >= startTimeInMinutes || timeInMinutes <= endTimeInMinutes;
          } else {
            // 일반 근무: 시작 시간과 종료 시간 사이
            isMatch = timeInMinutes >= startTimeInMinutes && timeInMinutes <= endTimeInMinutes;
          }
        }
      }
      
      if (isMatch) {
        matchingAgents.push({
          agentId: schedule.agentId,
          agentName: agents.find(a => a.id === schedule.agentId)?.name || 'Unknown',
          projectId: schedule.projectId
        });
      }
    }
    
    if (matchingAgents.length === 0) {
      // 디버깅을 위한 상세 로그
      const scheduleDetails = schedules.map(s => {
        const [sStartHour, sStartMinute] = s.startTime ? s.startTime.split(':').map(Number) : [0, 0];
        const [sEndHour, sEndMinute] = s.endTime ? s.endTime.split(':').map(Number) : [0, 0];
        const sStartTimeInMinutes = sStartHour * 60 + sStartMinute;
        const sEndTimeInMinutes = sEndHour * 60 + sEndMinute;
        const sIsOvernight = sEndTimeInMinutes < sStartTimeInMinutes;
        
        let sMatches = false;
        if (s.scheduleType === 'weekly' && s.dayOfWeek === dayOfWeek) {
          if (sIsOvernight) {
            sMatches = timeInMinutes >= sStartTimeInMinutes || timeInMinutes <= sEndTimeInMinutes;
          } else {
            sMatches = timeInMinutes >= sStartTimeInMinutes && timeInMinutes <= sEndTimeInMinutes;
          }
        } else if (s.scheduleType === 'specific' && s.specificDate === dateStr) {
          if (sIsOvernight) {
            sMatches = timeInMinutes >= sStartTimeInMinutes || timeInMinutes <= sEndTimeInMinutes;
          } else {
            sMatches = timeInMinutes >= sStartTimeInMinutes && timeInMinutes <= sEndTimeInMinutes;
          }
        }
        
        return {
          agentId: s.agentId,
          scheduleType: s.scheduleType,
          dayOfWeek: s.dayOfWeek,
          specificDate: s.specificDate,
          startTime: s.startTime,
          endTime: s.endTime,
          startTimeInMinutes: sStartTimeInMinutes,
          endTimeInMinutes: sEndTimeInMinutes,
          isOvernight: sIsOvernight,
          matches: sMatches,
          reason: s.scheduleType === 'weekly' 
            ? (s.dayOfWeek === dayOfWeek ? 'day matches' : `day mismatch (schedule: ${s.dayOfWeek}, target: ${dayOfWeek})`)
            : (s.specificDate === dateStr ? 'date matches' : `date mismatch (schedule: ${s.specificDate}, target: ${dateStr})`)
        };
      });
      
      logger.info('[NaverCafeIssues] No agents found matching work schedule', {
        targetTime: targetTime.toISOString(),
        kstTime: kstTime.toISOString(),
        kstHour: hour,
        kstMinute: minute,
        kstTimeInMinutes: timeInMinutes,
        kstDayOfWeek: dayOfWeek,
        kstDate: dateStr,
        projectId,
        schedulesCount: schedules.length,
        agentsCount: agents.length,
        scheduleDetails
      });
      return null;
    }
    
    // 여러 에이전트가 매칭되면 우선순위 적용
    // 1. 프로젝트가 일치하는 에이전트 우선
    // 2. 할당된 이슈 수가 적은 에이전트 우선
    let selectedAgent = null;
    
    if (projectId) {
      // 프로젝트가 일치하는 에이전트 찾기
      const projectAgents = matchingAgents.filter(a => a.projectId === projectId);
      if (projectAgents.length > 0) {
        matchingAgents.splice(0, matchingAgents.length, ...projectAgents);
      }
    }
    
    // 할당된 이슈 수 확인
    const agentIssueCounts = {};
    for (const agent of matchingAgents) {
      const count = queryOne(
        'SELECT COUNT(*) as count FROM ReportItemIssue WHERE assignedAgentId = ? AND status != ?',
        [agent.agentId, 'RESOLVED']
      );
      agentIssueCounts[agent.agentId] = count?.count || 0;
    }
    
    // 매칭된 에이전트 정보 로깅
    logger.info('[NaverCafeIssues] Multiple agents matched work schedule', {
      targetTime: targetTime.toISOString(),
      matchingAgentsCount: matchingAgents.length,
      matchingAgents: matchingAgents.map(a => ({
        agentId: a.agentId,
        agentName: a.agentName,
        projectId: a.projectId,
        currentIssueCount: agentIssueCounts[a.agentId] || 0
      })),
      projectId
    });
    
    // 이슈 수가 가장 적은 에이전트 선택
    // 동일한 이슈 수인 경우 첫 번째 에이전트 선택
    selectedAgent = matchingAgents.reduce((prev, curr) => {
      const prevCount = agentIssueCounts[prev.agentId] || 0;
      const currCount = agentIssueCounts[curr.agentId] || 0;
      if (currCount < prevCount) {
        return curr;
      } else if (currCount === prevCount) {
        // 동일한 이슈 수인 경우, 에이전트 이름으로 정렬하여 일관성 유지
        return prev.agentName < curr.agentName ? prev : curr;
      } else {
        return prev;
      }
    });
    
    logger.info('[NaverCafeIssues] Agent auto-assigned by work schedule', {
      targetTime: targetTime.toISOString(),
      assignedAgentId: selectedAgent.agentId,
      assignedAgentName: selectedAgent.agentName,
      assignedAgentIssueCount: agentIssueCounts[selectedAgent.agentId] || 0,
      matchingAgentsCount: matchingAgents.length,
      selectionReason: matchingAgents.length > 1 
        ? `Selected from ${matchingAgents.length} agents based on lowest issue count (${agentIssueCounts[selectedAgent.agentId] || 0} issues)`
        : 'Only one agent matched',
      projectId
    });
    
    return selectedAgent.agentId;
  } catch (error) {
    logger.error('[NaverCafeIssues] Failed to find agent by work schedule', {
      error: error.message,
      targetTime: targetTime?.toISOString()
    });
    return null;
  }
}

/**
 * Naver Cafe 포스트를 Issue/Comment로 upsert
 * 
 * @param {object} params
 * @param {string} params.url - 원본 포스트 URL
 * @param {"PUBG_PC"|"PUBG_MOBILE"} params.cafeGame - 카페 게임 타입
 * @param {object} params.post - 스크래핑된 포스트 데이터
 * @param {Array} params.comments - 스크래핑된 댓글 배열
 * @param {number|null} params.monitoredUrlId - MonitoredUrl ID (선택)
 * @param {number|null} params.monitoredBoardId - MonitoredBoard ID (선택)
 * @param {string|null} params.screenshotPath - 스크린샷 파일 경로 (선택)
 * @param {string[]|null} [params.postImagePaths] - 본문 이미지 상대 경로 배열 (uploads 기준)
 * @param {boolean} params.hasImages - 게시글에 이미지가 있는지 여부
 * @param {boolean} params.requiresLogin - 계정이 있어야만 확인할 수 있는 게시글인지 여부
 * @param {string} [params.naverCollection] - `'clan'`이면 클랜 전용 워커 출처(이슈 externalSource PC_CLAN)
 * @param {{ externalSource: string, reportType: string, fileType: string }} [params.issueIntegration] - Naver 외 연동(Discourse 등): externalSource·시스템 Report 타입 고정
 * @param {number|null} [params.discourseViews] - Discourse 조회수(있을 때만)
 * @param {number|null} [params.discourseLikeCount] - Discourse 좋아요 수(있을 때만)
 * @param {number|null} [params.discourseReplyCount] - Discourse 답글 수(있을 때만)
 * @returns {Promise<Object>} 생성/업데이트된 Issue
 */
const crawlerGames = require('./crawlerGames.service');

/** playinzoi Discourse 포럼 RawLog/이슈 출처 식별자 (워커·프로세서와 동일 값 유지) */
const DISCOURSE_PLAYINZOI_EXTERNAL_SOURCE = 'DISCOURSE_PLAYINZOI';

/** RawLogProcessor·Discourse 워커에서 공통 사용 */
const DISCOURSE_INZOI_ISSUE_INTEGRATION = {
  externalSource: DISCOURSE_PLAYINZOI_EXTERNAL_SOURCE,
  reportType: 'discourse_inzoi_scraper',
  fileType: 'discourse_inzoi'
};

function isMissingColumnError(err, columnName) {
  const msg = String(err?.message || err || '');
  return msg.includes(`column "${columnName}"`) && msg.includes('does not exist');
}

function executeWithColumnFallback({ sqlWith, paramsWith, sqlFallback, paramsFallback, fallbackOnColumn }) {
  try {
    return execute(sqlWith, paramsWith);
  } catch (err) {
    if (fallbackOnColumn && isMissingColumnError(err, fallbackOnColumn)) {
      logger.warn('[NaverCafeIssues] Column missing; retrying without new fields', {
        column: fallbackOnColumn
      });
      return execute(sqlFallback, paramsFallback);
    }
    throw err;
  }
}

async function upsertIssueFromNaverCafe({
  url,
  cafeGame,
  post,
  comments,
  monitoredUrlId,
  monitoredBoardId,
  screenshotPath,
  postImagePaths,
  hasImages,
  requiresLogin,
  commentCount,
  scrapedComments,
  isHotTopic,
  hasKeywordMatch,
  restoreIfExcluded,
  naverCollection,
  issueIntegration,
  discourseViews = null,
  discourseLikeCount = null,
  discourseReplyCount = null
}) {
  // 입력 데이터 검증 (크리티컬: 잘못된 데이터로 인한 오류 방지)
  if (!post || typeof post !== 'object') {
    throw new Error(`Invalid post object: ${typeof post}`);
  }
  
  if (!url || typeof url !== 'string') {
    throw new Error(`Invalid url: ${typeof url}`);
  }

  if (issueIntegration) {
    if (!issueIntegration.externalSource || !issueIntegration.reportType || !issueIntegration.fileType) {
      throw new Error('issueIntegration requires externalSource, reportType, and fileType');
    }
  }

  const externalPostId = post.externalPostId || url;
  const game = cafeGame || 'PUBG_PC';
  const fromClanWorker = naverCollection === 'clan';
  let externalSource = issueIntegration
    ? issueIntegration.externalSource
    : crawlerGames.resolveNaverExternalSource(game, fromClanWorker);

  try {
    // 프로젝트 ID 확인 (monitoredBoard 또는 monitoredUrl에서)
    let projectId = null;
    if (monitoredBoardId) {
      const board = queryOne(
        'SELECT projectId FROM MonitoredBoard WHERE id = ?',
        [monitoredBoardId]
      );
      if (board && board.projectId) {
        projectId = board.projectId;
      }
    }
    // monitoredUrl에서도 확인 (하위 호환성)
    if (!projectId && monitoredUrlId) {
      const monitoredUrl = queryOne(
        'SELECT projectId FROM MonitoredUrl WHERE id = ?',
        [monitoredUrlId]
      );
      if (monitoredUrl && monitoredUrl.projectId) {
        projectId = monitoredUrl.projectId;
      }
    }

    // 기존 Issue 찾기 (externalPostId + sourceUrl로; issueIntegration 시 externalSource까지 일치)
    // URL의 쿼리 파라미터 차이로 인한 중복 이슈 방지를 위해 sourceUrl도 LIKE로 검색
    // 먼저 정확한 매칭 시도, 없으면 URL의 기본 경로만으로 검색
    const extSrcFilter = issueIntegration ? issueIntegration.externalSource : null;
    let issue = extSrcFilter
      ? queryOne(
          'SELECT * FROM ReportItemIssue WHERE externalPostId = ? AND externalSource = ? AND sourceUrl = ?',
          [externalPostId, extSrcFilter, url]
        )
      : queryOne(
          'SELECT * FROM ReportItemIssue WHERE externalPostId = ? AND sourceUrl = ?',
          [externalPostId, url]
        );
    
    // 정확한 매칭이 없으면 URL의 기본 경로만으로 검색 (쿼리 파라미터 제외)
    if (!issue) {
      const urlWithoutQuery = url.split('?')[0];
      const candidates = extSrcFilter
        ? query(
            'SELECT * FROM ReportItemIssue WHERE externalPostId = ? AND externalSource = ? AND sourceUrl LIKE ?',
            [externalPostId, extSrcFilter, urlWithoutQuery + '%']
          )
        : query(
            'SELECT * FROM ReportItemIssue WHERE externalPostId = ? AND sourceUrl LIKE ?',
            [externalPostId, urlWithoutQuery + '%']
          );
      if (candidates.length > 0) {
        issue = candidates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        logger.debug('[NaverCafeIssues] Found existing issue by URL base path', {
          externalPostId,
          originalUrl: url,
          foundUrl: issue.sourceUrl,
          issueId: issue.id
        });
      }
    }
    
    if (issue) {
      if (issue.categoryGroupId) {
        issue.categoryGroup = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [issue.categoryGroupId]);
      }
      if (issue.categoryId) {
        issue.category = queryOne('SELECT * FROM Category WHERE id = ?', [issue.categoryId]);
      }
    }

    const isNewIssue = !issue;

    // 이미 클랜 워커로 태그된 이슈는 일반 워커 갱신 시에도 클랜 externalSource 유지
    const clanExtForGame = crawlerGames.getClanExternalSourceForGame(game);
    if (
      !issueIntegration &&
      issue &&
      clanExtForGame &&
      issue.externalSource === clanExtForGame &&
      !fromClanWorker
    ) {
      externalSource = clanExtForGame;
    }

    // 분류 수행 (제목 + 본문 + 댓글 스니펫 포함)
    let commentsSnippet = '';
    
    // scrapedComments가 있으면 파싱하여 사용
    if (scrapedComments) {
      try {
        const parsedComments = JSON.parse(scrapedComments);
        if (Array.isArray(parsedComments) && parsedComments.length > 0) {
          commentsSnippet = parsedComments
            .slice(0, 5) // 최대 5개 댓글
            .map((c, idx) => `댓글 ${idx + 1} (${c.author || '익명'}): ${c.text || c.content || ''}`)
            .join('\n');
        }
      } catch (e) {
        logger.warn('[NaverCafeIssues] Failed to parse scrapedComments', { error: e.message });
      }
    }
    
    // 기존 comments 배열도 지원 (하위 호환성)
    if (!commentsSnippet && comments && comments.length > 0) {
      commentsSnippet = comments
        .slice(0, 3) // 최대 3개 댓글만
        .map((c) => `댓글: ${c.content}`)
        .join('\n');
    }

    const classificationText = [
      post.title || '',
      post.content || '',
      commentsSnippet ? `\n[유저 댓글]\n${commentsSnippet}` : ''
    ]
      .filter(Boolean)
      .join('\n\n');

    let classification = null;
    
    logger.info('[NaverCafeIssues] Starting classification', {
      externalPostId,
      titleLength: post.title?.length || 0,
      contentLength: post.content?.length || 0,
      hasComments: !!commentsSnippet
    });
    
    try {
      const { db } = require('../libs/db');
      classification = await classifyIssueCategory({
        text: classificationText,
        db: db,
        projectId: projectId || null
      });
      
      // 카테고리 우선: 중분류가 정해지면 분류 관리의 Category.importance로 severity/importance 확정 (AI severity는 참고만)
      if (classification && classification.categoryId) {
        const category = queryOne('SELECT importance FROM Category WHERE id = ?', [classification.categoryId]);
        if (category && category.importance) {
          const categoryImportanceToSeverity = {
            HIGH: 1,
            MEDIUM: 2,
            LOW: 3
          };
          const categorySeverity = categoryImportanceToSeverity[category.importance] ?? 2;
          const aiSeveritySuggested = classification.severity;
          classification.importance = category.importance;
          classification.severity = categorySeverity;
          logger.debug('[NaverCafeIssues] Category-first severity applied', {
            categoryId: classification.categoryId,
            categoryImportance: category.importance,
            aiSeveritySuggested,
            severity: categorySeverity
          });
        }
      }
      
      logger.info('[NaverCafeIssues] Classification successful', {
        externalPostId,
        categoryId: classification?.categoryId || null,
        importance: classification?.importance || 'MEDIUM',
        severity: classification?.severity || 2
      });
    } catch (err) {
      logger.warn('[NaverCafeIssues] Classification failed - using fallback', { 
        externalPostId,
        error: err.message,
        stack: err.stack
      });
      // 분류 실패 시 기본값 사용 (Issue 생성은 계속 진행)
      classification = {
        groupId: null,
        categoryId: null,
        importance: 'MEDIUM',
        severity: 2, // 기본 severity
        sentiment: 'neu', // 기본 sentiment
        trend: null,
        otherGameTitle: null,
        aiClassificationReason: `AI 분류 실패: ${err.message}`,
        aiClassificationMethod: 'FALLBACK'
      };
    }

    // reportId는 필수이므로 시스템 Report 찾기 또는 생성
    // 먼저 'system' Agent가 존재하는지 확인하고 없으면 생성
    let systemAgent = queryOne('SELECT * FROM Agent WHERE id = ?', ['system']);

    if (!systemAgent) {
      // 한국 시간 기준으로 현재 시간 저장
      const now = nowKSTISOString() || new Date().toISOString();
      execute(
        'INSERT INTO Agent (id, name, status, handling, todayResolved, avgHandleSec, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['system', 'System', 'offline', 0, 0, 0, 1, now, now]
      );
      systemAgent = queryOne('SELECT * FROM Agent WHERE id = ?', ['system']);
      logger.info('[NaverCafeIssues] Created system agent', { id: systemAgent.id });
    }

    const reportType = issueIntegration ? issueIntegration.reportType : 'naver_cafe_scraper';
    const reportFileType = issueIntegration ? issueIntegration.fileType : 'naver_cafe';

    let systemReport = queryOne(
      'SELECT * FROM Report WHERE agentId = ? AND reportType = ?',
      ['system', reportType]
    );

    if (!systemReport) {
      const { nanoid } = require('nanoid');
      const reportId = nanoid();
      // 한국 시간 기준으로 현재 시간 저장
      const now = nowKSTISOString() || new Date().toISOString();
      const date = now.split('T')[0];
      
      execute(
        'INSERT INTO Report (id, agentId, date, fileType, reportType, status, uploadedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [reportId, 'system', date, reportFileType, reportType, 'processed', now, now, now]
      );
      systemReport = queryOne('SELECT * FROM Report WHERE id = ?', [reportId]);
      logger.info('[NaverCafeIssues] Created system report', { reportId: systemReport.id, reportType });
    }

    // 원본 작성 시간 파싱 (한국 시간 기준으로 정확히 저장)
    // post.createdAt이 이미 한국 시간 기준으로 파싱된 Date 객체인 경우 그대로 사용
    // 문자열인 경우 한국 시간으로 해석하여 변환
    let sourceCreatedAt = null;
    if (post.createdAt) {
      if (post.createdAt instanceof Date) {
        // 이미 Date 객체인 경우 (한국 시간 기준으로 파싱된 경우)
        // createKSTDate로 생성된 Date 객체는 이미 UTC로 저장되지만 한국 시간 값을 나타냄
        sourceCreatedAt = post.createdAt;
      } else if (typeof post.createdAt === 'string') {
        // 문자열인 경우 한국 시간으로 해석하여 변환
        const dateObj = new Date(post.createdAt);
        if (!isNaN(dateObj.getTime())) {
          // 입력된 문자열을 한국 시간대로 해석하여 변환
          const kstISO = toKSTISOString(dateObj);
          if (kstISO) {
            sourceCreatedAt = new Date(kstISO);
          }
        }
      }
    }

    // 근무시간 기반 담당 에이전트 자동 할당 (실패해도 Issue 생성은 계속)
    let assignedAgentId = null;
    if (sourceCreatedAt && isNewIssue) {
      try {
        logger.info('[NaverCafeIssues] Attempting auto-assignment by work schedule', {
          sourceCreatedAt: sourceCreatedAt.toISOString(),
          isNewIssue,
          projectId
        });
        assignedAgentId = await findAgentByWorkSchedule(sourceCreatedAt, projectId);
        if (assignedAgentId) {
          logger.info('[NaverCafeIssues] Auto-assigned agent by work schedule', {
            sourceCreatedAt: sourceCreatedAt.toISOString(),
            assignedAgentId,
            projectId
          });
        } else {
          logger.info('[NaverCafeIssues] No agent auto-assigned (no matching schedule or no agents available)', {
            sourceCreatedAt: sourceCreatedAt.toISOString(),
            projectId
          });
        }
      } catch (agentError) {
        logger.warn('[NaverCafeIssues] Auto-assignment failed - continuing without agent', {
          sourceCreatedAt: sourceCreatedAt?.toISOString(),
          projectId,
          error: agentError.message,
          stack: agentError.stack
        });
        // 에이전트 할당 실패해도 Issue 생성은 계속 (assignedAgentId는 null로 유지)
      }
    } else {
      logger.debug('[NaverCafeIssues] Skipping auto-assignment', {
        hasSourceCreatedAt: !!sourceCreatedAt,
        isNewIssue,
        projectId
      });
    }

    // 크롤러가 올바르게 분류한 requiresLogin 정보를 존중
    // 본문 길이로 requiresLogin을 재설정하지 않음 (크롤러의 팝업 감지가 더 정확함)
    // 단, requiresLogin이 명시적으로 전달되지 않은 경우에만 기본값 false 사용
    if (requiresLogin === undefined || requiresLogin === null) {
      requiresLogin = false;
      logger.debug('[NaverCafeIssues] requiresLogin not provided, using default false', {
        externalPostId
      });
    } else {
      logger.debug('[NaverCafeIssues] Using requiresLogin from crawler', {
        externalPostId,
        requiresLogin,
        contentLength: (post.content || '').trim().length
      });
    }

    // Issue 데이터 준비
    // detail이 summary와 동일하면 detail을 비움 (제목만 있는 게시글로 처리)
    let issueDetail = post.content || '';
    const issueSummary = post.title || '제목 없음';
    if (issueDetail.trim() === issueSummary.trim()) {
      issueDetail = '';
      logger.debug('[NaverCafeIssues] Detail is same as summary, clearing detail', {
        externalPostId,
        summary: issueSummary.substring(0, 50)
      });
    }
    
    // 키워드 매칭 여부를 detail에 마커로 추가 (UI에서 파싱하여 표시)
    // hasKeywordMatch가 true인 경우 detail 앞에 특별한 마커 추가
    if (hasKeywordMatch && issueDetail) {
      issueDetail = `[KEYWORD_MATCHED]\n${issueDetail}`;
    } else if (hasKeywordMatch && !issueDetail) {
      issueDetail = '[KEYWORD_MATCHED]';
    }
    
    // 한국 시간 기준으로 date 필드 설정 (정확한 날짜 추출)
    let issueDate = null;
    if (post.createdAt) {
      issueDate = toKSTDateString(post.createdAt);
    } else {
      issueDate = nowKSTDateString();
    }
    
    // 기존 이슈가 있으면 status 유지, 없으면 OPEN으로 설정
    // 기존 이슈를 찾았을 때는 status를 유지하여 완료 처리된 이슈가 다시 OPEN으로 변경되지 않도록 함
    const issueStatus = issue && issue.status ? issue.status : 'OPEN';
    
    const issueData = {
      // 기본 필드
      reportId: systemReport.id,
      date: issueDate,
      summary: issueSummary,
      detail: issueDetail,
      link: url,
      source: externalSource,
      status: issueStatus, // 기존 이슈의 status 유지 (완료 처리된 이슈가 다시 OPEN으로 변경되지 않도록)
      sentiment: classification?.sentiment || 'neu', // AI 분류 결과의 sentiment 사용
      
      // 외부 소스 필드
      sourceUrl: url,
      externalPostId: externalPostId,
      externalSource: externalSource,
      monitoredUrlId: monitoredUrlId || null,
      monitoredBoardId: monitoredBoardId || null,
      projectId: projectId || null,
      
      // 담당 에이전트 (근무시간 기반 자동 할당)
      assignedAgentId: assignedAgentId,
      
      // 분류 필드
      importance: classification.importance || 'MEDIUM',
      categoryGroupId: classification.groupId || null,
      categoryId: classification.categoryId || null,
      otherGameTitle: classification.otherGameTitle || null,
      // AI 분류 정보
      aiClassificationReason: classification.aiClassificationReason || null,
      aiClassificationMethod: classification.aiClassificationMethod || null,
      // trend 필드 (AI 분류 결과에서 가져옴)
      trend: classification.trend || null,
      
      // severity는 AI 분류 결과가 있으면 사용, 없으면 importance 기반으로 설정
      severity: classification.severity || 
                (classification.importance === 'HIGH' ? 1 : 
                 classification.importance === 'MEDIUM' ? 2 : 3),
      
      // 스크린샷 경로
      screenshotPath: screenshotPath || null,
      postImagePaths:
        Array.isArray(postImagePaths) && postImagePaths.length > 0
          ? JSON.stringify(postImagePaths)
          : null,
      hasImages: hasImages || false,
      requiresLogin: requiresLogin || false,

      // Discourse 지표 (inZOI Forums)
      discourseViews: typeof discourseViews === 'number' ? discourseViews : null,
      discourseLikeCount: typeof discourseLikeCount === 'number' ? discourseLikeCount : null,
      discourseReplyCount: typeof discourseReplyCount === 'number' ? discourseReplyCount : null,
      
      // 원본 게시글 작성 시간
      sourceCreatedAt: sourceCreatedAt,
      
      // 댓글 동향 정보
      commentCount: commentCount || 0,
      scrapedComments: scrapedComments || null,
      isHotTopic: isHotTopic || false
    };

    if (isNewIssue) {
      // 새 Issue 생성
      const { nanoid } = require('nanoid');
      const issueId = nanoid();
      // 한국 시간 기준으로 현재 시간 저장
      const now = nowKSTISOString() || new Date().toISOString();
      
      executeWithColumnFallback({
        fallbackOnColumn: 'discourseViews',
        sqlWith: `INSERT INTO ReportItemIssue (id, reportId, date, summary, detail, link, source, status, sentiment, sourceUrl, externalPostId, externalSource, monitoredUrlId, monitoredBoardId, projectId, assignedAgentId, importance, categoryGroupId, categoryId, otherGameTitle, aiClassificationReason, aiClassificationMethod, trend, severity, screenshotPath, postImagePaths, hasImages, requiresLogin, discourseViews, discourseLikeCount, discourseReplyCount, sourceCreatedAt, commentCount, scrapedComments, isHotTopic, createdAt, updatedAt) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        paramsWith: [
          issueId,
          issueData.reportId,
          issueData.date,
          issueData.summary,
          issueData.detail,
          issueData.link,
          issueData.source,
          issueData.status,
          issueData.sentiment,
          issueData.sourceUrl,
          issueData.externalPostId,
          issueData.externalSource,
          issueData.monitoredUrlId,
          issueData.monitoredBoardId,
          issueData.projectId,
          issueData.assignedAgentId || null,
          issueData.importance,
          issueData.categoryGroupId,
          issueData.categoryId,
          issueData.otherGameTitle,
          issueData.aiClassificationReason,
          issueData.aiClassificationMethod,
          issueData.trend,
          issueData.severity,
          issueData.screenshotPath,
          issueData.postImagePaths,
          issueData.hasImages ? 1 : 0,
          issueData.requiresLogin ? 1 : 0,
          issueData.discourseViews,
          issueData.discourseLikeCount,
          issueData.discourseReplyCount,
          issueData.sourceCreatedAt ? issueData.sourceCreatedAt.toISOString() : null,
          issueData.commentCount,
          issueData.scrapedComments,
          issueData.isHotTopic ? 1 : 0,
          now,
          now
        ],
        sqlFallback: `INSERT INTO ReportItemIssue (id, reportId, date, summary, detail, link, source, status, sentiment, sourceUrl, externalPostId, externalSource, monitoredUrlId, monitoredBoardId, projectId, assignedAgentId, importance, categoryGroupId, categoryId, otherGameTitle, aiClassificationReason, aiClassificationMethod, trend, severity, screenshotPath, postImagePaths, hasImages, requiresLogin, sourceCreatedAt, commentCount, scrapedComments, isHotTopic, createdAt, updatedAt) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        paramsFallback: [
          issueId,
          issueData.reportId,
          issueData.date,
          issueData.summary,
          issueData.detail,
          issueData.link,
          issueData.source,
          issueData.status,
          issueData.sentiment,
          issueData.sourceUrl,
          issueData.externalPostId,
          issueData.externalSource,
          issueData.monitoredUrlId,
          issueData.monitoredBoardId,
          issueData.projectId,
          issueData.assignedAgentId || null,
          issueData.importance,
          issueData.categoryGroupId,
          issueData.categoryId,
          issueData.otherGameTitle,
          issueData.aiClassificationReason,
          issueData.aiClassificationMethod,
          issueData.trend,
          issueData.severity,
          issueData.screenshotPath,
          issueData.postImagePaths,
          issueData.hasImages ? 1 : 0,
          issueData.requiresLogin ? 1 : 0,
          issueData.sourceCreatedAt ? issueData.sourceCreatedAt.toISOString() : null,
          issueData.commentCount,
          issueData.scrapedComments,
          issueData.isHotTopic ? 1 : 0,
          now,
          now
        ]
      });
      
      issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
      if (issue.categoryGroupId) {
        issue.categoryGroup = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [issue.categoryGroupId]);
      }
      if (issue.categoryId) {
        issue.category = queryOne('SELECT * FROM Category WHERE id = ?', [issue.categoryId]);
      }
      if (issue.monitoredUrlId) {
        issue.monitoredUrl = queryOne('SELECT * FROM MonitoredUrl WHERE id = ?', [issue.monitoredUrlId]);
      }

      logger.info('[NaverCafeIssues] New issue created', { 
        issueId: issue.id, 
        externalPostId,
        url 
      });

      // WebSocket 브로드캐스트
      try {
        broadcastIssueCreated({
          id: issue.id,
          projectId: issue.projectId,
          summary: issue.summary,
          detail: issue.detail,
          severity: issue.severity,
          category: issue.category?.name,
          status: issue.status,
          source: issue.source,
          createdAt: issue.createdAt
        });
      } catch (wsError) {
        logger.warn('[NaverCafeIssues] WebSocket broadcast failed', { error: wsError.message });
      }
    } else {
      // 기존 Issue 업데이트 (제목/내용/댓글 정보가 변경된 경우)
      // 1) 본문 업데이트 로직:
      //    - 새 detail이 비어있으면 기존 detail 유지 (본문 유실 방지)
      //    - 기존 detail이 비어있거나 매우 짧거나(10자 미만) 제목과 동일하면 새 detail로 업데이트
      const newDetail = (issueData.detail || '').trim();
      const oldDetail = (issue.detail || '').trim();
      const oldSummary = (issue.summary || '').trim();
      
      if (!newDetail || newDetail.length === 0) {
        // 새 detail이 비어있으면 기존 detail 유지
        issueData.detail = issue.detail;
      } else if (!oldDetail || oldDetail.length < 10 || oldDetail === oldSummary) {
        // 기존 detail이 비어있거나 매우 짧거나 제목과 동일하면 새 detail로 업데이트
        issueData.detail = newDetail;
        logger.info('[NaverCafeIssues] Updating detail from empty/short/title-matching to new content', {
          issueId: issue.id,
          oldDetailLength: oldDetail.length,
          newDetailLength: newDetail.length,
          oldDetailPreview: oldDetail.substring(0, 50),
          newDetailPreview: newDetail.substring(0, 50)
        });
      } else if (newDetail.length > oldDetail.length * 1.5) {
        // 새 detail이 기존 detail보다 50% 이상 길면 업데이트 (더 많은 정보)
        issueData.detail = newDetail;
        logger.info('[NaverCafeIssues] Updating detail with significantly longer content', {
          issueId: issue.id,
          oldDetailLength: oldDetail.length,
          newDetailLength: newDetail.length
        });
      } else {
        // 그 외에는 기존 detail 유지
        issueData.detail = issue.detail;
      }

      // 2) 새 제목이 너무 일반적인 제목(예: '네이버 카페', '배틀그라운드 공식카페 - PUBG: BATTLEGROUNDS')인 경우
      //    기존에 의미 있는 제목이 있으면 덮어쓰지 않고 기존 제목을 유지
      //    또한, 로그인 필요 게시글의 경우 리스트 페이지에서 추출한 원래 제목을 우선 사용
      const genericTitlePatterns = [
        /^네이버\s*카페$/i,
        /^배틀그라운드\s*공식카페\s*-\s*PUBG:? ?BATTLEGROUNDS/i
      ];
      const newTitle = (issueData.summary || '').trim();
      const oldTitle = (issue.summary || '').trim();
      const newIsGeneric = newTitle && genericTitlePatterns.some((re) => re.test(newTitle));
      const oldIsGeneric = oldTitle && genericTitlePatterns.some((re) => re.test(oldTitle));
      
      // 새 제목이 일반적인 제목이고, 기존 제목이 의미 있는 제목이면 기존 제목 유지
      if (newIsGeneric && !oldIsGeneric && oldTitle) {
        issueData.summary = oldTitle;
        logger.debug('[NaverCafeIssues] Keeping existing meaningful title instead of generic title', {
          externalPostId,
          oldTitle: oldTitle.substring(0, 50),
          newTitle: newTitle.substring(0, 50),
          requiresLogin: issueData.requiresLogin
        });
      }
      
      // 로그인 필요 게시글의 경우, 새 제목이 일반적인 제목이면 기존 제목 유지 (리스트 페이지에서 추출한 원래 제목)
      if (issueData.requiresLogin && newIsGeneric && oldTitle && !oldIsGeneric) {
        issueData.summary = oldTitle;
        logger.debug('[NaverCafeIssues] Login-required post: keeping list page title instead of generic detail page title', {
          externalPostId,
          oldTitle: oldTitle.substring(0, 50),
          newTitle: newTitle.substring(0, 50)
        });
      }
      
      // 3) 크롤러가 올바르게 분류한 requiresLogin 정보 존중
      // 제목이 일반적이고 본문이 있어도 requiresLogin을 재설정하지 않음
      // (크롤러의 팝업 감지가 더 정확함)

      // 4) 보고서 제외 완료 처리된 이슈를 수동 수집하면 → 열림 상태로 복원 (restoreIfExcluded=true일 때만)
      const wasExcludedFromReport = (issue.excludedFromReport === 1 || issue.excludedFromReport === true) && restoreIfExcluded;

      const needsUpdate =
        wasExcludedFromReport ||
        issue.summary !== issueData.summary ||
        issue.detail !== issueData.detail ||
        issue.commentCount !== issueData.commentCount ||
        issue.scrapedComments !== issueData.scrapedComments ||
        issue.isHotTopic !== issueData.isHotTopic ||
        issue.requiresLogin !== (issueData.requiresLogin ? 1 : 0) ||
        // Discourse metrics
        (issue.discourseViews ?? null) !== (issueData.discourseViews ?? null) ||
        (issue.discourseLikeCount ?? null) !== (issueData.discourseLikeCount ?? null) ||
        (issue.discourseReplyCount ?? null) !== (issueData.discourseReplyCount ?? null) ||
        // 메뉴/보드 식별을 위해 더 구체적인 URL(예: menuid 포함)로 갱신 필요
        String(issue.sourceUrl || '') !== String(issueData.sourceUrl || '') ||
        String(issue.link || '') !== String(issueData.link || '') ||
        // 같은 글(externalPostId)이 더 구체적인 메뉴 보드에서 수집되면 보드 id를 최신으로 갱신
        Number(issue.monitoredBoardId || 0) !== Number(issueData.monitoredBoardId || 0) ||
        String(issue.externalSource || '') !== String(issueData.externalSource || '') ||
        String(issue.source || '') !== String(issueData.source || '');

      if (needsUpdate) {
        // 한국 시간 기준으로 현재 시간 저장
        const now = nowKSTISOString() || new Date().toISOString();

        if (wasExcludedFromReport) {
          // 보고서 제외 완료된 이슈 → 수동 수집 시 열림 상태로 복원
          executeWithColumnFallback({
            fallbackOnColumn: 'discourseViews',
            sqlWith: `UPDATE ReportItemIssue SET summary = ?, detail = ?, importance = ?, categoryGroupId = ?, categoryId = ?, severity = ?, trend = ?, aiClassificationReason = ?, aiClassificationMethod = ?, commentCount = ?, scrapedComments = ?, isHotTopic = ?, requiresLogin = ?, sourceUrl = ?, link = ?, monitoredBoardId = ?, source = ?, externalSource = ?, discourseViews = ?, discourseLikeCount = ?, discourseReplyCount = ?, excludedFromReport = 0, excludedAt = NULL, excludedBy = NULL, processedAt = NULL, processedBy = NULL, status = ?, updatedAt = ? WHERE id = ?`,
            paramsWith: [
              issueData.summary,
              issueData.detail,
              issueData.importance,
              issueData.categoryGroupId,
              issueData.categoryId,
              issueData.severity,
              issueData.trend,
              issueData.aiClassificationReason,
              issueData.aiClassificationMethod,
              issueData.commentCount,
              issueData.scrapedComments,
              issueData.isHotTopic ? 1 : 0,
              issueData.requiresLogin ? 1 : 0,
              issueData.sourceUrl,
              issueData.link,
              issueData.monitoredBoardId || null,
              issueData.source,
              issueData.externalSource,
              issueData.discourseViews,
              issueData.discourseLikeCount,
              issueData.discourseReplyCount,
              'OPEN',
              now,
              issue.id
            ],
            sqlFallback: `UPDATE ReportItemIssue SET summary = ?, detail = ?, importance = ?, categoryGroupId = ?, categoryId = ?, severity = ?, trend = ?, aiClassificationReason = ?, aiClassificationMethod = ?, commentCount = ?, scrapedComments = ?, isHotTopic = ?, requiresLogin = ?, sourceUrl = ?, link = ?, monitoredBoardId = ?, source = ?, externalSource = ?, excludedFromReport = 0, excludedAt = NULL, excludedBy = NULL, processedAt = NULL, processedBy = NULL, status = ?, updatedAt = ? WHERE id = ?`,
            paramsFallback: [
              issueData.summary,
              issueData.detail,
              issueData.importance,
              issueData.categoryGroupId,
              issueData.categoryId,
              issueData.severity,
              issueData.trend,
              issueData.aiClassificationReason,
              issueData.aiClassificationMethod,
              issueData.commentCount,
              issueData.scrapedComments,
              issueData.isHotTopic ? 1 : 0,
              issueData.requiresLogin ? 1 : 0,
              issueData.sourceUrl,
              issueData.link,
              issueData.monitoredBoardId || null,
              issueData.source,
              issueData.externalSource,
              'OPEN',
              now,
              issue.id
            ]
          });
          logger.info('[NaverCafeIssues] Issue restored to open (was excluded from report)', { issueId: issue.id, externalPostId });
        } else {
          // 기존 이슈의 status를 유지 (완료 처리된 이슈가 다시 OPEN으로 변경되지 않도록)
          executeWithColumnFallback({
            fallbackOnColumn: 'discourseViews',
            sqlWith: `UPDATE ReportItemIssue SET summary = ?, detail = ?, importance = ?, categoryGroupId = ?, categoryId = ?, severity = ?, trend = ?, aiClassificationReason = ?, aiClassificationMethod = ?, commentCount = ?, scrapedComments = ?, isHotTopic = ?, requiresLogin = ?, sourceUrl = ?, link = ?, monitoredBoardId = ?, source = ?, externalSource = ?, discourseViews = ?, discourseLikeCount = ?, discourseReplyCount = ?, updatedAt = ? WHERE id = ?`,
            paramsWith: [
              issueData.summary,
              issueData.detail,
              issueData.importance,
              issueData.categoryGroupId,
              issueData.categoryId,
              issueData.severity,
              issueData.trend,
              issueData.aiClassificationReason,
              issueData.aiClassificationMethod,
              issueData.commentCount,
              issueData.scrapedComments,
              issueData.isHotTopic ? 1 : 0,
              issueData.requiresLogin ? 1 : 0,
              issueData.sourceUrl,
              issueData.link,
              issueData.monitoredBoardId || null,
              issueData.source,
              issueData.externalSource,
              issueData.discourseViews,
              issueData.discourseLikeCount,
              issueData.discourseReplyCount,
              now,
              issue.id
            ],
            sqlFallback: `UPDATE ReportItemIssue SET summary = ?, detail = ?, importance = ?, categoryGroupId = ?, categoryId = ?, severity = ?, trend = ?, aiClassificationReason = ?, aiClassificationMethod = ?, commentCount = ?, scrapedComments = ?, isHotTopic = ?, requiresLogin = ?, sourceUrl = ?, link = ?, monitoredBoardId = ?, source = ?, externalSource = ?, updatedAt = ? WHERE id = ?`,
            paramsFallback: [
              issueData.summary,
              issueData.detail,
              issueData.importance,
              issueData.categoryGroupId,
              issueData.categoryId,
              issueData.severity,
              issueData.trend,
              issueData.aiClassificationReason,
              issueData.aiClassificationMethod,
              issueData.commentCount,
              issueData.scrapedComments,
              issueData.isHotTopic ? 1 : 0,
              issueData.requiresLogin ? 1 : 0,
              issueData.sourceUrl,
              issueData.link,
              issueData.monitoredBoardId || null,
              issueData.source,
              issueData.externalSource,
              now,
              issue.id
            ]
          });
        }
        
        issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issue.id]);
        if (issue.categoryGroupId) {
          issue.categoryGroup = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [issue.categoryGroupId]);
        }
        if (issue.categoryId) {
          issue.category = queryOne('SELECT * FROM Category WHERE id = ?', [issue.categoryId]);
        }
        if (issue.monitoredUrlId) {
          issue.monitoredUrl = queryOne('SELECT * FROM MonitoredUrl WHERE id = ?', [issue.monitoredUrlId]);
        }

        logger.info('[NaverCafeIssues] Issue updated', { issueId: issue.id });

        // WebSocket 브로드캐스트
        try {
          broadcastIssueUpdated({
            id: issue.id,
            projectId: issue.projectId,
            status: issue.status,
            assignedAgentId: issue.assignedAgentId,
            assignedAgent: issue.assignedAgent,
            severity: issue.severity,
            checkedAt: issue.checkedAt,
            processedAt: issue.processedAt
          });
        } catch (wsError) {
          logger.warn('[NaverCafeIssues] WebSocket broadcast failed', { error: wsError.message });
        }
      }
    }

    // 본문 이미지 다중 경로·스크린샷 보강 (기존 이슈 재수집·신규 공통)
    const pathsJsonForIssue =
      Array.isArray(postImagePaths) && postImagePaths.length > 0
        ? JSON.stringify(postImagePaths)
        : null;
    if (pathsJsonForIssue && issue && issue.id) {
      const nowImg = nowKSTISOString() || new Date().toISOString();
      const hadUserOrPriorScreenshot =
        issue.screenshotPath != null && String(issue.screenshotPath).trim().length > 0;
      let nextShot = hadUserOrPriorScreenshot
        ? issue.screenshotPath
        : screenshotPath || (postImagePaths && postImagePaths[0]) || null;
      const pathsDirty = pathsJsonForIssue !== (issue.postImagePaths || '');
      const shotDirty =
        String(nextShot || '') !== String(issue.screenshotPath || '');
      if (pathsDirty || shotDirty) {
        execute(
          'UPDATE ReportItemIssue SET postImagePaths = ?, screenshotPath = ?, updatedAt = ? WHERE id = ?',
          [pathsJsonForIssue, nextShot, nowImg, issue.id]
        );
        issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issue.id]);
        if (issue.categoryGroupId) {
          issue.categoryGroup = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [issue.categoryGroupId]);
        }
        if (issue.categoryId) {
          issue.category = queryOne('SELECT * FROM Category WHERE id = ?', [issue.categoryId]);
        }
        if (issue.monitoredUrlId) {
          issue.monitoredUrl = queryOne('SELECT * FROM MonitoredUrl WHERE id = ?', [issue.monitoredUrlId]);
        }
      }
    }

    // 댓글 upsert
    if (comments && Array.isArray(comments)) {
      for (const comment of comments) {
        if (!comment.externalCommentId || !comment.content) continue;

        try {
          // 기존 댓글 확인
          const existingComment = queryOne(
            'SELECT * FROM IssueComment WHERE externalCommentId = ? AND issueId = ?',
            [comment.externalCommentId, issue.id]
          );

          if (existingComment) {
            // 이미 존재하는 댓글은 건너뛰기
            continue;
          }

          // 새 댓글 생성 (한국 시간 기준으로 정확히 저장)
          const commentDate = comment.createdAt || new Date();
          const commentCreatedAt = toKSTISOString(commentDate) || new Date().toISOString();
          execute(
            'INSERT INTO IssueComment (issueId, body, externalCommentId, createdAt) VALUES (?, ?, ?, ?)',
            [issue.id, comment.content, comment.externalCommentId, commentCreatedAt]
          );

          logger.debug('[NaverCafeIssues] Comment created', { 
            issueId: issue.id, 
            externalCommentId: comment.externalCommentId 
          });
        } catch (commentError) {
          logger.warn('[NaverCafeIssues] Failed to create comment', { 
            error: commentError.message,
            externalCommentId: comment.externalCommentId
          });
        }
      }
    }

    return issue;
  } catch (error) {
    logger.error('[NaverCafeIssues] Failed to upsert issue', { 
      error: error.message,
      url,
      externalPostId
    });
    throw error;
  }
}

module.exports = {
  upsertIssueFromNaverCafe,
  DISCOURSE_PLAYINZOI_EXTERNAL_SOURCE,
  DISCOURSE_INZOI_ISSUE_INTEGRATION
};

