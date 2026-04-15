/**
 * 가이드 임베딩 재생성 스크립트
 * PostgreSQL 연결이 없거나 임베딩이 생성되지 않은 가이드들의 임베딩을 재생성합니다.
 * 
 * 사용법: node scripts/regenerate-guide-embeddings.js
 */

require('dotenv').config();
const { query } = require('../libs/db');
const workGuideService = require('../services/workGuide.service').getWorkGuideService();
const logger = require('../utils/logger');

async function regenerateEmbeddings() {
  console.log('🔍 임베딩이 없는 가이드 검색 중...\n');
  
  // 모든 가이드 조회
  const allGuides = query('SELECT id, title, content FROM WorkGuide ORDER BY createdAt DESC');
  console.log(`📊 전체 가이드 개수: ${allGuides.length}\n`);
  
  if (allGuides.length === 0) {
    console.log('✅ 등록된 가이드가 없습니다.');
    return;
  }
  
  // PostgreSQL 연결 확인
  const { checkConnection } = require('../libs/db-postgres');
  const isConnected = await checkConnection();
  
  if (!isConnected) {
    console.error('❌ PostgreSQL 연결이 없습니다!');
    console.error('\n다음 중 하나를 수행하세요:');
    console.error('1. PostgreSQL + pgvector 설정:');
    console.error('   - Docker: bash scripts/setup-postgres.sh');
    console.error('   - 또는 .env에 PG_VECTOR_URL 설정');
    console.error('\n2. 환경 변수 확인:');
    console.error('   - PG_VECTOR_URL 또는 DATABASE_URL이 postgresql://로 시작해야 합니다');
    process.exit(1);
  }
  
  // 각 가이드의 임베딩 확인 및 재생성
  let regenerated = 0;
  let failed = 0;
  let skipped = 0;
  
  for (const guide of allGuides) {
    try {
      console.log(`처리 중: ${guide.id} - ${guide.title.substring(0, 50)}...`);
      
      // 임베딩 존재 여부 확인
      const { query: pgQuery } = require('../libs/db-postgres');
      const existingEmbeddings = await pgQuery(
        'SELECT COUNT(*) as count FROM guide_embeddings WHERE guide_id = $1',
        [guide.id]
      );
      
      const embeddingCount = parseInt(existingEmbeddings[0]?.count || 0);
      
      if (embeddingCount > 0) {
        console.log(`  ⏭️  이미 임베딩이 있습니다 (${embeddingCount}개 청크). 건너뜁니다.\n`);
        skipped++;
        continue;
      }
      
      // 임베딩 재생성
      console.log(`  🔄 임베딩 생성 중...`);
      const success = await workGuideService.generateAndStoreEmbedding(guide.id, guide.content);
      
      if (success) {
        console.log(`  ✅ 임베딩 생성 완료\n`);
        regenerated++;
      } else {
        console.log(`  ❌ 임베딩 생성 실패\n`);
        failed++;
      }
    } catch (error) {
      console.error(`  ❌ 오류: ${error.message}\n`);
      failed++;
    }
  }
  
  console.log('\n📊 재생성 결과:');
  console.log(`   ✅ 재생성 완료: ${regenerated}개`);
  console.log(`   ⏭️  건너뜀 (이미 있음): ${skipped}개`);
  console.log(`   ❌ 실패: ${failed}개`);
  
  if (regenerated > 0) {
    console.log('\n✅ 임베딩 재생성이 완료되었습니다!');
    console.log('이제 AI 어시스턴트가 가이드 데이터를 기반으로 답변할 수 있습니다.');
  }
}

// 실행
try {
  regenerateEmbeddings().then(() => {
    process.exit(0);
  }).catch(error => {
    console.error('스크립트 실행 오류:', error);
    process.exit(1);
  });
} catch (error) {
  console.error('스크립트 실행 오류:', error);
  process.exit(1);
}
