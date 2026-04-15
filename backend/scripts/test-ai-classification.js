// AI 분류 기능 테스트 스크립트

const { PrismaClient } = require('@prisma/client');
const { classifyIssueCategory } = require('../services/issueClassifier');
const prisma = new PrismaClient();

async function testAIClassification() {
  try {
    console.log('AI 분류 기능 테스트\n');
    console.log('='.repeat(80));

    // 1. 환경 변수 확인
    console.log('\n1. 환경 변수 확인:');
    console.log('-'.repeat(80));
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    if (!apiKey) {
      console.log('❌ OPENAI_API_KEY가 설정되지 않았습니다.');
      console.log('   AI 분류는 규칙 기반으로 폴백됩니다.\n');
    } else {
      console.log(`✅ OPENAI_API_KEY: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);
      console.log(`✅ OPENAI_BASE_URL: ${baseUrl}`);
      console.log(`✅ OPENAI_MODEL: ${model}\n`);
    }

    // 2. 프로젝트 목록 확인
    console.log('2. 프로젝트 목록 확인:');
    console.log('-'.repeat(80));
    const projects = await prisma.project.findMany({
      select: {
        id: true,
        name: true
      }
    });
    if (projects.length === 0) {
      console.log('⚠️  프로젝트가 없습니다.\n');
      return;
    }
    projects.forEach(p => {
      console.log(`   - ID: ${p.id}, 이름: ${p.name}`);
    });
    const testProjectId = projects[0].id;
    console.log(`\n   테스트 프로젝트 ID: ${testProjectId} (${projects[0].name})\n`);

    // 3. 카테고리 그룹 확인
    console.log('3. 카테고리 그룹 및 카테고리 확인:');
    console.log('-'.repeat(80));
    const categoryGroups = await prisma.categoryGroup.findMany({
      where: {
        isActive: true,
        projectId: testProjectId
      },
      include: {
        categories: {
          where: { isActive: true },
          take: 5
        }
      },
      take: 3
    });
    if (categoryGroups.length === 0) {
      console.log('⚠️  카테고리 그룹이 없습니다.\n');
      return;
    }
    categoryGroups.forEach(g => {
      console.log(`   - ${g.name}: ${g.categories.map(c => c.name).join(', ')}`);
    });
    console.log('');

    // 4. 테스트 케이스 실행
    console.log('4. AI 분류 테스트 케이스 실행:');
    console.log('-'.repeat(80));

    const testCases = [
      {
        name: '버그 리포트',
        text: `제목: 게임 크래시 문제
본문: 게임을 플레이하다가 갑자기 크래시가 발생했습니다. 특정 맵에서만 발생하는 것 같습니다.
심각도가 높은 문제인 것 같아서 신고드립니다.`
      },
      {
        name: '성능 문제',
        text: `제목: FPS 드랍
본문: 최근 업데이트 이후 프레임레이트가 많이 떨어졌습니다. 특히 전투 중에 렉이 심하게 발생합니다.`
      },
      {
        name: '컨텐츠 제안',
        text: `제목: 새로운 맵 추가 제안
본문: 새로운 맵이 나왔으면 좋겠습니다. 기존 맵이 너무 익숙해서 재미가 없어졌어요.`
      }
    ];

    for (const testCase of testCases) {
      console.log(`\n   테스트: ${testCase.name}`);
      console.log(`   텍스트: ${testCase.text.substring(0, 50)}...`);
      
      try {
        const startTime = Date.now();
        const result = await classifyIssueCategory({
          text: testCase.text,
          prisma: prisma,
          projectId: testProjectId
        });
        const elapsed = Date.now() - startTime;

        console.log(`   ⏱️  소요 시간: ${elapsed}ms`);
        console.log(`   📋 분류 방법: ${result.aiClassificationMethod || 'UNKNOWN'}`);
        
        if (result.groupId) {
          const group = await prisma.categoryGroup.findUnique({
            where: { id: result.groupId },
            select: { name: true }
          });
          console.log(`   📁 대분류: ${group?.name || 'N/A'}`);
        } else {
          console.log(`   📁 대분류: 분류되지 않음`);
        }

        if (result.categoryId) {
          const category = await prisma.category.findUnique({
            where: { id: result.categoryId },
            select: { name: true }
          });
          console.log(`   📂 중분류: ${category?.name || 'N/A'}`);
        } else {
          console.log(`   📂 중분류: 분류되지 않음`);
        }

        console.log(`   ⭐ 중요도: ${result.importance || 'N/A'}`);
        console.log(`   🔢 심각도: ${result.severity || 'N/A'}`);
        
        if (result.aiClassificationReason) {
          console.log(`   💭 AI 분류 이유: ${result.aiClassificationReason.substring(0, 100)}...`);
        }

        if (result.trend) {
          console.log(`   📊 동향/토픽: ${result.trend}`);
        }

        if (result.aiClassificationMethod === 'AI') {
          console.log(`   ✅ AI 분류 성공`);
        } else if (result.aiClassificationMethod === 'RULE') {
          console.log(`   ⚠️  규칙 기반 분류 (AI 분류 실패 또는 API 키 없음)`);
        }

      } catch (error) {
        console.log(`   ❌ 에러 발생: ${error.message}`);
        console.log(`   스택: ${error.stack?.split('\n')[1] || 'N/A'}`);
      }
    }

    // 5. 최근 AI 분류된 이슈 확인
    console.log('\n' + '='.repeat(80));
    console.log('5. 최근 AI 분류된 이슈 확인 (최근 10개):');
    console.log('-'.repeat(80));
    const recentAiIssues = await prisma.reportItemIssue.findMany({
      where: {
        aiClassificationMethod: 'AI',
        projectId: testProjectId
      },
      select: {
        id: true,
        summary: true,
        aiClassificationMethod: true,
        aiClassificationReason: true,
        categoryGroup: {
          select: { name: true }
        },
        category: {
          select: { name: true }
        },
        importance: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });

    if (recentAiIssues.length === 0) {
      console.log('   ⚠️  AI로 분류된 이슈가 없습니다.');
      console.log('   (AI 분류는 크롤링된 새로운 이슈에만 적용됩니다)\n');
    } else {
      console.log(`   총 ${recentAiIssues.length}개의 AI 분류 이슈 발견:\n`);
      recentAiIssues.forEach((issue, idx) => {
        console.log(`   ${idx + 1}. ${issue.summary?.substring(0, 40) || '제목 없음'}...`);
        console.log(`      대분류: ${issue.categoryGroup?.name || 'N/A'}`);
        console.log(`      중분류: ${issue.category?.name || 'N/A'}`);
        console.log(`      중요도: ${issue.importance || 'N/A'}`);
        console.log(`      생성일: ${issue.createdAt.toLocaleString('ko-KR')}`);
        if (issue.aiClassificationReason) {
          console.log(`      AI 이유: ${issue.aiClassificationReason.substring(0, 60)}...`);
        }
        console.log('');
      });
    }

    // 6. AIClassificationLog 확인
    console.log('='.repeat(80));
    console.log('6. AI 분류 로그 확인 (최근 5개):');
    console.log('-'.repeat(80));
    const recentLogs = await prisma.aIClassificationLog.findMany({
      select: {
        id: true,
        issueId: true,
        changedFields: true,
        createdAt: true,
        issue: {
          select: {
            summary: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    if (recentLogs.length === 0) {
      console.log('   ℹ️  AI 분류 로그가 없습니다.');
      console.log('   (사용자가 AI 분류 결과를 수정하면 로그가 생성됩니다)\n');
    } else {
      console.log(`   총 ${recentLogs.length}개의 로그 발견:\n`);
      recentLogs.forEach((log, idx) => {
        const changedFields = log.changedFields ? JSON.parse(log.changedFields) : [];
        console.log(`   ${idx + 1}. 이슈: ${log.issue?.summary?.substring(0, 40) || 'N/A'}...`);
        console.log(`      변경된 필드: ${changedFields.join(', ') || 'N/A'}`);
        console.log(`      생성일: ${log.createdAt.toLocaleString('ko-KR')}`);
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

testAIClassification();







