// Discord 이슈 수집 워커 (플레이스홀더)
// 향후 Discord API를 통한 이슈 수집 로직 구현 예정

const logger = require('../../utils/logger');

/**
 * Discord 워커 시작
 * @param {object} prisma - Prisma 클라이언트
 * @param {object} publisher - WebSocket publisher (선택)
 * @param {object} options - 설정 옵션
 */
function startDiscordWorker(prisma, publisher = null, options = {}) {
  logger.info('Discord worker placeholder started', { options });
  
  // TODO: Discord API 연동 구현
  // - Discord 봇 설정
  // - 메시지 수신 및 파싱
  // - 이슈 생성 및 publisher.broadcastIssueCreated 호출
  
  return {
    stop: () => {
      logger.info('Discord worker stopped');
    }
  };
}

module.exports = {
  startDiscordWorker
};























