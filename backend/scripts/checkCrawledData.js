/**
 * 크롤링된 데이터의 제목과 본문 확인 스크립트
 */

require('dotenv').config();
const { prisma } = require('../libs/db');

async function checkCrawledData() {
  try {
    console.log('크롤링된 데이터 확인 중...\n');

    // 최근 크롤링된 이슈 조회 (NAVER_CAFE 소스)
    const issues = await prisma.reportItemIssue.findMany({
      where: {
        source: {
          startsWith: 'NAVER_CAFE'
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5, // 최근 5개만
      select: {
        id: true,
        summary: true,
        detail: true,
        source: true,
        externalSource: true,
        createdAt: true,
        sourceUrl: true
      }
    });

    if (issues.length === 0) {
      console.log('크롤링된 데이터가 없습니다.');
      return;
    }

    console.log(`총 ${issues.length}개의 크롤링된 이슈를 찾았습니다.\n`);
    console.log('='.repeat(80));

    issues.forEach((issue, index) => {
      console.log(`\n[${index + 1}] 이슈 ID: ${issue.id}`);
      console.log(`소스: ${issue.externalSource || issue.source}`);
      console.log(`생성일: ${issue.createdAt}`);
      console.log(`URL: ${issue.sourceUrl || 'N/A'}`);
      console.log('\n--- 제목 (summary) ---');
      console.log(issue.summary || '(제목 없음)');
      console.log(`제목 길이: ${(issue.summary || '').length}자`);
      console.log('\n--- 본문 (detail) ---');
      console.log(issue.detail || '(본문 없음)');
      console.log(`본문 길이: ${(issue.detail || '').length}자`);
      
      // 제목과 본문이 동일한지 확인
      if (issue.summary && issue.detail) {
        const summaryTrimmed = issue.summary.trim();
        const detailTrimmed = issue.detail.trim();
        if (summaryTrimmed === detailTrimmed) {
          console.log('\n⚠️ 경고: 제목과 본문이 동일합니다!');
        } else if (detailTrimmed.startsWith(summaryTrimmed)) {
          console.log('\n⚠️ 경고: 본문이 제목으로 시작합니다!');
        } else {
          console.log('\n✓ 제목과 본문이 올바르게 분리되어 있습니다.');
        }
      }
      
      console.log('\n' + '='.repeat(80));
    });

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkCrawledData();




















