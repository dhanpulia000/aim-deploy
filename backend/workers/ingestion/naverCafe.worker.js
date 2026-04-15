// Naver Cafe 이슈 수집 워커 (플레이스홀더)
// 향후 Naver Cafe API를 통한 이슈 수집 로직 구현 예정

const logger = require('../../utils/logger');

/**
 * Naver Cafe 워커 시작
 * @param {object} prisma - Prisma 클라이언트
 * @param {object} publisher - WebSocket publisher (선택)
 * @param {object} options - 설정 옵션
 */
function startNaverCafeWorker(prisma, publisher = null, options = {}) {
  logger.info('Naver Cafe worker placeholder started', { options });
  
  // TODO: Naver Cafe API 연동 구현
  // - Naver Cafe API 인증
  // - 게시글 모니터링
  // - 이슈 생성 및 publisher.broadcastIssueCreated 호출
  
  return {
    stop: () => {
      logger.info('Naver Cafe worker stopped');
    }
  };
}

module.exports = {
  startNaverCafeWorker
};























