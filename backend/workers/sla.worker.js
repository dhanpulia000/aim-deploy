// SLA 체커 워커
// 주기적으로 SLA 정책을 체크하고 위반 시 알림을 보냄

const slaService = require('../services/sla.service');
const auditService = require('../services/audit.service');
const { query, execute } = require('../libs/db');
const logger = require('../utils/logger');
const https = require('https');
const http = require('http');

/**
 * 웹훅 URL로 POST 요청 전송
 * @param {string} url - 웹훅 URL
 * @param {object} payload - 전송할 데이터
 * @returns {Promise<boolean>} 성공 여부
 */
async function sendWebhook(url, payload) {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const data = JSON.stringify(payload);
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 5000 // 5초 타임아웃
      };

      const req = client.request(options, (res) => {
        res.on('data', () => {
          // 데이터 수신 중 (응답 본문은 사용하지 않음)
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            logger.info('Webhook sent successfully', { url, statusCode: res.statusCode });
            resolve(true);
          } else {
            logger.warn('Webhook returned non-2xx status', { url, statusCode: res.statusCode });
            resolve(false);
          }
        });
      });

      req.on('error', (error) => {
        logger.error('Webhook request failed', { url, error: error.message });
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        logger.warn('Webhook request timeout', { url });
        resolve(false);
      });

      req.write(data);
      req.end();
    } catch (error) {
      logger.error('Webhook URL invalid', { url, error: error.message });
      resolve(false);
    }
  });
}

/**
 * SLA 위반 알림 전송
 * @param {object} policy - SLA 정책
 * @param {Array} violations - 위반 이슈 목록
 * @param {object} publisher - WebSocket publisher (선택)
 */
async function sendSlaAlert(policy, violations, publisher = null) {
  if (!violations || violations.length === 0) {
    return;
  }

  const issueIds = violations.map(v => v.id);
  const issueSummaries = violations.map(v => ({
    id: v.id,
    summary: v.summary || v.detail || 'No summary',
    severity: v.severity,
    createdAt: v.createdAt
  }));

  const payload = {
    type: 'SLA_VIOLATION',
    projectId: policy.projectId,
    policy: {
      id: policy.id,
      severity: policy.severity,
      responseSec: policy.responseSec
    },
    violations: issueSummaries,
    count: violations.length,
    timestamp: new Date().toISOString()
  };

  // 채널별 알림 전송
  if (policy.channel === 'discord' || policy.channel === 'slack' || policy.channel === 'webhook') {
    // 웹훅으로 전송
    await sendWebhook(policy.target, payload);
  } else if (policy.channel === 'email') {
    // 이메일은 나중에 구현 (현재는 로그만)
    logger.warn('Email alerts not implemented yet', { target: policy.target, violations: issueIds });
  }

  // WebSocket으로 실시간 알림 브로드캐스트
  if (publisher && publisher.broadcastSlaViolation) {
    publisher.broadcastSlaViolation(policy, violations);
  }

  // 감사 로그 기록
  await auditService.createAuditLog('SLA_VIOLATION', null, {
    policyId: policy.id,
    projectId: policy.projectId,
    severity: policy.severity,
    violationCount: violations.length,
    issueIds
  });

  // 콘솔 로그
  logger.error('SLA VIOLATION DETECTED', {
    projectId: policy.projectId,
    severity: policy.severity,
    responseSec: policy.responseSec,
    violationCount: violations.length,
    issueIds
  });
}

/**
 * SLA 위반 이슈에 slaBreachedAt 마킹
 * @param {Array} issueIds - 이슈 ID 목록
 */
async function markSlaBreached(issueIds) {
  if (!issueIds || issueIds.length === 0) {
    return;
  }

  try {
    const now = new Date().toISOString();
    const placeholders = issueIds.map(() => '?').join(',');
    execute(
      `UPDATE ReportItemIssue 
       SET slaBreachedAt = ?, updatedAt = ? 
       WHERE id IN (${placeholders}) AND slaBreachedAt IS NULL`,
      [now, now, ...issueIds]
    );
  } catch (error) {
    logger.error('Failed to mark SLA breached', { error: error.message, issueIds });
  }
}

/**
 * SLA 체크 실행
 * @param {object} publisher - WebSocket publisher (선택)
 */
async function checkSlaPolicies(publisher = null) {
  try {
    // 모든 활성 SLA 정책 조회
    const policies = query(
      `SELECT sp.*, p.id as project_id, p.name as project_name 
       FROM SlaPolicy sp
       LEFT JOIN Project p ON sp.projectId = p.id
       WHERE sp.isActive = ?`,
      [1]  // SQLite requires 1/0 instead of true/false
    );
    
    // 결과를 원래 형식으로 변환
    const formattedPolicies = policies.map(p => ({
      id: p.id,
      projectId: p.projectId,
      severity: p.severity,
      responseSec: p.responseSec,
      channel: p.channel,
      target: p.target,
      isActive: p.isActive,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      project: p.project_id ? {
        id: p.project_id,
        name: p.project_name
      } : null
    }));

    if (formattedPolicies.length === 0) {
      logger.debug('No active SLA policies to check');
      return;
    }

    logger.info('Checking SLA policies', { count: formattedPolicies.length });

    for (const policy of formattedPolicies) {
      try {
        // SLA 위반 이슈 찾기
        const violations = await slaService.findSlaViolations(policy);

        if (violations.length > 0) {
          // 알림 전송
          await sendSlaAlert(policy, violations, publisher);

          // slaBreachedAt 마킹
          const issueIds = violations.map(v => v.id);
          await markSlaBreached(issueIds);
        }
      } catch (error) {
        logger.error('Error checking SLA policy', {
          policyId: policy.id,
          error: error.message
        });
      }
    }
  } catch (error) {
    logger.error('SLA check failed', { error: error.message });
  }
}

/**
 * SLA 워커 시작
 * @param {object} publisher - WebSocket publisher (선택)
 * @param {number} intervalMs - 체크 간격 (밀리초, 기본: 60000 = 1분)
 */
function startSlaWorker(publisher = null, intervalMs = 60000) {
  logger.info('Starting SLA worker', { intervalMs });

  // 즉시 한 번 실행
  checkSlaPolicies(publisher);

  // 주기적으로 실행
  const interval = setInterval(() => {
    checkSlaPolicies(publisher);
  }, intervalMs);

  // 프로세스 종료 시 정리
  process.on('SIGTERM', () => {
    logger.info('Stopping SLA worker');
    clearInterval(interval);
  });

  process.on('SIGINT', () => {
    logger.info('Stopping SLA worker');
    clearInterval(interval);
  });

  return interval;
}

module.exports = {
  checkSlaPolicies,
  startSlaWorker,
  sendSlaAlert,
  markSlaBreached
};

