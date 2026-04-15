// AI가 분류하지 않은 모든 이슈를 AI로 재분류하는 스크립트 (자동 실행 버전)

const { PrismaClient } = require('@prisma/client');
const { classifyIssueCategory } = require('../services/issueClassifier');
const prisma = new PrismaClient();

function buildIssueText(issue) {
  const parts = [];
  if (issue.summary) parts.push(issue.summary);
  if (issue.detail) parts.push(issue.detail);
  
  // scrapedComments가 있으면 파싱하여 추가
  if (issue.scrapedComments) {
    try {
      const comments = JSON.parse(issue.scrapedComments);
      if (Array.isArray(comments) && comments.length > 0) {
        const commentSnippet = comments
          .slice(0, 3)
          .map((c, idx) => `댓글 ${idx + 1} (${c.author || '익명'}): ${c.text || c.content || ''}`)
          .join('\n');
        parts.push(`\n[유저 댓글]\n${commentSnippet}`);
      }
    } catch (e) {
      // 파싱 실패 시 무시
    }
  }
  
  return parts.filter(Boolean).join('\n\n');
}

async function reclassifyBatch(skip, limit, projectId = null) {
  const where = {
    OR: [
      { aiClassificationMethod: null },
      { aiClassificationMethod: 'RULE' },
      { categoryGroupId: null }
    ]
  };

  if (projectId) {
    where.projectId = projectId;
  }

  const issues = await prisma.reportItemIssue.findMany({
    where,
    select: {
      id: true,
      summary: true,
      detail: true,
      scrapedComments: true,
      projectId: true,
      importance: true,
      categoryGroupId: true,
      categoryId: true,
      severity: true,
      aiClassificationMethod: true
    },
    skip,
    take: limit,
    orderBy: {
      createdAt: 'desc'
    }
  });

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const issue of issues) {
    try {
      const text = buildIssueText(issue);
      
      if (!text || text.trim().length === 0) {
        skipCount++;
        continue;
      }

      // AI 분류 시도
      const classification = await classifyIssueCategory({
        text: text,
        prisma: prisma,
        projectId: issue.projectId
      });

      // AI 분류 성공한 경우만 업데이트 (groupId는 필수)
      if (classification.aiClassificationMethod === 'AI' && classification.groupId) {
        await prisma.reportItemIssue.update({
          where: { id: issue.id },
          data: {
            importance: classification.importance,
            categoryGroupId: classification.groupId, // 필수
            categoryId: classification.categoryId || null,
            severity: classification.severity || issue.severity,
            aiClassificationMethod: 'AI',
            aiClassificationReason: classification.aiClassificationReason || null,
            trend: classification.trend || null,
            otherGameTitle: classification.otherGameTitle || null
          }
        });
        successCount++;
        
        if (successCount % 10 === 0) {
          process.stdout.write(`\r진행 중... ${successCount}개 성공, ${skipCount}개 건너뜀, ${errorCount}개 실패`);
        }
      } else {
        skipCount++;
        // 스킵된 이유 로깅 (처음 5개만)
        if (skipCount <= 5) {
          const reason = !classification 
            ? '분류 결과 없음'
            : classification.aiClassificationMethod !== 'AI'
            ? `AI 분류 실패 (${classification.aiClassificationMethod || 'null'})`
            : !classification.groupId
            ? 'AI 분류 성공했지만 groupId 없음'
            : '알 수 없는 이유';
          console.log(`\n스킵: 이슈 ${issue.id.substring(0, 20)}... - ${reason}`);
        }
      }

      // API 호출 제한을 고려한 지연
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      errorCount++;
      if (errorCount <= 5) {
        console.error(`\n이슈 ${issue.id.substring(0, 20)}... 재분류 실패: ${error.message}`);
      }
    }
  }

  return { successCount, skipCount, errorCount, hasMore: issues.length === limit };
}

async function reclassifyAll() {
  try {
    console.log('AI 재분류 스크립트 (자동 실행)\n');
    console.log('='.repeat(80));

    // 환경 변수 확인
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log('❌ OPENAI_API_KEY가 설정되지 않았습니다.');
      console.log('   AI 재분류를 진행할 수 없습니다.\n');
      return;
    }

    // 통계 확인
    console.log('\n1. 현재 상태 확인:');
    console.log('-'.repeat(80));
    const totalUnclassified = await prisma.reportItemIssue.count({
      where: {
        OR: [
          { aiClassificationMethod: null },
          { aiClassificationMethod: 'RULE' },
          { categoryGroupId: null }
        ]
      }
    });

    const project2Count = await prisma.reportItemIssue.count({
      where: {
        OR: [
          { aiClassificationMethod: null },
          { aiClassificationMethod: 'RULE' },
          { categoryGroupId: null }
        ],
        projectId: 2
      }
    });

    const project3Count = await prisma.reportItemIssue.count({
      where: {
        OR: [
          { aiClassificationMethod: null },
          { aiClassificationMethod: 'RULE' },
          { categoryGroupId: null }
        ],
        projectId: 3
      }
    });

    console.log(`   전체 재분류 대상: ${totalUnclassified}개`);
    console.log(`   - 프로젝트 ID 2: ${project2Count}개`);
    console.log(`   - 프로젝트 ID 3: ${project3Count}개\n`);

    if (totalUnclassified === 0) {
      console.log('✅ 재분류할 이슈가 없습니다.\n');
      return;
    }

    console.log(`\n재분류 시작... (예상 소요 시간: 약 ${Math.ceil(totalUnclassified / 10)}분)\n`);

    const BATCH_SIZE = 10;
    let totalSuccess = 0;
    let totalSkip = 0;
    let totalError = 0;
    let skip = 0;
    let batchNum = 0;

    while (true) {
      batchNum++;
      const { successCount, skipCount, errorCount, hasMore } = await reclassifyBatch(
        skip,
        BATCH_SIZE
      );

      totalSuccess += successCount;
      totalSkip += skipCount;
      totalError += errorCount;

      // 진행 상황 출력
      const processed = skip + BATCH_SIZE;
      const progress = totalUnclassified > 0 ? ((processed / totalUnclassified) * 100).toFixed(1) : 0;
      console.log(`배치 ${batchNum}: ${processed}/${totalUnclassified}개 처리 (${progress}%) - 성공: ${totalSuccess}, 건너뜀: ${totalSkip}, 실패: ${totalError}`);

      if (!hasMore) {
        break; // 더 이상 처리할 이슈가 없음
      }

      skip += BATCH_SIZE;
    }

    console.log('\n' + '='.repeat(80));
    console.log('재분류 완료!');
    console.log('='.repeat(80));
    console.log(`✅ AI 분류 성공: ${totalSuccess}개`);
    console.log(`⚠️  건너뜀 (AI 분류 실패 또는 텍스트 없음): ${totalSkip}개`);
    console.log(`❌ 에러 발생: ${totalError}개`);
    console.log('');

    // 최종 통계 확인
    console.log('최종 통계 확인:');
    console.log('-'.repeat(80));
    const finalAiCount = await prisma.reportItemIssue.count({
      where: { aiClassificationMethod: 'AI' }
    });
    const finalRuleCount = await prisma.reportItemIssue.count({
      where: { aiClassificationMethod: 'RULE' }
    });
    const finalNullCount = await prisma.reportItemIssue.count({
      where: { aiClassificationMethod: null }
    });

    console.log(`   AI 분류: ${finalAiCount}개`);
    console.log(`   규칙 분류: ${finalRuleCount}개`);
    console.log(`   미분류: ${finalNullCount}개`);
    console.log('');

  } catch (error) {
    console.error('\n❌ 재분류 중 오류 발생:', error);
    console.error('스택:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

reclassifyAll().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});


