/**
 * sourceCreatedAt 시간 확인 스크립트
 * 실제 저장된 시간과 한국 시간으로 변환한 시간을 비교
 */

const { query } = require('../libs/db');

async function checkSourceCreatedAt() {
  try {
    console.log('=== sourceCreatedAt 시간 확인 ===\n');
    
    // 최근 20개 이슈 조회
    const issues = query(`
      SELECT 
        id,
        summary,
        sourceCreatedAt,
        createdAt,
        date,
        source
      FROM ReportItemIssue 
      WHERE sourceCreatedAt IS NOT NULL 
      ORDER BY createdAt DESC 
      LIMIT 20
    `);
    
    console.log(`총 ${issues.length}개 이슈 확인\n`);
    console.log('ID | 제목 (일부) | sourceCreatedAt (UTC) | 한국 시간 변환 | createdAt (UTC) | 한국 시간 변환 | 차이');
    console.log('-'.repeat(120));
    
    for (const issue of issues) {
      const sourceUTC = issue.sourceCreatedAt ? new Date(issue.sourceCreatedAt) : null;
      const createdUTC = issue.createdAt ? new Date(issue.createdAt) : null;
      
      let sourceKST = null;
      let createdKST = null;
      
      if (sourceUTC) {
        sourceKST = sourceUTC.toLocaleString('ko-KR', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      }
      
      if (createdUTC) {
        createdKST = createdUTC.toLocaleString('ko-KR', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      }
      
      const diff = sourceUTC && createdUTC 
        ? Math.round((createdUTC - sourceUTC) / (1000 * 60)) // 분 단위 차이
        : null;
      
      const summaryShort = (issue.summary || '').substring(0, 30);
      const sourceUTCStr = sourceUTC ? sourceUTC.toISOString().substring(0, 19) + 'Z' : 'N/A';
      const createdUTCStr = createdUTC ? createdUTC.toISOString().substring(0, 19) + 'Z' : 'N/A';
      
      console.log(
        `${issue.id.substring(0, 8)} | ${summaryShort.padEnd(30)} | ${sourceUTCStr.padEnd(20)} | ${(sourceKST || 'N/A').padEnd(20)} | ${createdUTCStr.padEnd(20)} | ${(createdKST || 'N/A').padEnd(20)} | ${diff !== null ? diff + '분' : 'N/A'}`
      );
    }
    
    // 시간이 00:00:00으로 저장된 이슈 확인
    console.log('\n\n=== 시간이 00:00:00으로 저장된 이슈 확인 ===\n');
    const midnightIssues = query(`
      SELECT 
        id,
        summary,
        sourceCreatedAt,
        createdAt
      FROM ReportItemIssue 
      WHERE sourceCreatedAt IS NOT NULL 
        AND strftime('%H:%M:%S', sourceCreatedAt) = '00:00:00'
      ORDER BY createdAt DESC 
      LIMIT 10
    `);
    
    console.log(`시간이 00:00:00으로 저장된 이슈: ${midnightIssues.length}개\n`);
    for (const issue of midnightIssues) {
      const sourceUTC = new Date(issue.sourceCreatedAt);
      const sourceKST = sourceUTC.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      console.log(`  ID: ${issue.id.substring(0, 8)}, 제목: ${(issue.summary || '').substring(0, 50)}`);
      console.log(`    sourceCreatedAt (UTC): ${sourceUTC.toISOString()}`);
      console.log(`    한국 시간 변환: ${sourceKST}`);
      console.log('');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('오류 발생:', error);
    process.exit(1);
  }
}

checkSourceCreatedAt();

