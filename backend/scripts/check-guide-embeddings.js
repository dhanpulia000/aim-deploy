/**
 * 가이드 임베딩 상태 확인 스크립트
 */

require('dotenv').config();
const { query } = require('../libs/db');
const { query: pgQuery } = require('../libs/db-postgres');
const workGuideService = require('../services/workGuide.service').getWorkGuideService();

async function checkEmbeddings() {
  console.log('🔍 PUBG-모니터링 가이드_KR.pdf 임베딩 확인\n');
  
  // 1. 가이드 확인
  const guides = query("SELECT id, title FROM WorkGuide WHERE metadata LIKE '%PUBG-모니터링 가이드_KR.pdf%' ORDER BY createdAt DESC LIMIT 10");
  console.log(`📊 해당 파일에서 생성된 가이드: ${guides.length}개\n`);
  guides.forEach((g, i) => {
    console.log(`${i+1}. ${g.title} (ID: ${g.id})`);
  });
  
  // 2. 임베딩 확인
  console.log('\n🔍 임베딩 저장 상태 확인...\n');
  const guideIds = guides.map(g => g.id);
  const embeddingCounts = await Promise.all(
    guideIds.map(id => pgQuery('SELECT COUNT(*) as count FROM guide_embeddings WHERE guide_id = $1', [id]))
  );
  
  let hasEmbeddings = 0;
  let noEmbeddings = 0;
  
  guideIds.forEach((id, idx) => {
    const count = parseInt(embeddingCounts[idx][0]?.count || 0);
    if (count > 0) {
      hasEmbeddings++;
      console.log(`✅ ${guides[idx].title.substring(0, 50)}... | 임베딩: ${count}개`);
    } else {
      noEmbeddings++;
      console.log(`❌ ${guides[idx].title.substring(0, 50)}... | 임베딩 없음`);
    }
  });
  
  console.log(`\n📊 임베딩 상태: ${hasEmbeddings}개 있음, ${noEmbeddings}개 없음\n`);
  
  // 3. 검색 테스트
  console.log('🔍 검색 테스트\n');
  const testQueries = [
    'PUBG 모니터링 신고 접수 시 어떻게 처리하나요?',
    '불법 프로그램 판매 사이트 모니터링 방법',
    'Ban Request 시트 작성 방법',
    'PUBG KR 주간 보고서 작성 가이드'
  ];
  
  for (const testQuery of testQueries) {
    try {
      const results = await workGuideService.searchSimilarGuides(testQuery, { limit: 5, threshold: 0.35 });
      console.log(`질문: ${testQuery}`);
      console.log(`검색 결과: ${results.length}개`);
      const matchedGuides = results.filter(r => guideIds.includes(r.guide.id));
      if (matchedGuides.length > 0) {
        console.log(`  🆕 새로 업로드한 가이드가 ${matchedGuides.length}개 검색됨:`);
        matchedGuides.forEach((r, i) => {
          console.log(`    ${i+1}. ${r.guide.title} (${(r.similarity * 100).toFixed(1)}%)`);
        });
      } else {
        console.log(`  ⚠️  새로 업로드한 가이드가 검색되지 않음`);
        if (results.length > 0) {
          console.log(`  대신 검색된 가이드 (상위 2개):`);
          results.slice(0, 2).forEach((r, i) => {
            console.log(`    ${i+1}. ${r.guide.title} (${(r.similarity * 100).toFixed(1)}%)`);
          });
        }
      }
      console.log('');
    } catch (error) {
      console.error(`검색 오류: ${error.message}\n`);
    }
  }
}

checkEmbeddings().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('스크립트 실행 오류:', error);
  process.exit(1);
});
