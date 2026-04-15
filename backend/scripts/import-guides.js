/**
 * 업무 가이드 임포트 스크립트
 * agent-manual.html에서 가이드 데이터 추출 및 임베딩 생성
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const logger = require('../utils/logger');
const guideImporterService = require('../services/guideImporter.service').getGuideImporterService();

async function main() {
  try {
    logger.info('[ImportGuides] Starting guide import...');

    // 매뉴얼에서 가이드 임포트
    const result = await guideImporterService.importFromManual();

    logger.info('[ImportGuides] Import completed', result);

    console.log('\n✅ 가이드 임포트 완료');
    console.log(`   총 ${result.total}개 섹션 발견`);
    console.log(`   ${result.imported}개 가이드 생성`);
    console.log(`   ${result.skipped}개 스킵`);
    console.log(`   ${result.errors}개 오류\n`);

    process.exit(0);
  } catch (error) {
    logger.error('[ImportGuides] Import failed', {
      error: error.message,
      stack: error.stack
    });

    console.error('\n❌ 가이드 임포트 실패:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
