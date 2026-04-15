/**
 * [DEPRECATED] 게시판 스캐너 서비스
 * 
 * 이 파일은 새로운 고성능 모니터링 모듈로 대체되었습니다.
 * 참고용으로만 보관됩니다.
 * 
 * @deprecated 새로운 모니터링 모듈 사용을 권장합니다.
 * @date 2025-01-XX
 * 
 * MonitoredBoard를 주기적으로 스캔하여 새로운 게시글을 감지하고
 * 상세 내용을 크롤링하여 Issue로 변환합니다.
 */

const { query, queryOne, execute } = require('../libs/db');
const { fetchNaverCafeBoardPosts } = require('./scraper/naverCafeBoardScraper');
const { fetchNaverCafePost } = require('./scraper/naverCafeScraper');
const { upsertIssueFromNaverCafe } = require('./naverCafeIssues.service');
const logger = require('../utils/logger');

/**
 * 모든 활성화된 MonitoredBoard를 스캔
 * 
 * - 각 게시판의 목록 페이지를 가져옴
 * - lastArticleId 이후의 새 게시글만 처리
 * - 첫 스캔 시에는 모든 게시글을 가져오지 않고 최신 articleId만 저장
 */
async function scanMonitoredBoards() {
  try {
    const boards = query('SELECT * FROM MonitoredBoard WHERE enabled = ?', [1]);

    if (boards.length === 0) {
      logger.debug('[BoardScanner] No enabled boards to scan');
      return;
    }

    const now = new Date();
    logger.info('[BoardScanner] Scanning boards', { count: boards.length });

    for (const board of boards) {
      // Interval 체크: lastScanAt이 최근이면 스킵
      if (board.lastScanAt) {
        const diffSec = (now.getTime() - new Date(board.lastScanAt).getTime()) / 1000;
        if (diffSec < board.interval) {
          logger.debug('[BoardScanner] Skipping (too recent)', {
            boardId: board.id,
            label: board.label,
            lastScanAt: board.lastScanAt,
            interval: board.interval
          });
          continue;
        }
      }

      try {
        logger.info('[BoardScanner] Fetching board list', {
          boardId: board.id,
          label: board.label,
          listUrl: board.listUrl,
          cafeGame: board.cafeGame
        });

        // 게시판 목록 페이지에서 게시글 목록 가져오기
        const posts = await fetchNaverCafeBoardPosts(board.listUrl, board.cafeGame);

        if (!Array.isArray(posts) || posts.length === 0) {
          logger.warn('[BoardScanner] No posts found', {
            boardId: board.id,
            listUrl: board.listUrl
          });
          
          // lastScanAt만 업데이트
          execute(
            'UPDATE MonitoredBoard SET lastScanAt = ?, updatedAt = ? WHERE id = ?',
            [now.toISOString(), now.toISOString(), board.id]
          );
          continue;
        }

        // articleId를 숫자로 변환하여 정렬
        const normalizedPosts = posts
          .map((p) => {
            const articleIdNum = parseInt(p.externalPostId, 10) || 0;
            return {
              ...p,
              articleIdNum
            };
          })
          .filter((p) => p.articleIdNum > 0) // 유효한 articleId만
          .sort((a, b) => a.articleIdNum - b.articleIdNum); // 오름차순 정렬

        let lastArticleIdNum = board.lastArticleId
          ? parseInt(board.lastArticleId, 10) || 0
          : 0;

        // 첫 스캔 전략: lastArticleId가 없으면 최신 articleId만 저장하고 종료
        if (!board.lastArticleId && normalizedPosts.length > 0) {
          const maxId = normalizedPosts[normalizedPosts.length - 1].articleIdNum;
          execute(
            'UPDATE MonitoredBoard SET lastArticleId = ?, lastScanAt = ?, updatedAt = ? WHERE id = ?',
            [String(maxId), now.toISOString(), now.toISOString(), board.id]
          );
          logger.info('[BoardScanner] Initial scan completed, baseline set', {
            boardId: board.id,
            lastArticleId: String(maxId),
            totalPosts: normalizedPosts.length
          });
          continue;
        }

        // 새 게시글만 필터링 (articleId > lastArticleId)
        const newPosts = normalizedPosts.filter(
          (p) => p.articleIdNum > lastArticleIdNum
        );

        if (newPosts.length === 0) {
          logger.debug('[BoardScanner] No new posts', {
            boardId: board.id,
            lastArticleId: board.lastArticleId
          });
          
          execute(
            'UPDATE MonitoredBoard SET lastScanAt = ?, updatedAt = ? WHERE id = ?',
            [now.toISOString(), now.toISOString(), board.id]
          );
          continue;
        }

        logger.info('[BoardScanner] Found new posts', {
          boardId: board.id,
          count: newPosts.length,
          articleIdRange: `${newPosts[0].articleIdNum} ~ ${newPosts[newPosts.length - 1].articleIdNum}`
        });

        // 각 새 게시글의 상세 내용 크롤링 및 Issue 생성
        for (const postInfo of newPosts) {
          try {
            logger.debug('[BoardScanner] Fetching post details', {
              articleId: postInfo.externalPostId,
              title: postInfo.title
            });

            // 게시글 상세 내용 가져오기
            const { post, comments } = await fetchNaverCafePost(
              postInfo.articleUrl,
              board.cafeGame
            );

            // 목록에서 가져온 정보로 보완
            post.externalPostId = postInfo.externalPostId || post.externalPostId;
            post.title = post.title || postInfo.title;
            post.createdAt = post.createdAt || postInfo.createdAt;

            // Issue로 변환
            await upsertIssueFromNaverCafe({
              url: postInfo.articleUrl,
              cafeGame: board.cafeGame,
              post,
              comments,
              monitoredUrlId: null, // 게시판에서 온 경우는 null
              monitoredBoardId: board.id
            });

            // lastArticleId 업데이트 (진행하면서 최신 articleId 추적)
            lastArticleIdNum = Math.max(lastArticleIdNum, postInfo.articleIdNum);

            logger.debug('[BoardScanner] Post processed', {
              articleId: postInfo.externalPostId,
              issueCreated: true
            });
          } catch (err) {
            logger.error('[BoardScanner] Failed to process post', {
              boardId: board.id,
              articleId: postInfo.externalPostId,
              error: err.message,
              stack: err.stack
            });
            // 개별 게시글 실패는 계속 진행
          }
        }

        // 게시판의 lastArticleId 및 lastScanAt 업데이트
        if (lastArticleIdNum > 0) {
          execute(
            'UPDATE MonitoredBoard SET lastArticleId = ?, lastScanAt = ?, updatedAt = ? WHERE id = ?',
            [String(lastArticleIdNum), now.toISOString(), now.toISOString(), board.id]
          );
          logger.info('[BoardScanner] Board scan completed', {
            boardId: board.id,
            newPostsCount: newPosts.length,
            lastArticleId: String(lastArticleIdNum)
          });
        } else {
          execute(
            'UPDATE MonitoredBoard SET lastScanAt = ?, updatedAt = ? WHERE id = ?',
            [now.toISOString(), now.toISOString(), board.id]
          );
        }
      } catch (err) {
        logger.error('[BoardScanner] Failed to scan board', {
          boardId: board.id,
          listUrl: board.listUrl,
          error: err.message,
          stack: err.stack
        });
        // 개별 게시판 실패는 전체 스캐너를 중단하지 않음
      }
    }
  } catch (err) {
    logger.error('[BoardScanner] Unexpected error in scanner', {
      error: err.message,
      stack: err.stack
    });
  }
}

module.exports = {
  scanMonitoredBoards
};



