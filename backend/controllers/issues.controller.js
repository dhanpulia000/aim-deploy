// Issues 컨트롤러

const issuesService = require('../services/issues.service');
const issueCommentWatchService = require('../services/issueCommentWatch.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const { parseProjectId, parseIntSafe } = require('../utils/parsers');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;
const { generateScreenshotPath, ensureScreenshotDirectory } = require('../utils/fileUtils');
const { resolveAgentDisplayName } = require('../utils/agentDisplayName');
const { fetchListBasedCountsForBoards } = require('../services/boardListDailyCount.service');

function parseBoardIdsQuery(raw) {
  if (raw === undefined || raw === null) return null;
  if (raw === '') return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(',');
  const ids = arr
    .map((v) => parseIntSafe(String(v).trim(), undefined))
    .filter((n) => n !== undefined && n !== null && !Number.isNaN(n));
  return ids; // 길이 0이어도 "선택 없음" 의미로 전달
}

/**
 * 모든 이슈 조회
 */
const getAllIssues = asyncMiddleware(async (req, res) => {
  const {
    agentId,
    startDate,
    endDate,
    severity,
    status,
    category,
    projectId,
    search,
    limit,
    offset
  } = req.query;
  
  const options = {
    agentId: agentId || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    severity: severity ? parseInt(severity) : undefined,
    status: status || undefined,
    category: category || undefined,
    projectId: parseProjectId(projectId),
    search: search || undefined,
    limit: limit ? parseIntSafe(limit) : undefined, // limit이 없으면 undefined (무제한)
    offset: parseIntSafe(offset, 0)
  };
  
  logger.debug('getAllIssues called', { 
    startDate: options.startDate, 
    endDate: options.endDate,
    projectId: options.projectId,
    hasSearch: !!options.search
  });
  
  try {
    const result = await issuesService.getAllIssues(options);
    sendSuccess(res, result, 'Issues retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve issues', { error: error.message });
    sendError(res, 'Failed to retrieve issues', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 특정 에이전트의 이슈 조회
 */
const getIssuesByAgent = asyncMiddleware(async (req, res) => {
  const { agentId } = req.params;
  const {
    startDate,
    endDate,
    severity,
    status,
    category,
    projectId,
    limit,
    offset
  } = req.query;
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  const options = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    severity: severity ? parseInt(severity) : undefined,
    status: status || undefined,
    category: category || undefined,
    projectId: parseProjectId(projectId),
    limit: limit ? parseIntSafe(limit) : undefined, // limit이 없으면 undefined (무제한)
    offset: parseIntSafe(offset, 0)
  };
  
  try {
    const result = await issuesService.getIssuesByAgent(agentId, options);
    sendSuccess(res, result, 'Issues retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve issues by agent', { error: error.message, agentId });
    sendError(res, 'Failed to retrieve issues', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 카테고리별 통계 조회
 */
const getCategoryStatistics = asyncMiddleware(async (req, res) => {
  const {
    agentId,
    startDate,
    endDate,
    projectId
  } = req.query;
  
  const options = {
    agentId: agentId || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    projectId: parseProjectId(projectId)
  };
  
  try {
    const result = await issuesService.getCategoryStatistics(options);
    sendSuccess(res, result, 'Category statistics retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve category statistics', { error: error.message });
    sendError(res, 'Failed to retrieve statistics', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 게임별 이슈 카운트 조회 (빠른 메인 화면용)
 */
const getGameIssueCounts = asyncMiddleware(async (req, res) => {
  const { startDate, endDate, projectId } = req.query;
  const options = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    projectId: parseProjectId(projectId)
  };

  try {
    const result = await issuesService.getGameIssueCounts(options);
    sendSuccess(res, result, 'Game issue counts retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve game issue counts', { error: error.message });
    sendError(res, 'Failed to retrieve game issue counts', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 이슈 확인 (URL 클릭 또는 수동 체크)
 */
const checkIssue = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  const { agentId } = req.body;
  
  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  try {
    const issue = await issuesService.checkIssue(issueId, agentId);
    const publisher = require('../realtime/publisher');
    publisher.broadcastIssueUpdated(issue);
    sendSuccess(res, issue, 'Issue checked successfully');
  } catch (error) {
    logger.error('Failed to check issue', { error: error.message, issueId, agentId });
    sendError(res, 'Failed to check issue', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 이슈 처리 완료 체크
 */
const processIssue = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  const { agentId } = req.body;
  
  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  try {
    const issue = await issuesService.processIssue(issueId, agentId);
    const publisher = require('../realtime/publisher');
    publisher.broadcastIssueUpdated(issue);
    sendSuccess(res, issue, 'Issue processed successfully');
  } catch (error) {
    logger.error('Failed to process issue', { error: error.message, issueId, agentId });
    sendError(res, 'Failed to process issue', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 이슈를 보고서에서 제외 (일일 보고서 및 모니터링 대응에서 제외, 완료 처리)
 */
const excludeFromReport = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  // 안전한 방법: 클라이언트가 보낸 agentId를 신뢰하지 않고,
  // 현재 로그인한 사용자(req.user)에 매핑된 Agent ID를 서버에서 조회한다.
  const currentUserId = req.user?.id;
  
  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }
  
  try {
    // 현재 로그인한 유저 기준 Agent ID 조회
    const agentId = await issuesService.findAgentIdForUser(currentUserId);

    if (!agentId) {
      return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID not found for current user' }]);
    }

    const issue = await issuesService.excludeFromReport(issueId, agentId);
    const publisher = require('../realtime/publisher');
    publisher.broadcastIssueUpdated(issue);
    sendSuccess(res, issue, 'Issue excluded from report and marked as resolved');
  } catch (error) {
    logger.error('Failed to exclude issue from report', { error: error.message, issueId, userId: currentUserId });
    sendError(res, 'Failed to exclude issue from report', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 이슈 상태 업데이트
 */
const updateIssue = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  const updateData = req.body;
  const userId = req.user?.id; // 로그인한 사용자 ID
  
  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }
  
  try {
    const issue = await issuesService.updateIssue(issueId, updateData, userId);
    const publisher = require('../realtime/publisher');
    publisher.broadcastIssueUpdated(issue);
    sendSuccess(res, issue, 'Issue updated successfully');
  } catch (error) {
    logger.error('Failed to update issue', { error: error.message, issueId });
    sendError(res, 'Failed to update issue', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

const assignIssue = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  const { agentId } = req.body || {};
  const projectId = parseProjectId(req.query.projectId);

  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }

  // agentId가 빈 문자열이면 null로 변환 (담당자 해제)
  const normalizedAgentId = agentId === '' || agentId === null || agentId === undefined ? null : agentId;

  try {
    const issue = await issuesService.assignIssue(issueId, normalizedAgentId, projectId);
    
    // WebSocket으로 실시간 업데이트 브로드캐스트
    const publisher = require('../realtime/publisher');
    publisher.broadcastIssueUpdated(issue);
    
    sendSuccess(res, issue, normalizedAgentId ? 'Issue assignment updated' : 'Issue assignment removed');
  } catch (error) {
    logger.error('Failed to assign issue', { error: error.message, issueId, agentId: normalizedAgentId });
    sendError(res, error.message || 'Failed to assign issue', HTTP_STATUS.BAD_REQUEST);
  }
});

const updateIssueStatus = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  const { status } = req.body || {};
  const projectId = parseProjectId(req.query.projectId);

  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }

  if (!status) {
    return sendValidationError(res, [{ field: 'status', message: 'Status is required' }]);
  }

  try {
    // 이전 상태 조회
    const oldIssue = await issuesService.getIssueById(issueId);
    const oldStatus = oldIssue?.status;

    // RESOLVED/VERIFIED로 변경되는 경우 성과 분석 집계를 위해 processedAt/processedBy도 함께 기록한다.
    // 클라이언트 입력을 신뢰하지 않고, 현재 로그인 사용자(req.user) 기준으로 Agent ID를 서버에서 조회한다.
    let agentId = null;
    const normalizedStatus = String(status || '').toUpperCase();
    if (normalizedStatus === 'RESOLVED' || normalizedStatus === 'VERIFIED') {
      const currentUserId = req.user?.id;
      agentId = await issuesService.findAgentIdForUser(currentUserId);
      if (!agentId) {
        logger.warn('[Issues] Agent not found for current user while marking processed fields', {
          issueId,
          userId: currentUserId,
          status: normalizedStatus
        });
      }
    }

    const issue = await issuesService.updateIssueStatus(issueId, status, projectId, agentId);
    
    // 감사 로그 기록
    const auditService = require('../services/audit.service');
    await auditService.createAuditLog('ISSUE_STATUS_CHANGE', req.user?.id || null, {
      issueId,
      oldStatus,
      newStatus: status,
      projectId
    }).catch(err => logger.error('Failed to create audit log', { error: err.message }));
    
    // WebSocket으로 실시간 업데이트 브로드캐스트
    const publisher = require('../realtime/publisher');
    publisher.broadcastIssueUpdated(issue);
    
    sendSuccess(res, issue, 'Issue status updated');
  } catch (error) {
    logger.error('Failed to update issue status', { error: error.message, issueId, status });
    sendError(res, error.message || 'Failed to update status', HTTP_STATUS.BAD_REQUEST);
  }
});

const getIssueComments = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  const projectId = parseProjectId(req.query.projectId);

  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }

  try {
    const comments = await issuesService.getIssueComments(issueId, projectId);
    sendSuccess(res, comments, 'Issue comments retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve issue comments', { error: error.message, issueId });
    sendError(res, error.message || 'Failed to load comments', HTTP_STATUS.BAD_REQUEST);
  }
});

const addIssueComment = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  const { body } = req.body || {};
  const projectId = parseProjectId(req.query.projectId);

  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }

  if (!body) {
    return sendValidationError(res, [{ field: 'body', message: 'Comment body is required' }]);
  }

  try {
    const currentUserId = req.user?.id;
    const authorAgentId = await issuesService.findAgentIdForUser(currentUserId);
    const comment = await issuesService.addIssueComment(issueId, body, authorAgentId, projectId);
    const issue = await issuesService.getIssueById(issueId);
    if (issue) {
      const publisher = require('../realtime/publisher');
      publisher.broadcastIssueUpdated(issue);
    }
    sendSuccess(res, comment, 'Comment added successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to add comment', { error: error.message, issueId });
    sendError(res, error.message || 'Failed to add comment', HTTP_STATUS.BAD_REQUEST);
  }
});

/**
 * 이슈 공유 로그 조회
 */
const getIssueShareLogs = asyncMiddleware(async (req, res) => {
  const { id: issueId } = req.params;

  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }

  try {
    const { query } = require('../libs/db');

    const shareLogs = query(
      `SELECT sl.*, a.id as agent_id, a.name as agent_name
       FROM IssueShareLog sl
       LEFT JOIN Agent a ON sl.agentId = a.id
       WHERE sl.issueId = ?
       ORDER BY sl.sentAt DESC`,
      [issueId]
    );

    // Agent 정보를 평탄화
    const formattedLogs = shareLogs.map(log => ({
      id: log.id,
      issueId: log.issueId,
      agentId: log.agentId,
      agentName: log.agent_name || null,
      target: log.target,
      sentAt: log.sentAt ? new Date(log.sentAt).toISOString() : null,
      status: log.status,
      messageSnapshot: log.messageSnapshot,
      errorMessage: log.errorMessage,
      createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : null
    }));

    sendSuccess(res, formattedLogs, 'Share logs retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve share logs', { error: error.message, issueId });
    sendError(res, error.message || 'Failed to retrieve share logs', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * 이슈를 Slack으로 공유
 */
const shareIssue = asyncMiddleware(async (req, res) => {
  const { id: issueId } = req.params;
  const { target, customMessage, channel } = req.body || {};

  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }

  try {
    const { queryOne, execute } = require('../libs/db');
    const slackService = require('../services/slack.service');
    const publisher = require('../realtime/publisher');

    // 1. 이슈 정보 조회 (screenshotPath 포함)
    const issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
    
    if (issue) {
      if (issue.categoryGroupId) {
        issue.categoryGroup = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [issue.categoryGroupId]);
      }
      if (issue.categoryId) {
        issue.category = queryOne('SELECT * FROM Category WHERE id = ?', [issue.categoryId]);
      }
      if (issue.assignedAgentId) {
        const ag = queryOne('SELECT * FROM Agent WHERE id = ?', [issue.assignedAgentId]);
        if (ag) {
          issue.assignedAgent = { ...ag, name: resolveAgentDisplayName(ag.name, ag.email) };
        }
      }
    }

    if (!issue) {
      return sendError(res, 'Issue not found', HTTP_STATUS.NOT_FOUND);
    }

    // 2. 현재 로그인한 사용자의 Agent ID 찾기 (선택적)
    const currentUserId = req.user?.id;
    let agentId = null;
    
    if (currentUserId) {
      agentId = await issuesService.findAgentIdForUser(currentUserId);
      // Agent가 없어도 슬랙 공유는 가능 (로그 기록용이므로)
      if (!agentId) {
        logger.warn('Agent not found for user, proceeding without agent ID', { userId: currentUserId });
      }
    }

    // 3. Slack 메시지 전송
    let shareResult;
    let shareStatus = 'SUCCESS';
    let errorMessage = null;

    // 디버깅: screenshotPath 확인
    logger.info('Sharing issue to Slack', {
      issueId,
      screenshotPath: issue.screenshotPath,
      hasScreenshot: !!issue.screenshotPath,
      channel
    });

          try {
            shareResult = await slackService.shareIssue(issue, {
              target: target || 'Client_Channel',
              customMessage,
              channel,
              shareForm: req.body.shareForm, // 구조화된 폼 데이터 전달
              mentionedUserIds: req.body.mentionedUserIds || [], // 멘션할 사용자 ID 목록
              excludeImage: req.body.excludeImage || false, // 이미지 제외 옵션
              videoPath: req.body.videoPath || null // 비디오 경로
            });
    } catch (slackError) {
      logger.error('Failed to send Slack message', {
        error: slackError.message,
        issueId,
        agentId
      });
      shareStatus = 'FAILED';
      errorMessage = slackError.message;
      throw slackError; // 에러를 다시 throw하여 catch 블록에서 처리
    }

    // 4. 공유 로그 저장
    const messageSnapshot = JSON.stringify({
      text: shareResult.response?.message?.text || shareResult.text,
      blocks: shareResult.response?.message?.blocks || shareResult.blocks,
      attachments: shareResult.response?.message?.attachments || shareResult.attachments
    });

    const { nanoid } = require('nanoid');
    const logId = nanoid();
    const now = new Date().toISOString();
    
    // agentId가 null일 수 있으므로 명시적으로 처리
    const finalAgentId = agentId || null;
    
    execute(
      'INSERT INTO IssueShareLog (id, issueId, agentId, target, status, messageSnapshot, errorMessage, sentAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [logId, issue.id, finalAgentId, target || 'Client_Channel', shareStatus, messageSnapshot, errorMessage, now, now, now]
    );
    
    const shareLog = queryOne('SELECT * FROM IssueShareLog WHERE id = ?', [logId]);
    if (shareLog.agentId) {
      const ag = queryOne('SELECT id, name, email FROM Agent WHERE id = ?', [shareLog.agentId]);
      shareLog.agent = ag
        ? { id: ag.id, name: resolveAgentDisplayName(ag.name, ag.email) }
        : null;
    }

    // 5. 이슈 상태 업데이트 (선택적 - 필요시 주석 해제)
    // await prisma.reportItemIssue.update({
    //   where: { id: issueId },
    //   data: { status: 'SHARED' }
    // });

    // 6. WebSocket으로 이벤트 브로드캐스트
    publisher.broadcastIssueUpdated({
      ...issue,
      shareLog: {
        id: shareLog.id,
        sentAt: shareLog.sentAt,
        agent: shareLog.agent
      }
    });

    logger.info('Issue shared to Slack', {
      issueId,
      agentId,
      target: target || 'Client_Channel',
      status: shareStatus
    });

    sendSuccess(res, {
      shareLog,
      slackResult: shareResult
    }, 'Issue shared successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    logger.error('Failed to share issue', { error: error.message, issueId });
    sendError(res, error.message || 'Failed to share issue', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * 슬랙 채널 목록 가져오기
 */
const getSlackChannels = asyncMiddleware(async (req, res) => {
  try {
    const slackService = require('../services/slack.service');
    const channels = await slackService.getChannels();
    sendSuccess(res, channels, 'Slack channels retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve Slack channels', { error: error.message });
    sendError(res, error.message || 'Failed to retrieve Slack channels', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * 슬랙 사용자 목록 가져오기
 */
const getSlackUsers = asyncMiddleware(async (req, res) => {
  try {
    const slackService = require('../services/slack.service');
    logger.info('[IssuesController] Fetching Slack users');
    const users = await slackService.getUsers();
    logger.info('[IssuesController] Slack users retrieved', { count: users?.length || 0 });
    sendSuccess(res, users, 'Slack users retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve Slack users', { 
      error: error.message,
      stack: error.stack,
      code: error.code
    });
    sendError(res, error.message || 'Failed to retrieve Slack users', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * 이슈에 비디오 업로드 (캡처 클립용)
 */
const uploadIssueVideo = asyncMiddleware(async (req, res) => {
  const { id: issueId } = req.params;
  const file = req.file;

  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }

  if (!file) {
    return sendValidationError(res, [{ field: 'file', message: 'Video file is required' }]);
  }

  // 비디오 파일만 허용
  if (!file.mimetype.startsWith('video/')) {
    return sendValidationError(res, [{ field: 'file', message: 'Only video files are allowed' }]);
  }

  try {
    const { queryOne } = require('../libs/db');
    const { generateScreenshotPath, ensureScreenshotDirectory } = require('../utils/fileUtils');

    // 이슈 확인
    const issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);

    if (!issue) {
      return sendError(res, 'Issue not found', HTTP_STATUS.NOT_FOUND);
    }

    // 비디오 경로 생성 (screenshots 폴더와 동일한 구조 사용)
    const articleId = issue.externalPostId || issueId;
    const pathInfo = generateScreenshotPath(articleId);
    await ensureScreenshotDirectory(pathInfo.uploadsDir);

    // 비디오 파일명 생성 (확장자 유지)
    const ext = path.extname(file.originalname) || '.mp4';
    const videoFileName = `video_${articleId}${ext}`;
    const videoRelativePath = `screenshots/${pathInfo.dateFolder}/${videoFileName}`;
    const videoFullPath = path.join(pathInfo.uploadsDir, videoFileName);

    // 업로드된 임시 파일 경로
    const tempPath = file.path;

    if (!tempPath) {
      throw new Error('Uploaded file path is missing');
    }

    // 임시 파일을 최종 비디오 경로로 복사
    await fs.copyFile(tempPath, videoFullPath);

    // 임시 파일 삭제
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      logger.warn('[IssueVideo] Failed to remove temp upload file', {
        error: cleanupError.message,
        tempPath
      });
    }

    logger.info('[IssueVideo] Video uploaded successfully', {
      issueId,
      videoPath: videoRelativePath,
      fileSize: file.size,
      mimetype: file.mimetype
    });

    const publisher = require('../realtime/publisher');
    publisher.broadcastIssueUpdated(issue);

    sendSuccess(res, {
      videoPath: videoRelativePath,
      message: 'Video uploaded successfully'
    }, 'Video uploaded successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    logger.error('[IssueVideo] Failed to upload video', {
      error: error.message,
      issueId,
      stack: error.stack
    });
    sendError(res, error.message || 'Failed to upload video', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * 이슈에 이미지 업로드 (클립보드 붙여넣기용)
 */
const uploadIssueImage = asyncMiddleware(async (req, res) => {
  const { id: issueId } = req.params;
  const file = req.file;

  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }

  if (!file) {
    return sendValidationError(res, [{ field: 'file', message: 'Image file is required' }]);
  }

  // 이미지 파일만 허용
  if (!file.mimetype.startsWith('image/')) {
    return sendValidationError(res, [{ field: 'file', message: 'Only image files are allowed' }]);
  }

  try {
    const { queryOne, execute } = require('../libs/db');

    // 이슈 확인
    const issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);

    if (!issue) {
      return sendError(res, 'Issue not found', HTTP_STATUS.NOT_FOUND);
    }

    // 스크린샷 경로 생성 (최종 저장 위치)
    const articleId = issue.externalPostId || issueId;
    const pathInfo = generateScreenshotPath(articleId);
    await ensureScreenshotDirectory(pathInfo.uploadsDir);

    // 업로드된 임시 파일 경로 (multer diskStorage 사용)
    // createFileUploadMiddleware 에서 destination 으로 지정한 경로에 저장됨
    const tempPath = file.path;

    if (!tempPath) {
      throw new Error('Uploaded file path is missing');
    }

    // 임시 파일을 최종 스크린샷 경로로 복사
    await fs.copyFile(tempPath, pathInfo.fullPath);

    // 임시 파일 삭제 (실패해도 치명적이지 않으므로 에러는 무시)
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      logger.warn('[IssueImage] Failed to remove temp upload file', {
        error: cleanupError.message,
        tempPath
      });
    }

    // DB 업데이트
    execute(
      'UPDATE ReportItemIssue SET screenshotPath = ?, updatedAt = ? WHERE id = ?',
      [pathInfo.relativePath, new Date().toISOString(), issueId]
    );

    const updated = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
    if (updated) {
      const publisher = require('../realtime/publisher');
      publisher.broadcastIssueUpdated(updated);
    }

    logger.info('[IssueImage] Image uploaded successfully', {
      issueId,
      screenshotPath: pathInfo.relativePath,
      fileSize: file.size,
      mimetype: file.mimetype
    });

    sendSuccess(res, {
      screenshotPath: pathInfo.relativePath,
      message: 'Image uploaded successfully'
    }, 'Image uploaded successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    logger.error('[IssueImage] Failed to upload image', {
      error: error.message,
      issueId,
      stack: error.stack
    });
    sendError(res, `Failed to upload image: ${error.message}`, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * Sentiment 분석
 */
const analyzeSentiment = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  const { projectId } = req.query;
  
  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'Issue ID is required' }]);
  }
  
  try {
    const issue = await issuesService.getIssueById(issueId);
    if (!issue) {
      return sendError(res, 'Issue not found', HTTP_STATUS.NOT_FOUND);
    }
    
    // 이슈 내용 가져오기
    const text = [issue.summary, issue.detail].filter(Boolean).join('\n\n');
    if (!text || text.trim().length === 0) {
      return sendError(res, 'Issue has no content to analyze', HTTP_STATUS.BAD_REQUEST);
    }
    
    // AI 분석 서비스 호출
    const { analyzeSentimentWithAI } = require('../services/aiIssueClassifier');
    const result = await analyzeSentimentWithAI({ text });
    
    if (!result) {
      return sendError(res, 'Sentiment analysis failed. Please check AI API configuration.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
    
    // 분석 결과를 이슈에 저장
    const parsedProjectId = parseProjectId(projectId);
    await issuesService.updateIssue(issueId, {
      sentiment: result.sentiment,
      aiClassificationReason: result.reason || null,
      aiClassificationMethod: 'AI'
    }, parsedProjectId);

    const updated = await issuesService.getIssueById(issueId);
    if (updated) {
      const publisher = require('../realtime/publisher');
      publisher.broadcastIssueUpdated(updated);
    }

    sendSuccess(res, result, 'Sentiment analyzed successfully');
  } catch (error) {
    logger.error('Failed to analyze sentiment', { error: error.message, issueId });
    sendError(res, 'Failed to analyze sentiment', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 클랜 게시글 조회
 */
const getClanIssues = asyncMiddleware(async (req, res) => {
  const {
    startDate,
    endDate,
    projectId,
    limit,
    offset,
    ids
  } = req.query;
  
  const options = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    projectId: parseProjectId(projectId),
    limit: limit ? parseIntSafe(limit) : undefined,
    offset: parseIntSafe(offset, 0),
    ids: ids ? String(ids).split(',').map(s => s.trim()).filter(Boolean) : undefined
  };
  
  try {
    const result = await issuesService.getClanIssues(options);
    sendSuccess(res, result, 'Clan issues retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve clan issues', { error: error.message });
    sendError(res, 'Failed to retrieve clan issues', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 카드 교환 게시글 조회
 */
const getCardExchangeIssues = asyncMiddleware(async (req, res) => {
  const { startDate, endDate, projectId, limit, offset } = req.query;

  const options = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    projectId: parseProjectId(projectId),
    limit: limit ? parseIntSafe(limit) : undefined,
    offset: parseIntSafe(offset, 0)
  };

  try {
    const result = await issuesService.getCardExchangeIssues(options);
    sendSuccess(res, result, 'Card exchange issues retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve card exchange issues', { error: error.message });
    sendError(res, 'Failed to retrieve card exchange issues', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 카드 교환 일별 건수 (수집일 KST)
 */
const getCardExchangeDailyIngestCounts = asyncMiddleware(async (req, res) => {
  const { startDate, endDate, projectId } = req.query;
  if (!startDate || !endDate) {
    sendError(res, 'startDate and endDate are required (YYYY-MM-DD)', HTTP_STATUS.BAD_REQUEST);
    return;
  }

  try {
    const result = issuesService.getCardExchangeDailyIngestCounts({
      startDate: String(startDate),
      endDate: String(endDate),
      projectId: parseProjectId(projectId)
    });
    sendSuccess(res, result, 'Card exchange daily ingest counts retrieved');
  } catch (error) {
    logger.error('Failed to retrieve card exchange daily counts', { error: error.message });
    sendError(res, 'Failed to retrieve card exchange daily counts', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 모니터링 게시판별 이슈 건수 (클랜·카드 교환 목록과 동일 날짜 OR; 카드 교환 보드 1개일 때 목록 총건과 행 건수 정렬)
 */
const getMonitoredBoardIssueStats = asyncMiddleware(async (req, res) => {
  const { startDate, endDate, projectId, includeInactive, includeListBased, maxPages, boardIds } = req.query;
  const parsedBoardIds = parseBoardIdsQuery(boardIds);

  try {
    const result = issuesService.getMonitoredBoardIssueStats({
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      projectId: parseProjectId(projectId),
      includeInactiveBoards: String(includeInactive || '').toLowerCase() === 'true',
      boardIds: parsedBoardIds
    });

    result.listBasedIncluded = false;
    const wantListBased = String(includeListBased || '').toLowerCase() === 'true';
    if (wantListBased && result.boards?.length) {
      const hasAnyDateFilter = Boolean(startDate) || Boolean(endDate);
      const sameDay = Boolean(startDate) && Boolean(endDate) && String(startDate) === String(endDate);
      // FE 메뉴 스캔은 누락 가능성이 있어서, 날짜가 들어오면 최소 스캔 페이지 수를 보장
      const defaultMaxPages = hasAnyDateFilter ? (sameDay ? 12 : 10) : 2;
      const requestedMaxPages =
        maxPages !== undefined && maxPages !== null && String(maxPages).trim() !== ''
          ? parseIntSafe(maxPages, defaultMaxPages)
          : defaultMaxPages;
      const maxPagesNum = Math.max(requestedMaxPages || defaultMaxPages, defaultMaxPages);
      const listMap = await fetchListBasedCountsForBoards(result.boards, {
        maxPages: maxPagesNum,
        timeoutMs: 90000,
        startDate: startDate ? String(startDate) : null,
        endDate: endDate ? String(endDate) : null
      });
      result.boards = result.boards.map((b) => {
        const extra = listMap.get(Number(b.id)) || {};
        return {
          ...b,
          listBasedCount: extra.listBasedCount ?? null,
          listBasedTotalRows: extra.listBasedTotalRows ?? 0,
          listBasedSkipped: extra.listBasedSkipped ?? null,
          listBasedError: extra.listBasedError ?? null,
          listBasedFromDb: extra.listBasedFromDb === true
        };
      });
      result.totalListBasedCountInRange = result.boards.reduce(
        (s, r) => s + (typeof r.listBasedCount === 'number' ? r.listBasedCount : 0),
        0
      );
      result.listBasedIncluded = true;
    }

    sendSuccess(res, result, 'Monitored board issue stats retrieved');
  } catch (error) {
    logger.error('Failed to retrieve monitored board issue stats', { error: error.message });
    sendError(
      res,
      'Failed to retrieve monitored board issue stats',
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
});

/**
 * 동일 출처/동일 제목 이슈 그룹 조회 (따로 관리용)
 */
const getSameContentGroups = asyncMiddleware(async (req, res) => {
  const { projectId, startDate, endDate } = req.query;
  const options = {
    projectId: parseProjectId(projectId),
    startDate: startDate || undefined,
    endDate: endDate || undefined
  };
  try {
    const result = await issuesService.getSameContentGroups(options);
    sendSuccess(res, result, 'Same-content groups retrieved');
  } catch (error) {
    logger.error('Failed to get same-content groups', { error: error.message });
    sendError(res, 'Failed to get same-content groups', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * GET /api/issues/comment-watches
 * @desc 댓글 관리 모드(네이버 카페)로 등록된 이슈 목록
 * @query {boolean|string} enabledOnly - 기본 true
 * @query {number} projectId - 선택 (현재 프로젝트 필터)
 */
const getCommentWatches = asyncMiddleware(async (req, res) => {
  const enabledOnlyRaw = req.query.enabledOnly;
  const enabledOnly =
    enabledOnlyRaw === undefined ? true : String(enabledOnlyRaw).toLowerCase() === 'true';

  const projectId = parseProjectId(req.query.projectId);
  const limit = req.query.limit ? parseIntSafe(req.query.limit) : 50;
  const offset = req.query.offset ? parseIntSafe(req.query.offset, 0) : 0;

  try {
    const result = issueCommentWatchService.getCommentWatches({
      enabledOnly,
      projectId,
      limit,
      offset
    });
    sendSuccess(res, result, 'Comment watch list retrieved successfully');
  } catch (error) {
    logger.error('Failed to get comment watches', { error: error.message });
    sendError(res, 'Failed to get comment watches', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * GET /api/issues/:issueId — 단일 이슈 상세 (commentWatch 포함)
 */
const getIssue = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  const projectId = parseProjectId(req.query.projectId);
  try {
    const issue = await issuesService.getIssueDetailForClient(issueId, projectId);
    if (!issue) {
      return sendError(res, 'Issue not found', HTTP_STATUS.NOT_FOUND);
    }
    sendSuccess(res, issue, 'Issue retrieved successfully');
  } catch (error) {
    logger.error('Failed to get issue', { error: error.message, issueId });
    sendError(res, 'Failed to get issue', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

const getCommentWatch = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  const projectId = parseProjectId(req.query.projectId);
  try {
    const issue = await issuesService.getIssueDetailForClient(issueId, projectId);
    if (!issue) {
      return sendError(res, 'Issue not found', HTTP_STATUS.NOT_FOUND);
    }
    sendSuccess(res, { watch: issue.commentWatch || null }, 'Comment watch retrieved');
  } catch (error) {
    logger.error('Failed to get comment watch', { error: error.message, issueId });
    sendError(res, 'Failed to get comment watch', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

const patchCommentWatch = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;
  const projectId = parseProjectId(req.query.projectId);
  try {
    const { watch } = issueCommentWatchService.upsertCommentWatch(issueId, req.body, projectId);
    sendSuccess(res, { watch }, 'Comment watch updated');
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return sendError(res, error.message, HTTP_STATUS.NOT_FOUND);
    }
    if (error.code === 'FORBIDDEN_PROJECT') {
      return sendError(res, error.message, HTTP_STATUS.NOT_FOUND);
    }
    if (error.code === 'invalid_url') {
      return sendError(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }
    logger.error('Failed to update comment watch', { error: error.message, issueId });
    sendError(res, error.message || 'Failed to update comment watch', HTTP_STATUS.BAD_REQUEST);
  }
});

module.exports = {
  getAllIssues,
  getIssuesByAgent,
  getCategoryStatistics,
  getGameIssueCounts,
  checkIssue,
  processIssue,
  excludeFromReport,
  updateIssue,
  assignIssue,
  updateIssueStatus,
  getIssueComments,
  addIssueComment,
  getIssueShareLogs,
  shareIssue,
  getSlackChannels,
  uploadIssueImage,
  uploadIssueVideo,
  analyzeSentiment,
  getSlackUsers,
  getClanIssues,
  getCardExchangeIssues,
  getCardExchangeDailyIngestCounts,
  getMonitoredBoardIssueStats,
  getSameContentGroups,
  getCommentWatches,
  getIssue,
  getCommentWatch,
  patchCommentWatch
};
