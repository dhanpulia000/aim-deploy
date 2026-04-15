// WebSocket 실시간 이벤트 Publisher
// 모든 WebSocket 클라이언트에게 이벤트를 브로드캐스트

let wssInstance = null;

function getInternalBroadcastUrl() {
  const base =
    process.env.INTERNAL_BROADCAST_URL ||
    process.env.BACKEND_INTERNAL_URL ||
    `http://127.0.0.1:${process.env.PORT || 9080}`;
  return `${String(base).replace(/\/$/, '')}/api/internal/realtime/broadcast`;
}

async function forwardBroadcastToMainProcess(event) {
  const token = process.env.ISSUE_WATCH_INTERNAL_TOKEN;
  if (!token || String(token).trim() === '') return false;
  const url = getInternalBroadcastUrl();
  try {
    // axios is already used in other services; reuse it here to avoid extra deps
    const axios = require('axios');
    await axios.post(
      url,
      { type: event?.type, payload: event?.payload ?? {} },
      {
        headers: { 'X-Internal-Token': token, 'Content-Type': 'application/json' },
        timeout: 2000,
      }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * WebSocket 서버 인스턴스 설정
 * @param {WebSocket.Server} wss - WebSocket 서버 인스턴스
 */
function setWebSocketServer(wss) {
  wssInstance = wss;
}

/**
 * 모든 연결된 클라이언트에게 메시지 브로드캐스트
 * @param {object} event - 이벤트 객체
 */
function broadcast(event) {
  if (!wssInstance) {
    const logger = require('../utils/logger');
    // 독립 프로세스(worker 등)에서는 WebSocket 서버에 접근할 수 없으므로
    // 내부 콜백(메인 프로세스)로 포워딩을 시도한다.
    forwardBroadcastToMainProcess(event).then((forwarded) => {
      if (!forwarded) {
        logger.debug(
          'WebSocket server not initialized, cannot broadcast (this is normal for worker processes)',
          { eventType: event?.type }
        );
      }
    });
    return;
  }

  const message = JSON.stringify(event);
  let sentCount = 0;

  wssInstance.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(message);
        sentCount++;
      } catch (error) {
        console.error('Failed to send WebSocket message', { error: error.message });
      }
    }
  });

  if (sentCount > 0) {
    const logger = require('../utils/logger');
    logger.debug('WebSocket event broadcast', { type: event.type, clients: sentCount });
  }
}

/**
 * 에이전트 상태 업데이트 브로드캐스트
 * @param {number|null} projectId - 프로젝트 ID
 * @param {string} agentId - 에이전트 ID
 * @param {string} status - 상태
 * @param {object} additionalData - 추가 데이터 (handling, todayResolved, avgHandleSec)
 */
function broadcastAgentStatusUpdate(projectId, agentId, status, additionalData = {}) {
  broadcast({
    type: 'agent_status_update',
    payload: {
      projectId,
      agentId,
      status,
      ...additionalData
    }
  });
}

/**
 * 이슈 생성 브로드캐스트
 * @param {object} issue - 이슈 객체
 */
function broadcastIssueCreated(issue) {
  broadcast({
    type: 'issue_created',
    payload: {
      projectId: issue.projectId || null,
      issueId: issue.id,
      title: issue.summary || issue.detail || issue.title || '이슈',
      severity: issue.severity,
      category: issue.category || issue.primaryCategory,
      status: issue.status || 'OPEN',
      source: issue.source || 'system',
      createdAt: issue.createdAt ? new Date(issue.createdAt).toISOString() : new Date().toISOString()
    }
  });
}

/**
 * 이슈 업데이트 브로드캐스트
 * @param {object} issue - 업데이트된 이슈 객체
 */
function broadcastIssueUpdated(issue) {
  broadcast({
    type: 'issue_updated',
    payload: {
      projectId: issue.projectId || null,
      issueId: issue.id,
      title: issue.summary || issue.detail || issue.title || '이슈',
      status: issue.status,
      assignedAgentId: issue.assignedAgentId || null,
      assignedAgentName: issue.assignedAgent?.name || issue.assignedAgentName || null,
      severity: issue.severity,
      checkedAt: issue.checkedAt ? new Date(issue.checkedAt).toISOString() : null,
      processedAt: issue.processedAt ? new Date(issue.processedAt).toISOString() : null,
      source: issue.source || 'system',
      category: issue.category?.name || issue.primaryCategory || null,
      createdAt: issue.createdAt ? new Date(issue.createdAt).toISOString() : null
    }
  });
}

/**
 * SLA 위반 브로드캐스트
 * @param {object} policy - SLA 정책
 * @param {Array} issues - 위반 이슈 목록
 */
function broadcastSlaViolation(policy, issues) {
  if (!issues || issues.length === 0) {
    return;
  }

  broadcast({
    type: 'sla_violation',
    payload: {
      projectId: policy.projectId,
      issueIds: issues.map(issue => issue.id),
      severity: policy.severity,
      policyId: policy.id,
      responseSec: policy.responseSec
    }
  });
}

/**
 * 즉시 브로드캐스트 (임의 type/payload로 모든 클라이언트에 전송)
 * @param {string} type - 이벤트 타입
 * @param {object} payload - 페이로드
 */
function broadcastImmediate(type, payload) {
  if (!type || typeof type !== 'string') {
    const logger = require('../utils/logger');
    logger.warn('broadcastImmediate: type required');
    return;
  }
  broadcast({ type, payload: payload ?? {} });
}

module.exports = {
  setWebSocketServer,
  broadcast,
  broadcastImmediate,
  broadcastAgentStatusUpdate,
  broadcastIssueCreated,
  broadcastIssueUpdated,
  broadcastSlaViolation
};



