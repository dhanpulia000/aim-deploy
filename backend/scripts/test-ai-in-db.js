// 데이터베이스에서 AI 분류된 이슈 확인 스크립트

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testAIInDatabase() {
  try {
    console.log('데이터베이스에서 AI 분류된 이슈 확인\n');
    console.log('='.repeat(80));

    // 1. 전체 통계
    console.log('\n1. AI 분류 통계:');
    console.log('-'.repeat(80));
    const totalIssues = await prisma.reportItemIssue.count();
    const aiClassifiedIssues = await prisma.reportItemIssue.count({
      where: { aiClassificationMethod: 'AI' }
    });
    const ruleClassifiedIssues = await prisma.reportItemIssue.count({
      where: { aiClassificationMethod: 'RULE' }
    });
    const nullMethodIssues = await prisma.reportItemIssue.count({
      where: { aiClassificationMethod: null }
    });

    console.log(`   전체 이슈: ${totalIssues}개`);
    console.log(`   AI 분류: ${aiClassifiedIssues}개 (${totalIssues > 0 ? ((aiClassifiedIssues / totalIssues) * 100).toFixed(1) : 0}%)`);
    console.log(`   규칙 분류: ${ruleClassifiedIssues}개 (${totalIssues > 0 ? ((ruleClassifiedIssues / totalIssues) * 100).toFixed(1) : 0}%)`);
    console.log(`   분류 방법 없음: ${nullMethodIssues}개 (${totalIssues > 0 ? ((nullMethodIssues / totalIssues) * 100).toFixed(1) : 0}%)\n`);

    // 2. 최근 AI 분류된 이슈 (프로젝트 무관)
    console.log('2. 최근 AI 분류된 이슈 (프로젝트 무관, 최근 5개):');
    console.log('-'.repeat(80));
    const recentAiIssues = await prisma.reportItemIssue.findMany({
      where: {
        aiClassificationMethod: 'AI'
      },
      select: {
        id: true,
        summary: true,
        aiClassificationReason: true,
        aiClassificationMethod: true,
        categoryGroup: {
          select: { name: true }
        },
        category: {
          select: { name: true }
        },
        importance: true,
        severity: true,
        projectId: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    if (recentAiIssues.length === 0) {
      console.log('   ⚠️  AI로 분류된 이슈가 없습니다.\n');
    } else {
      recentAiIssues.forEach((issue, idx) => {
        console.log(`   ${idx + 1}. ID: ${issue.id.substring(0, 20)}...`);
        console.log(`      제목: ${issue.summary?.substring(0, 50) || 'N/A'}...`);
        console.log(`      프로젝트 ID: ${issue.projectId || 'null'}`);
        console.log(`      대분류: ${issue.categoryGroup?.name || 'N/A'}`);
        console.log(`      중분류: ${issue.category?.name || 'N/A'}`);
        console.log(`      중요도: ${issue.importance || 'N/A'}`);
        console.log(`      심각도: ${issue.severity || 'N/A'}`);
        if (issue.aiClassificationReason) {
          console.log(`      AI 이유: ${issue.aiClassificationReason.substring(0, 60)}...`);
        }
        console.log(`      생성일: ${issue.createdAt.toLocaleString('ko-KR')}`);
        console.log('');
      });
    }

    // 3. 프로젝트별 AI 분류 통계
    console.log('3. 프로젝트별 AI 분류 통계:');
    console.log('-'.repeat(80));
    const projectStats = await prisma.reportItemIssue.groupBy({
      by: ['projectId', 'aiClassificationMethod'],
      _count: {
        id: true
      }
    });

    const projectMap = new Map();
    projectStats.forEach(stat => {
      const key = stat.projectId || 'null';
      if (!projectMap.has(key)) {
        projectMap.set(key, { projectId: stat.projectId, ai: 0, rule: 0, null: 0 });
      }
      const item = projectMap.get(key);
      if (stat.aiClassificationMethod === 'AI') {
        item.ai = stat._count.id;
      } else if (stat.aiClassificationMethod === 'RULE') {
        item.rule = stat._count.id;
      } else {
        item.null = stat._count.id;
      }
    });

    for (const [key, stats] of projectMap.entries()) {
      const total = stats.ai + stats.rule + stats.null;
      console.log(`   프로젝트 ID: ${key}`);
      console.log(`      AI: ${stats.ai}개 (${total > 0 ? ((stats.ai / total) * 100).toFixed(1) : 0}%)`);
      console.log(`      규칙: ${stats.rule}개 (${total > 0 ? ((stats.rule / total) * 100).toFixed(1) : 0}%)`);
      console.log(`      없음: ${stats.null}개 (${total > 0 ? ((stats.null / total) * 100).toFixed(1) : 0}%)`);
      console.log(`      전체: ${total}개\n`);
    }

    // 4. 최근 크롤링된 이슈 확인 (AI 분류 여부)
    console.log('4. 최근 크롤링된 이슈 (최근 10개, AI 분류 여부 확인):');
    console.log('-'.repeat(80));
    const recentIssues = await prisma.reportItemIssue.findMany({
      where: {
        source: {
          in: ['NAVER_CAFE_PUBG_PC', 'NAVER_CAFE_PUBG_MOBILE']
        }
      },
      select: {
        id: true,
        summary: true,
        source: true,
        aiClassificationMethod: true,
        aiClassificationReason: true,
        categoryGroup: {
          select: { name: true }
        },
        category: {
          select: { name: true }
        },
        projectId: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });

    if (recentIssues.length === 0) {
      console.log('   ⚠️  최근 크롤링된 이슈가 없습니다.\n');
    } else {
      recentIssues.forEach((issue, idx) => {
        const method = issue.aiClassificationMethod || '없음';
        const methodIcon = issue.aiClassificationMethod === 'AI' ? '✅' : issue.aiClassificationMethod === 'RULE' ? '📋' : '❌';
        console.log(`   ${idx + 1}. ${methodIcon} ${method}`);
        console.log(`      제목: ${issue.summary?.substring(0, 50) || 'N/A'}...`);
        console.log(`      프로젝트 ID: ${issue.projectId || 'null'}`);
        console.log(`      대분류: ${issue.categoryGroup?.name || 'N/A'}`);
        console.log(`      중분류: ${issue.category?.name || 'N/A'}`);
        console.log(`      생성일: ${issue.createdAt.toLocaleString('ko-KR')}`);
        console.log('');
      });
    }

    // 5. AI 분류 로그 상세 확인
    console.log('5. 최근 AI 분류 로그 상세 (최근 3개):');
    console.log('-'.repeat(80));
    const detailedLogs = await prisma.aIClassificationLog.findMany({
      include: {
        issue: {
          select: {
            summary: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 3
    });

    if (detailedLogs.length === 0) {
      console.log('   ℹ️  AI 분류 로그가 없습니다.\n');
    } else {
      detailedLogs.forEach((log, idx) => {
        console.log(`   ${idx + 1}. 이슈: ${log.issue?.summary?.substring(0, 40) || 'N/A'}...`);
        
        try {
          const originalData = JSON.parse(log.originalData);
          const aiPrediction = JSON.parse(log.aiPrediction);
          const userCorrection = JSON.parse(log.userCorrection);
          const changedFields = log.changedFields ? JSON.parse(log.changedFields) : [];

          console.log(`      원문 제목: ${originalData.summary?.substring(0, 40) || 'N/A'}...`);
          console.log(`      AI 분류 방법: ${aiPrediction.aiClassificationMethod || 'N/A'}`);
          console.log(`      AI 예측 대분류 ID: ${aiPrediction.categoryGroupId || 'N/A'}`);
          console.log(`      AI 예측 중분류 ID: ${aiPrediction.categoryId || 'N/A'}`);
          console.log(`      사용자 수정 대분류 ID: ${userCorrection.categoryGroupId || 'N/A'}`);
          console.log(`      사용자 수정 중분류 ID: ${userCorrection.categoryId || 'N/A'}`);
          console.log(`      변경된 필드: ${changedFields.join(', ') || '없음'}`);
          console.log(`      생성일: ${log.createdAt.toLocaleString('ko-KR')}`);
        } catch (e) {
          console.log(`      로그 파싱 실패: ${e.message}`);
        }
        console.log('');
      });
    }

    console.log('='.repeat(80));
    console.log('테스트 완료!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ 테스트 중 오류 발생:', error);
    console.error('스택:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testAIInDatabase();







