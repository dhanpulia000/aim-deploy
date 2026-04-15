// 고객사 피드백 공지사항 컨트롤러

const { query, queryOne, execute } = require('../libs/db');
const { sendError, sendSuccess, HTTP_STATUS } = require('../utils/http');
const { parseProjectId } = require('../utils/parsers');
const logger = require('../utils/logger');
const { resolveAgentDisplayName } = require('../utils/agentDisplayName');
const {
  getNoticeGuideSyncService
} = require('../services/noticeGuideSync.service');

const noticeGuideSyncService = getNoticeGuideSyncService();

/**
 * 모든 공지사항 조회 (활성화된 것만, 최신순)
 * 열람 정보 포함
 */
async function getAllNotices(req, res) {
  try {
    const { includeInactive, projectId } = req.query;
    
    let sql = 'SELECT * FROM CustomerFeedbackNotice WHERE 1=1';
    const params = [];
    
    if (includeInactive !== 'true') {
      sql += ' AND isActive = ?';
      params.push(1);
    }
    
    sql += ' ORDER BY noticeDate DESC';
    
    const notices = query(sql, params);
    
    // 각 공지의 열람 정보 조회
    const noticeIds = notices.map(n => n.id);
    let reads = [];
    if (noticeIds.length > 0) {
      const placeholders = noticeIds.map(() => '?').join(',');
      reads = query(
        `SELECT r.*, a.id as agent_id, a.name as agent_name, a.email as agent_email
         FROM CustomerFeedbackNoticeRead r
         LEFT JOIN Agent a ON r.agentId = a.id
         WHERE r.noticeId IN (${placeholders})`,
        noticeIds
      );
    }
    
    // 열람 정보를 공지별로 그룹화
    const readsByNotice = {};
    reads.forEach(read => {
      if (!readsByNotice[read.noticeId]) {
        readsByNotice[read.noticeId] = [];
      }
      readsByNotice[read.noticeId].push({
        ...read,
        agent: read.agent_id
          ? {
              id: read.agent_id,
              name: resolveAgentDisplayName(read.agent_name, read.agent_email),
            }
          : null,
      });
    });

    // 프로젝트의 모든 에이전트 가져오기 (열람/미열람 구분용)
    // projectId가 있으면 해당 프로젝트, 없으면 전체 활성 에이전트를 기준으로 사용
    let allAgents = [];
    if (projectId) {
      allAgents = query(
        'SELECT id, name, email FROM Agent WHERE projectId = ? AND isActive = ?',
        [parseProjectId(projectId), 1]
      );
    } else {
      allAgents = query(
        'SELECT id, name, email FROM Agent WHERE isActive = ?',
        [1]
      );
    }

    // 각 공지에 대해 열람/미열람 에이전트 정보 추가
    const noticesWithReadStatus = notices.map(notice => {
      const noticeReads = readsByNotice[notice.id] || [];
      const readAgentIds = noticeReads.map(read => read.agentId).filter(Boolean);
      const readAgents = noticeReads
        .filter(read => read.agent)
        .map(read => ({
          id: read.agent.id,
          name: read.agent.name,
          readAt: read.readAt,
        }));
      const unreadAgents = allAgents
        .filter(agent => !readAgentIds.includes(agent.id))
        .map(agent => ({
          id: agent.id,
          name: resolveAgentDisplayName(agent.name, agent.email),
        }));

      return {
        ...notice,
        isActive: Boolean(notice.isActive),
        readAgents,
        unreadAgents,
      };
    });

    return sendSuccess(res, noticesWithReadStatus);
  } catch (error) {
    logger.error('Failed to fetch feedback notices', { 
      error: error.message,
      stack: error.stack
    });
    return sendError(res, '공지사항 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 공지사항 생성
 */
async function createNotice(req, res) {
  try {
    const { title, gameName, managerName, category, content, noticeDate, url, screenshotPath, slackChannelId, slackTeamId } = req.body;

    if (!gameName || !managerName || !category || !content || !noticeDate) {
      return sendError(res, '필수 필드가 누락되었습니다. (게임명, 담당자명, 카테고리, 내용, 날짜)', HTTP_STATUS.BAD_REQUEST);
    }

    const now = new Date().toISOString();
    const titleVal = title != null ? String(title).trim() : '';
    const result = execute(
      'INSERT INTO CustomerFeedbackNotice (title, gameName, managerName, category, content, noticeDate, url, screenshotPath, slackChannelId, slackTeamId, createdBy, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        titleVal,
        gameName.trim(),
        managerName.trim(),
        category.trim(),
        content.trim(),
        new Date(noticeDate).toISOString(),
        (url && String(url).trim()) || null,
        screenshotPath || null,
        slackChannelId || null,
        slackTeamId || null,
        req.user?.id?.toString() || null,
        1,
        now,
        now
      ]
    );

    const notice = queryOne('SELECT * FROM CustomerFeedbackNotice WHERE id = ?', [result.lastInsertRowid]);

    // RAG 동기화: 공지 → WorkGuide + 임베딩
    try {
      await noticeGuideSyncService.syncFromNotice(notice);
    } catch (syncError) {
      logger.warn('[NoticeGuideSync] Failed to sync notice on create', {
        noticeId: notice.id,
        error: syncError.message
      });
    }

    logger.info('Feedback notice created', { noticeId: notice.id });
    return sendSuccess(res, notice, HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create feedback notice', { 
      error: error.message,
      stack: error.stack
    });
    return sendError(res, '공지사항 생성 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 공지사항 수정
 */
async function updateNotice(req, res) {
  try {
    const { id } = req.params;
    const { title, gameName, managerName, category, content, noticeDate, isActive, endedAt, url, screenshotPath, slackChannelId, slackTeamId } = req.body;

    const updateFields = [];
    const params = [];

    if (title !== undefined) {
      updateFields.push('title = ?');
      const normalizedTitle = title == null ? '' : String(title).trim();
      params.push(normalizedTitle.length ? normalizedTitle : null);
    }
    if (gameName !== undefined) {
      updateFields.push('gameName = ?');
      const normalized = gameName == null ? '' : String(gameName).trim();
      if (!normalized) {
        return sendError(res, '게임명은 필수입니다.', HTTP_STATUS.BAD_REQUEST);
      }
      params.push(normalized);
    }
    if (managerName !== undefined) {
      updateFields.push('managerName = ?');
      const normalized = managerName == null ? '' : String(managerName).trim();
      if (!normalized) {
        return sendError(res, '담당자명은 필수입니다.', HTTP_STATUS.BAD_REQUEST);
      }
      params.push(normalized);
    }
    if (category !== undefined) {
      updateFields.push('category = ?');
      const normalized = category == null ? '' : String(category).trim();
      if (!normalized) {
        return sendError(res, '카테고리는 필수입니다.', HTTP_STATUS.BAD_REQUEST);
      }
      params.push(normalized);
    }
    if (content !== undefined) {
      updateFields.push('content = ?');
      const normalized = content == null ? '' : String(content).trim();
      if (!normalized) {
        return sendError(res, '내용은 필수입니다.', HTTP_STATUS.BAD_REQUEST);
      }
      params.push(normalized);
    }
    if (noticeDate !== undefined) {
      updateFields.push('noticeDate = ?');
      const normalized = noticeDate == null ? '' : String(noticeDate).trim();
      if (!normalized) {
        return sendError(res, '공지 날짜는 필수입니다.', HTTP_STATUS.BAD_REQUEST);
      }
      const parsed = new Date(normalized);
      if (Number.isNaN(parsed.getTime())) {
        return sendError(res, '유효하지 않은 공지 날짜입니다.', HTTP_STATUS.BAD_REQUEST);
      }
      params.push(parsed.toISOString());
    }
    if (isActive !== undefined) {
      updateFields.push('isActive = ?');
      params.push(isActive ? 1 : 0);
    }
    if (endedAt !== undefined) {
      updateFields.push('endedAt = ?');
      const normalized = endedAt == null ? '' : String(endedAt).trim();
      if (!normalized) {
        params.push(null);
      } else {
        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) {
          return sendError(res, '유효하지 않은 종료 날짜입니다.', HTTP_STATUS.BAD_REQUEST);
        }
        params.push(parsed.toISOString());
      }
    }
    if (url !== undefined) {
      updateFields.push('url = ?');
      params.push(url != null && String(url).trim() !== '' ? String(url).trim() : null);
    }
    if (screenshotPath !== undefined) {
      updateFields.push('screenshotPath = ?');
      params.push(screenshotPath);
    }
    if (slackChannelId !== undefined) {
      updateFields.push('slackChannelId = ?');
      params.push(slackChannelId);
    }
    if (slackTeamId !== undefined) {
      updateFields.push('slackTeamId = ?');
      params.push(slackTeamId);
    }
    
    if (updateFields.length === 0) {
      const notice = queryOne('SELECT * FROM CustomerFeedbackNotice WHERE id = ?', [parseInt(id)]);
      return sendSuccess(res, notice);
    }
    
    updateFields.push('updatedAt = ?');
    params.push(new Date().toISOString());
    params.push(parseInt(id));
    
    execute(
      `UPDATE CustomerFeedbackNotice SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );

    const notice = queryOne('SELECT * FROM CustomerFeedbackNotice WHERE id = ?', [parseInt(id)]);
    if (!notice) {
      return sendError(res, '공지사항을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
    }

    // RAG 동기화: 공지 → WorkGuide + 임베딩
    try {
      await noticeGuideSyncService.syncFromNotice(notice);
    } catch (syncError) {
      logger.warn('[NoticeGuideSync] Failed to sync notice on update', {
        noticeId: notice.id,
        error: syncError.message
      });
    }
    
    logger.info('Feedback notice updated', { noticeId: notice.id });
    return sendSuccess(res, notice);
  } catch (error) {
    logger.error('Failed to update feedback notice', { 
      error: error.message,
      stack: error.stack
    });
    return sendError(res, '공지사항 수정 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 공지사항 종료 처리 (endedAt 설정)
 */
async function endNotice(req, res) {
  try {
    const { id } = req.params;
    const notice = queryOne('SELECT * FROM CustomerFeedbackNotice WHERE id = ?', [parseInt(id)]);
    if (!notice) {
      return sendError(res, '공지사항을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
    }
    const now = new Date().toISOString();
    execute('UPDATE CustomerFeedbackNotice SET endedAt = ?, updatedAt = ? WHERE id = ?', [now, now, parseInt(id)]);
    const updated = queryOne('SELECT * FROM CustomerFeedbackNotice WHERE id = ?', [parseInt(id)]);
    logger.info('Feedback notice ended', { noticeId: id });
    return sendSuccess(res, updated);
  } catch (error) {
    logger.error('Failed to end feedback notice', { error: error.message, stack: error.stack });
    return sendError(res, '공지사항 종료 처리 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 공지사항 삭제
 */
async function deleteNotice(req, res) {
  try {
    const { id } = req.params;

    const notice = queryOne('SELECT * FROM CustomerFeedbackNotice WHERE id = ?', [parseInt(id)]);
    if (!notice) {
      return sendError(res, '공지사항을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
    }

    // RAG 동기화: 대응 가이드 삭제
    try {
      await noticeGuideSyncService.deleteForNotice(parseInt(id));
    } catch (syncError) {
      logger.warn('[NoticeGuideSync] Failed to delete notice guide on delete', {
        noticeId: id,
        error: syncError.message
      });
    }

    execute('DELETE FROM CustomerFeedbackNotice WHERE id = ?', [parseInt(id)]);

    logger.info('Feedback notice deleted', { noticeId: id });
    return sendSuccess(res, { message: '공지사항이 삭제되었습니다.' });
  } catch (error) {
    logger.error('Failed to delete feedback notice', { 
      error: error.message,
      stack: error.stack
    });
    return sendError(res, '공지사항 삭제 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 공지사항 열람 기록
 */
async function markNoticeAsRead(req, res) {
  try {
    const { id } = req.params;
    let agentId = req.body.agentId;

    // agentId가 없으면 로그인 사용자로 Agent 찾기
    if (!agentId) {
      // 1) userId로 Agent 찾기 (가장 신뢰할 수 있는 방법)
      if (req.user?.id) {
        const agentByUserId = queryOne(
          'SELECT id FROM Agent WHERE userId = ? AND isActive = ?',
          [req.user.id, 1]
        );
        if (agentByUserId) {
          agentId = agentByUserId.id;
        }
      }
      // 2) fallback: 사용자 이름으로 Agent 찾기
      if (!agentId && req.user?.name) {
        const agentByName = queryOne(
          'SELECT id FROM Agent WHERE name = ? AND isActive = ?',
          [req.user.name, 1]
        );
        if (agentByName) {
          agentId = agentByName.id;
        }
      }
    }

    if (!agentId) {
      return sendError(res, '에이전트 ID가 필요합니다.', HTTP_STATUS.BAD_REQUEST);
    }

    // 이미 열람 기록이 있는지 확인
    const existingRead = queryOne(
      'SELECT * FROM CustomerFeedbackNoticeRead WHERE noticeId = ? AND agentId = ?',
      [parseInt(id), agentId]
    );

    if (existingRead) {
      // 이미 열람했으면 그대로 반환
      if (existingRead.agentId) {
        const ag = queryOne('SELECT id, name, email FROM Agent WHERE id = ?', [existingRead.agentId]);
        existingRead.agent = ag
          ? { id: ag.id, name: resolveAgentDisplayName(ag.name, ag.email) }
          : null;
      }
      return sendSuccess(res, existingRead);
    }

    // 열람 기록 생성
    const now = new Date().toISOString();
    const result = execute(
      'INSERT INTO CustomerFeedbackNoticeRead (noticeId, agentId, readAt, createdAt) VALUES (?, ?, ?, ?)',
      [parseInt(id), agentId, now, now]
    );
    
    const readRecord = queryOne('SELECT * FROM CustomerFeedbackNoticeRead WHERE id = ?', [result.lastInsertRowid]);
    if (readRecord.agentId) {
      const ag = queryOne('SELECT id, name, email FROM Agent WHERE id = ?', [readRecord.agentId]);
      readRecord.agent = ag
        ? { id: ag.id, name: resolveAgentDisplayName(ag.name, ag.email) }
        : null;
    }

    logger.info('Feedback notice read', { noticeId: id, agentId });
    return sendSuccess(res, readRecord, HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to mark notice as read', { 
      error: error.message,
      stack: error.stack
    });
    return sendError(res, '열람 기록 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 공지사항 상세 조회 (열람 정보 포함)
 */
async function getNoticeById(req, res) {
  try {
    const { id } = req.params;
    const { projectId } = req.query;

    const notice = queryOne('SELECT * FROM CustomerFeedbackNotice WHERE id = ?', [parseInt(id)]);

    if (!notice) {
      return sendError(res, '공지사항을 찾을 수 없습니다.', HTTP_STATUS.NOT_FOUND);
    }
    
    // 열람 정보 조회
    const reads = query(
      `SELECT r.*, a.id as agent_id, a.name as agent_name, a.email as agent_email
       FROM CustomerFeedbackNoticeRead r
       LEFT JOIN Agent a ON r.agentId = a.id
       WHERE r.noticeId = ?`,
      [notice.id]
    );
    
    const formattedReads = reads.map(read => ({
      ...read,
      agent: read.agent_id
        ? {
            id: read.agent_id,
            name: resolveAgentDisplayName(read.agent_name, read.agent_email),
          }
        : null,
    }));

    // 프로젝트의 모든 에이전트 가져오기
    let allAgents = [];
    if (projectId) {
      allAgents = query(
        'SELECT id, name, email FROM Agent WHERE projectId = ? AND isActive = ?',
        [parseProjectId(projectId), 1]
      );
    }

    const readAgentIds = formattedReads.map(read => read.agentId).filter(Boolean);
    const readAgents = formattedReads
      .filter(read => read.agent)
      .map(read => ({
        id: read.agent.id,
        name: read.agent.name,
        readAt: read.readAt,
      }));
    const unreadAgents = allAgents
      .filter(agent => !readAgentIds.includes(agent.id))
      .map(agent => ({
        id: agent.id,
        name: resolveAgentDisplayName(agent.name, agent.email),
      }));

    return sendSuccess(res, {
      ...notice,
      isActive: Boolean(notice.isActive),
      readAgents,
      unreadAgents,
    });
  } catch (error) {
    logger.error('Failed to fetch notice by id', { 
      error: error.message,
      stack: error.stack
    });
    return sendError(res, '공지사항 조회 실패', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

module.exports = {
  getAllNotices,
  getNoticeById,
  createNotice,
  updateNotice,
  endNotice,
  deleteNotice,
  markNoticeAsRead,
};
