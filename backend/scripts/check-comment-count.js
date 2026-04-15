/**
 * 특정 게시글의 댓글 수 수집 로직 확인
 * 
 * 실행 방법:
 * cd /home/young-dev/AIM/backend
 * node scripts/check-comment-count.js "겨울시즌되니"
 */

const { query, queryOne } = require('../libs/db');
const logger = require('../utils/logger');

async function checkCommentCount(searchTitle) {
  try {
    logger.info('댓글 수 수집 로직 확인 시작', { searchTitle });
    
    // 제목에 검색어가 포함된 이슈 찾기 (PUBG PC 또는 PUBG Mobile)
    const issues = query(
      `SELECT id, summary, detail, commentCount, scrapedComments, isHotTopic, sourceUrl, externalPostId, source, createdAt 
       FROM ReportItemIssue 
       WHERE summary LIKE ? AND (source LIKE '%PC%' OR source LIKE '%MOBILE%')
       ORDER BY createdAt DESC 
       LIMIT 10`,
      [`%${searchTitle}%`]
    );
    
    if (issues.length === 0) {
      console.log(`\n❌ "${searchTitle}" 제목을 가진 PUBG Mobile 게시글을 찾을 수 없습니다.\n`);
      return;
    }
    
    console.log(`\n=== "${searchTitle}" 제목을 가진 PUBG Mobile 게시글 (${issues.length}개) ===\n`);
    
    for (const issue of issues) {
      console.log(`📌 이슈 ID: ${issue.id}`);
      console.log(`   제목: ${issue.summary}`);
      console.log(`   URL: ${issue.sourceUrl || 'N/A'}`);
      console.log(`   댓글 수: ${issue.commentCount || 0}`);
      console.log(`   핫토픽: ${issue.isHotTopic ? '예' : '아니오'}`);
      
      if (issue.scrapedComments) {
        try {
          const comments = JSON.parse(issue.scrapedComments);
          console.log(`   수집된 댓글 개수: ${comments.length}`);
          if (comments.length > 0) {
            console.log(`   첫 번째 댓글: ${comments[0].author || '익명'}: ${(comments[0].text || '').substring(0, 50)}`);
          }
        } catch (e) {
          console.log(`   수집된 댓글: 파싱 실패`);
        }
      } else {
        console.log(`   수집된 댓글: 없음`);
      }
      
      // RawLog 확인 (metadata의 url로 찾기)
      const rawLog = queryOne(
        `SELECT id, content, metadata, createdAt 
         FROM RawLog 
         WHERE json_extract(metadata, '$.url') = ?
         ORDER BY createdAt DESC 
         LIMIT 1`,
        [issue.sourceUrl]
      );
      
      if (rawLog) {
        console.log(`   RawLog ID: ${rawLog.id}`);
        
        if (rawLog.metadata) {
          try {
            const metadata = JSON.parse(rawLog.metadata);
            console.log(`   RawLog 메타데이터 댓글 수: ${metadata.commentCount || 'N/A'}`);
            console.log(`   RawLog 메타데이터 핫토픽: ${metadata.isHotTopic ? '예' : '아니오'}`);
            console.log(`   RawLog 메타데이터 수집된 댓글: ${metadata.scrapedComments ? '있음' : '없음'}`);
          } catch (e) {
            console.log(`   RawLog 메타데이터: 파싱 실패`);
          }
        } else {
          console.log(`   RawLog 메타데이터: 없음`);
        }
      } else {
        console.log(`   RawLog: 없음`);
      }
      
      console.log(`   생성일: ${issue.createdAt}`);
      console.log('');
    }
    
    console.log('=== 댓글 수 수집 로직 요약 ===');
    console.log('1. 리스트 페이지에서 제목 옆 [숫자] 패턴 추출');
    console.log('2. 리스트 페이지 댓글 수가 0일 때만 상세 페이지에서 확인');
    console.log('3. 리스트 페이지 값이 있으면 우선 사용 (가장 정확)');
    console.log('4. 댓글 수가 10개 이상이거나 특정 작성자면 핫토픽으로 판단');
    console.log('5. 핫토픽인 경우에만 상세 댓글 내용 수집');
    console.log('============================\n');
    
  } catch (error) {
    logger.error('댓글 수 확인 실패', { error: error.message, stack: error.stack });
    console.error('오류 발생:', error);
    process.exit(1);
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  const searchTitle = process.argv[2] || '겨울시즌되니';
  checkCommentCount(searchTitle)
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('오류 발생:', error);
      process.exit(1);
    });
}

module.exports = { checkCommentCount };

