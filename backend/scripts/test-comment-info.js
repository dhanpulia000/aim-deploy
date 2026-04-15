/**
 * 댓글 정보 API 응답 테스트 스크립트
 * 
 * 실행 방법:
 * node backend/scripts/test-comment-info.js
 */

require('dotenv').config();
const { prisma } = require('../libs/db');
const issuesService = require('../services/issues.service');

async function testCommentInfo() {
  try {
    console.log('=== 댓글 정보 API 응답 테스트 ===\n');

    // 1. DB에서 직접 댓글이 있는 이슈 확인
    console.log('[1단계] DB에서 댓글이 있는 이슈 조회...');
    const issuesWithComments = await prisma.reportItemIssue.findMany({
      where: {
        commentCount: {
          gt: 0
        }
      },
      select: {
        id: true,
        summary: true,
        commentCount: true,
        scrapedComments: true,
        isHotTopic: true,
        createdAt: true
      },
      take: 5,
      orderBy: {
        commentCount: 'desc'
      }
    });

    console.log(`  발견된 이슈 수: ${issuesWithComments.length}`);
    if (issuesWithComments.length > 0) {
      console.log('\n  샘플 이슈:');
      issuesWithComments.forEach((issue, idx) => {
        console.log(`  ${idx + 1}. ID: ${issue.id}`);
        console.log(`     제목: ${issue.summary?.substring(0, 50)}`);
        console.log(`     댓글 수: ${issue.commentCount}`);
        console.log(`     핫토픽: ${issue.isHotTopic}`);
        console.log(`     scrapedComments 길이: ${issue.scrapedComments ? issue.scrapedComments.length : 0}`);
        if (issue.scrapedComments) {
          try {
            const parsed = JSON.parse(issue.scrapedComments);
            console.log(`     파싱된 댓글 수: ${Array.isArray(parsed) ? parsed.length : 'N/A'}`);
          } catch (e) {
            console.log(`     ⚠️ JSON 파싱 실패: ${e.message}`);
          }
        }
        console.log('');
      });
    } else {
      console.log('  ⚠️ 댓글이 있는 이슈가 없습니다.');
    }

    // 2. getAllIssues 서비스 함수 테스트
    console.log('[2단계] getAllIssues 서비스 함수 테스트...');
    const result = await issuesService.getAllIssues({
      limit: 10,
      offset: 0
    });

    console.log(`  조회된 이슈 수: ${result.issues.length}`);
    console.log(`  전체 이슈 수: ${result.total}`);

    // 댓글이 있는 이슈 필터링
    const issuesWithCommentsInResponse = result.issues.filter(issue => 
      (issue.commentCount || issue.commentsCount || 0) > 0
    );

    console.log(`  댓글이 있는 이슈 수: ${issuesWithCommentsInResponse.length}`);

    if (issuesWithCommentsInResponse.length > 0) {
      console.log('\n  API 응답 샘플:');
      issuesWithCommentsInResponse.slice(0, 3).forEach((issue, idx) => {
        console.log(`  ${idx + 1}. ID: ${issue.id}`);
        console.log(`     제목: ${issue.summary?.substring(0, 50)}`);
        console.log(`     commentCount (DB): ${issue.commentCount || '없음'}`);
        console.log(`     commentsCount (매핑): ${issue.commentsCount || '없음'}`);
        console.log(`     scrapedComments: ${issue.scrapedComments ? `있음 (${issue.scrapedComments.length}자)` : '없음'}`);
        console.log(`     isHotTopic: ${issue.isHotTopic || false}`);
        console.log('');
      });
    } else {
      console.log('  ⚠️ API 응답에 댓글이 있는 이슈가 없습니다.');
    }

    // 3. 필드 누락 확인
    console.log('[3단계] 필드 누락 확인...');
    const sampleIssue = result.issues[0];
    if (sampleIssue) {
      console.log('  샘플 이슈 필드 확인:');
      console.log(`    - commentCount: ${Object.prototype.hasOwnProperty.call(sampleIssue, 'commentCount') ? '있음' : '❌ 없음'}`);
      console.log(`    - commentsCount: ${Object.prototype.hasOwnProperty.call(sampleIssue, 'commentsCount') ? '있음' : '❌ 없음'}`);
      console.log(`    - scrapedComments: ${Object.prototype.hasOwnProperty.call(sampleIssue, 'scrapedComments') ? '있음' : '❌ 없음'}`);
      console.log(`    - isHotTopic: ${Object.prototype.hasOwnProperty.call(sampleIssue, 'isHotTopic') ? '있음' : '❌ 없음'}`);
    }

    // 4. 요약
    console.log('\n=== 테스트 결과 요약 ===');
    if (issuesWithComments.length > 0 && issuesWithCommentsInResponse.length === 0) {
      console.log('❌ 문제 발견: DB에는 댓글이 있지만 API 응답에 없습니다.');
      console.log('   -> 백엔드 조회/매핑 문제일 가능성이 높습니다.');
    } else if (issuesWithComments.length === 0) {
      console.log('⚠️ DB에 댓글이 있는 이슈가 없습니다.');
      console.log('   -> 크롤러가 댓글을 수집하지 않았거나, 아직 수집되지 않은 상태입니다.');
    } else if (issuesWithCommentsInResponse.length > 0) {
      console.log('✅ 정상: DB와 API 응답 모두 댓글 정보가 있습니다.');
      console.log('   -> 프론트엔드 렌더링을 확인하세요.');
    }

  } catch (error) {
    console.error('❌ 테스트 실패:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  testCommentInfo()
    .then(() => {
      console.log('\n테스트 완료');
      process.exit(0);
    })
    .catch((error) => {
      console.error('테스트 실패:', error);
      process.exit(1);
    });
}

module.exports = { testCommentInfo };

