const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * UI 요소만 포함된 본문을 감지하는 함수
 */
function isUIOnlyContent(content) {
  if (!content || content.trim().length === 0) {
    return false;
  }
  
  const uiOnlyPatterns = [
    /^다음글목록/i,
    /^말머리/i,
    /^인기멤버/i,
    /^1:1 채팅/i,
    /^조회 \d+$/i,
    /^댓글 \d+$/i,
    /^URL 복사$/i,
    /^URL 복사\n다음글목록/i,
    /^다음글목록\n말머리/i
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

async function main() {
  try {
    console.log('=== requiresLogin 오탐지 수정 시작 ===\n');
    
    // requiresLogin이 true인 이슈 중에서 UI 요소만 포함된 본문을 가진 이슈 찾기
    const issuesWithLogin = await prisma.reportItemIssue.findMany({
      where: {
        requiresLogin: true
      },
      select: {
        id: true,
        summary: true,
        detail: true,
        sourceUrl: true,
        requiresLogin: true
      }
    });
    
    console.log(`총 ${issuesWithLogin.length}개의 requiresLogin=true 이슈를 확인합니다.\n`);
    
    let fixedCount = 0;
    const fixedIssues = [];
    
    for (const issue of issuesWithLogin) {
      if (issue.detail && isUIOnlyContent(issue.detail)) {
        // UI 요소만 포함된 경우 requiresLogin을 false로 수정
        await prisma.reportItemIssue.update({
          where: { id: issue.id },
          data: { requiresLogin: false }
        });
        
        fixedCount++;
        fixedIssues.push({
          id: issue.id,
          summary: issue.summary,
          detailPreview: issue.detail.substring(0, 100)
        });
        
        console.log(`[수정] ${issue.summary?.substring(0, 50)}...`);
        console.log(`  본문 미리보기: ${issue.detail.substring(0, 100)}...\n`);
      }
    }
    
    console.log(`\n=== 수정 완료 ===`);
    console.log(`총 ${fixedCount}개의 이슈를 수정했습니다.`);
    
    if (fixedIssues.length > 0) {
      console.log('\n수정된 이슈 목록:');
      fixedIssues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue.summary?.substring(0, 50)}...`);
      });
    }
    
  } catch (err) {
    console.error('오류 발생:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();









