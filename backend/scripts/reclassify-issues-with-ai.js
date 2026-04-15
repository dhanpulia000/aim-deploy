/**
 * 기존 이슈(ReportItemIssue)를 현재 카테고리/중요도 체계 기준으로 재분류하는 스크립트
 *
 * - AI 분류기를 우선 사용하고, 실패 시 규칙 기반 분류로 폴백합니다.
 * - categoryGroupId, categoryId, importance, severity, trend, otherGameTitle,
 *   aiClassificationReason, aiClassificationMethod 필드를 업데이트합니다.
 *
 * 사용 방법:
 *   cd backend
 *   node scripts/reclassify-issues-with-ai.js
 */

/* eslint-disable no-console */

require('dotenv').config();
const { prisma } = require('../libs/db');
const { classifyIssueCategory } = require('../services/issueClassifier');

const BATCH_SIZE = 50;

function buildIssueText(issue) {
  const parts = [];
  if (issue.summary) parts.push(`[요약]\n${issue.summary}`);
  if (issue.detail) parts.push(`[상세]\n${issue.detail}`);
  if (issue.testResult) parts.push(`[테스트 결과]\n${issue.testResult}`);
  if (issue.link) parts.push(`[링크]\n${issue.link}`);
  if (issue.scrapedComments) parts.push(`[유저 댓글]\n${issue.scrapedComments}`);
  return parts.join('\n\n');
}

async function reclassifyBatch(skip) {
  const issues = await prisma.reportItemIssue.findMany({
    skip,
    take: BATCH_SIZE,
    orderBy: { createdAt: 'asc' }
  });

  if (issues.length === 0) {
    return 0;
  }

  console.log(`\n[Batch] ${skip} ~ ${skip + issues.length - 1}번째 이슈 재분류 중...`);

  let updatedCount = 0;

  for (const issue of issues) {
    const text = buildIssueText(issue);
    if (!text || text.trim().length === 0) {
      console.log(`- 이슈 ${issue.id}: 내용이 없어 건너뜀`);
      continue;
    }

    try {
      const classification = await classifyIssueCategory({
        text,
        projectId: issue.projectId || null
      });

      if (!classification) {
        console.log(`- 이슈 ${issue.id}: 분류 결과 없음 (건너뜀)`);
        continue;
      }

      const updateData = {};

      if (classification.groupId) {
        updateData.categoryGroupId = classification.groupId;
      }
      if (classification.categoryId) {
        updateData.categoryId = classification.categoryId;
      }
      if (classification.importance) {
        updateData.importance = classification.importance;
      }
      if (classification.severity != null) {
        updateData.severity = classification.severity;
      }
      if (classification.trend !== undefined) {
        updateData.trend = classification.trend || null;
      }
      if (classification.otherGameTitle !== undefined) {
        updateData.otherGameTitle = classification.otherGameTitle || null;
      }
      if (classification.aiClassificationReason !== undefined) {
        updateData.aiClassificationReason = classification.aiClassificationReason || null;
      }
      if (classification.aiClassificationMethod !== undefined) {
        updateData.aiClassificationMethod = classification.aiClassificationMethod || null;
      }

      if (Object.keys(updateData).length === 0) {
        console.log(`- 이슈 ${issue.id}: 변경할 필드 없음 (건너뜀)`);
        continue;
      }

      await prisma.reportItemIssue.update({
        where: { id: issue.id },
        data: updateData
      });

      updatedCount += 1;
      console.log(
        `- 이슈 ${issue.id} 재분류 완료: groupId=${updateData.categoryGroupId ?? issue.categoryGroupId}, ` +
          `categoryId=${updateData.categoryId ?? issue.categoryId}, ` +
          `importance=${updateData.importance ?? issue.importance}, ` +
          `severity=${updateData.severity ?? issue.severity}`
      );
    } catch (error) {
      console.error(`- 이슈 ${issue.id} 재분류 실패:`, error.message);
    }
  }

  return updatedCount;
}

async function main() {
  console.log('기존 이슈 재분류 시작...\n');

  let skip = 0;
  let totalUpdated = 0;

  // 전체 개수 파악
  const totalIssues = await prisma.reportItemIssue.count();
  console.log(`전체 이슈 수: ${totalIssues}개`);

  while (true) {
    const updated = await reclassifyBatch(skip);
    if (updated === 0 && skip >= totalIssues) {
      break;
    }
    totalUpdated += updated;
    skip += BATCH_SIZE;
  }

  console.log('\n재분류 완료!');
  console.log(`총 업데이트된 이슈 수: ${totalUpdated}개`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('스크립트 실행 중 오류:', error);
  prisma.$disconnect().finally(() => {
    process.exit(1);
  });
});










