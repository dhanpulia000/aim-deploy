/**
 * 특정 RawLog를 수동으로 처리하는 스크립트
 */

require('dotenv').config();
const { query, execute } = require('../libs/db');
const logger = require('../utils/logger');

// processRawLog 함수를 직접 가져오기 위해 worker 파일의 로직을 재사용
const { upsertIssueFromNaverCafe } = require('../services/naverCafeIssues.service');

async function processRawLog(rawLog) {
  try {
    // metadata 파싱
    let metadata = {};
    if (rawLog.metadata) {
      try {
        metadata = JSON.parse(rawLog.metadata);
      } catch (e) {
        logger.warn('[ManualProcess] Failed to parse metadata', { 
          rawLogId: rawLog.id,
          error: e.message 
        });
        return;
      }
    }

    // 소스별 처리
    if (rawLog.source === 'naver') {
      const url = metadata.url || '';
      const cafeGame = metadata.cafeGame || 'PUBG_PC';
      const externalPostId = metadata.externalPostId || '';
      const monitoredBoardId = metadata.monitoredBoardId || null;

      // 게시글 데이터 구성
      let title = metadata.title || '';
      let content = rawLog.content || '';
      
      // 댓글 정보 추출
      const commentCount = metadata.commentCount || 0;
      const scrapedComments = metadata.scrapedComments || null;
      const isHotTopic = metadata.isHotTopic || false;
      const requiresLogin = metadata.requiresLogin === true || metadata.requiresLogin === 'true' || metadata.requiresLogin === 1;
      
      console.log('[ManualProcess] Processing RawLog', {
        rawLogId: rawLog.id,
        title,
        requiresLogin,
        contentLength: content?.length || 0
      });
      
      // content가 비어있거나 5자 미만이면 Issue로 변환하지 않고 건너뛰기
      // 단, 로그인 필요 게시글(requiresLogin=true)은 제목만으로도 Issue로 변환
      if ((!content || content.trim().length < 5) && !requiresLogin) {
        console.log('[ManualProcess] Skipping - empty content and not login-required');
        return;
      }
      
      // 로그인 필요 게시글은 제목을 content로 사용 (본문이 비어있는 경우)
      if (requiresLogin && (!content || content.trim().length < 5)) {
        content = title || '로그인 필요 게시글';
        console.log('[ManualProcess] Using title as content for login-required post');
      }
      
      // 제목에서 ": 네이버 카페" 제거
      if (title) {
        title = title.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
      }
      
      // content에서 제목 제거
      if (content && title && title.length > 0) {
        if (content.startsWith(title)) {
          content = content.substring(title.length).trim();
          content = content.replace(/^[\s\n\r:]+/, '').trim();
        }
      }
      
      // 게시글 데이터로 Issue 생성/업데이트
      const post = {
        title,
        content,
        author: rawLog.author || '',
        postDate: rawLog.timestamp || new Date().toISOString(),
        externalPostId
      };
      
      console.log('[ManualProcess] Calling upsertIssueFromNaverCafe', {
        title: post.title,
        contentLength: post.content?.length || 0,
        requiresLogin
      });
      
      let postImagePaths = metadata.postImagePaths;
      if (typeof postImagePaths === 'string') {
        try {
          postImagePaths = JSON.parse(postImagePaths);
        } catch {
          postImagePaths = null;
        }
      }
      if (!Array.isArray(postImagePaths) || postImagePaths.length === 0) {
        postImagePaths = null;
      }

      await upsertIssueFromNaverCafe({
        url,
        cafeGame,
        post,
        comments: scrapedComments,
        monitoredUrlId: null,
        monitoredBoardId,
        screenshotPath: metadata.screenshotPath || null,
        postImagePaths: postImagePaths || undefined,
        hasImages: metadata.hasImages || false,
        requiresLogin,
        commentCount,
        scrapedComments,
        isHotTopic
      });
      
      // isProcessed 플래그 업데이트
      execute(
        'UPDATE RawLog SET isProcessed = ?, updatedAt = ? WHERE id = ?',
        [1, new Date().toISOString(), rawLog.id]
      );
      
      console.log('[ManualProcess] Successfully processed RawLog', { rawLogId: rawLog.id });
    }
  } catch (error) {
    logger.error('[ManualProcess] Error processing RawLog', {
      rawLogId: rawLog.id,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function main() {
  const rawLogIds = process.argv.slice(2);
  
  if (rawLogIds.length === 0) {
    console.log('Usage: node manual-process-rawlog.js <rawLogId1> [rawLogId2] ...');
    process.exit(1);
  }
  
  console.log('Processing RawLogs:', rawLogIds);
  
  for (const rawLogId of rawLogIds) {
    const rawLogs = query('SELECT * FROM RawLog WHERE id = ?', [rawLogId]);
    
    if (rawLogs.length === 0) {
      console.log(`RawLog not found: ${rawLogId}`);
      continue;
    }
    
    const rawLog = rawLogs[0];
    console.log(`\nProcessing RawLog: ${rawLogId}`);
    console.log(`Title: ${JSON.parse(rawLog.metadata || '{}').title || '(no title)'}`);
    
    try {
      await processRawLog(rawLog);
      console.log(`✓ Successfully processed: ${rawLogId}`);
    } catch (error) {
      console.error(`✗ Failed to process: ${rawLogId}`, error.message);
    }
  }
  
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { processRawLog };

