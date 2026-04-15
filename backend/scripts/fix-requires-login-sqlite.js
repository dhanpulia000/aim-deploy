/**
 * requiresLogin 오탐지 수정 스크립트 (better-sqlite3 버전)
 * 
 * UI 요소만 포함된 본문을 가진 이슈의 requiresLogin을 false로 수정
 * 또는 실제 본문이 있는 이슈의 requiresLogin을 false로 수정
 */

require('dotenv').config();
const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

/**
 * UI 요소만 포함된 본문을 감지하는 함수
 */
function isUIOnlyContent(content) {
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return false;
  }
  
  const uiOnlyPatterns = [
    /^다음글목록/i,
    /^말머리/i,
    /^인기멤버/i,
    /^1:1 채팅/i,
    /^조회\s*\d+$/i,
    /^댓글\s*\d+$/i,
    /^URL 복사$/i,
    /^URL 복사\s*\n\s*다음글목록/i,
    /^다음글목록\s*\n\s*말머리/i
  ];
  
  // UI 패턴으로 시작하는지 확인
  for (const pattern of uiOnlyPatterns) {
    const match = content.match(pattern);
    if (match) {
      // UI 패턴 이후의 실제 내용 길이 확인
      const afterUIPattern = content.substring(match[0].length).trim();
      // UI 패턴 이후 실제 내용이 50자 미만이면 UI만 있는 것으로 판단
      if (afterUIPattern.length < 50) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * 실제 본문 내용이 있는지 확인
 */
function hasRealContent(content) {
  if (!content || typeof content !== 'string') {
    return false;
  }
  
  const trimmed = content.trim();
  
  // 너무 짧으면 본문이 없는 것으로 판단
  if (trimmed.length < 20) {
    return false;
  }
  
  // UI 요소만 있는지 확인
  if (isUIOnlyContent(trimmed)) {
    return false;
  }
  
  // 실제 내용이 있는 경우
  return true;
}

async function main() {
  try {
    console.log('=== requiresLogin 오탐지 수정 시작 ===\n');
    
    // requiresLogin이 true인 이슈 조회
    const issuesWithLogin = query(
      'SELECT id, summary, detail, sourceUrl, requiresLogin FROM ReportItemIssue WHERE requiresLogin = 1'
    );
    
    console.log(`총 ${issuesWithLogin.length}개의 requiresLogin=true 이슈를 확인합니다.\n`);
    
    let fixedCount = 0;
    const fixedIssues = [];
    
    for (const issue of issuesWithLogin) {
      let shouldFix = false;
      let reason = '';
      
      // 1. UI 요소만 포함된 본문인 경우
      if (issue.detail && isUIOnlyContent(issue.detail)) {
        shouldFix = true;
        reason = 'UI 요소만 포함된 본문';
      }
      // 2. 실제 본문 내용이 있는 경우 (오탐지로 판단)
      else if (issue.detail && hasRealContent(issue.detail)) {
        // 본문이 50자 이상이고 실제 내용이 있으면 오탐지로 판단
        const contentLength = issue.detail.trim().length;
        if (contentLength >= 50) {
          shouldFix = true;
          reason = `실제 본문 내용 있음 (${contentLength}자)`;
        }
      }
      
      if (shouldFix) {
        execute(
          'UPDATE ReportItemIssue SET requiresLogin = 0, updatedAt = ? WHERE id = ?',
          [new Date().toISOString(), issue.id]
        );
        
        fixedCount++;
        fixedIssues.push({
          id: issue.id,
          summary: issue.summary,
          detailPreview: issue.detail ? issue.detail.substring(0, 100) : '',
          reason
        });
        
        logger.info('[FixRequiresLogin] Fixed issue', {
          id: issue.id.substring(0, 10),
          summary: issue.summary?.substring(0, 50),
          reason
        });
      }
    }
    
    console.log(`\n=== 수정 완료 ===`);
    console.log(`총 ${fixedCount}개의 이슈를 수정했습니다.`);
    
    if (fixedIssues.length > 0) {
      console.log('\n수정된 이슈 목록 (처음 10개):');
      fixedIssues.slice(0, 10).forEach((issue, index) => {
        console.log(`${index + 1}. ${issue.summary?.substring(0, 50)}... (${issue.reason})`);
      });
      if (fixedIssues.length > 10) {
        console.log(`... 외 ${fixedIssues.length - 10}개`);
      }
    }
    
    // 최종 통계
    const finalWithLogin = queryOne('SELECT COUNT(*) as count FROM ReportItemIssue WHERE requiresLogin = 1').count;
    const finalWithoutLogin = queryOne('SELECT COUNT(*) as count FROM ReportItemIssue WHERE requiresLogin = 0 OR requiresLogin IS NULL').count;
    
    console.log('\n📊 최종 통계:');
    console.log(`  로그인 필요: ${finalWithLogin}개`);
    console.log(`  로그인 불필요: ${finalWithoutLogin}개`);
    
  } catch (err) {
    console.error('❌ 오류 발생:', err);
    logger.error('[FixRequiresLogin] Error', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { isUIOnlyContent, hasRealContent, main };



