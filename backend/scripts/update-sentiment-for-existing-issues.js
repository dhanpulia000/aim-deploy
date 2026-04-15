/**
 * 기존 이슈들의 센티멘트를 AI로 재분류하는 스크립트
 * 
 * 사용법:
 *   node scripts/update-sentiment-for-existing-issues.js [projectId] [--force]
 * 
 * 예시:
 *   node scripts/update-sentiment-for-existing-issues.js        # 모든 프로젝트, sentiment가 'neu'인 이슈만
 *   node scripts/update-sentiment-for-existing-issues.js 1    # 프로젝트 ID 1만
 *   node scripts/update-sentiment-for-existing-issues.js --force  # 모든 이슈 재분류 (neu가 아닌 것도 포함)
 */

require('dotenv').config();
const { query, queryOne, execute } = require('../libs/db');
const { analyzeSentimentWithAI } = require('../services/aiIssueClassifier');
const logger = require('../utils/logger');

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

async function updateSentimentBatch(skip, limit, projectId = null, force = false) {
  let sql = `
    SELECT id, summary, detail, scrapedComments, projectId, sentiment
    FROM ReportItemIssue
    WHERE 1=1
  `;
  const params = [];
  
  if (projectId) {
    sql += ' AND projectId = ?';
    params.push(projectId);
  }
  
  // force가 false면 sentiment가 'neu'인 이슈만, true면 모든 이슈
  if (!force) {
    sql += " AND (sentiment IS NULL OR sentiment = 'neu')";
  }
  
  sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
  params.push(limit, skip);
  
  const issues = query(sql, params);
  
  if (issues.length === 0) {
    return { successCount: 0, skipCount: 0, errorCount: 0, total: 0 };
  }
  
  logger.info(`[UpdateSentiment] Processing batch`, {
    skip,
    limit,
    count: issues.length,
    projectId,
    force
  });
  
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  
  for (const issue of issues) {
    try {
      const text = buildIssueText(issue);
      
      if (!text || text.trim().length === 0) {
        logger.debug(`[UpdateSentiment] Skipping issue ${issue.id} (no content)`);
        skipCount++;
        continue;
      }
      
      // AI 센티멘트 분석
      const sentimentResult = await analyzeSentimentWithAI({ text });
      
      if (sentimentResult && sentimentResult.sentiment) {
        const newSentiment = sentimentResult.sentiment;
        
        // sentiment가 변경된 경우만 업데이트
        if (issue.sentiment !== newSentiment) {
          execute(
            'UPDATE ReportItemIssue SET sentiment = ?, updatedAt = ? WHERE id = ?',
            [newSentiment, new Date().toISOString(), issue.id]
          );
          
          logger.info(`[UpdateSentiment] Updated sentiment`, {
            issueId: issue.id,
            oldSentiment: issue.sentiment || 'null',
            newSentiment,
            reason: sentimentResult.reason?.substring(0, 50)
          });
          
          successCount++;
        } else {
          logger.debug(`[UpdateSentiment] Sentiment unchanged`, {
            issueId: issue.id,
            sentiment: newSentiment
          });
          skipCount++;
        }
      } else {
        logger.warn(`[UpdateSentiment] No sentiment result`, { issueId: issue.id });
        skipCount++;
      }
      
      // API 호출 제한을 위한 짧은 대기
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      logger.error(`[UpdateSentiment] Failed to update issue ${issue.id}`, {
        error: error.message,
        stack: error.stack
      });
      errorCount++;
    }
  }
  
  return { successCount, skipCount, errorCount, total: issues.length };
}

async function main() {
  const args = process.argv.slice(2);
  let projectId = null;
  let force = false;
  
  // 인자 파싱
  for (const arg of args) {
    if (arg === '--force') {
      force = true;
    } else if (!isNaN(Number(arg))) {
      projectId = Number(arg);
    }
  }
  
  logger.info('[UpdateSentiment] Starting sentiment update for existing issues', {
    projectId: projectId || 'all',
    force
  });
  
  const BATCH_SIZE = 10; // 한 번에 처리할 이슈 수
  let skip = 0;
  let totalSuccess = 0;
  let totalSkip = 0;
  let totalError = 0;
  let totalProcessed = 0;
  
  while (true) {
    const result = await updateSentimentBatch(skip, BATCH_SIZE, projectId, force);
    
    totalSuccess += result.successCount;
    totalSkip += result.skipCount;
    totalError += result.errorCount;
    totalProcessed += result.total;
    
    logger.info(`[UpdateSentiment] Batch completed`, {
      skip,
      batchSize: BATCH_SIZE,
      success: result.successCount,
      skip: result.skipCount,
      error: result.errorCount,
      total: result.total,
      cumulative: {
        success: totalSuccess,
        skip: totalSkip,
        error: totalError,
        processed: totalProcessed
      }
    });
    
    // 더 이상 처리할 이슈가 없으면 종료
    if (result.total === 0) {
      break;
    }
    
    skip += BATCH_SIZE;
    
    // 배치 간 대기 (API 호출 제한 고려)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  logger.info('[UpdateSentiment] Completed sentiment update', {
    totalSuccess,
    totalSkip,
    totalError,
    totalProcessed
  });
  
  console.log('\n=== 센티멘트 업데이트 완료 ===');
  console.log(`성공: ${totalSuccess}개`);
  console.log(`스킵: ${totalSkip}개`);
  console.log(`에러: ${totalError}개`);
  console.log(`총 처리: ${totalProcessed}개`);
}

// 스크립트 직접 실행 시
if (require.main === module) {
  main().catch(error => {
    logger.error('[UpdateSentiment] Fatal error', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
}

module.exports = { updateSentimentBatch, main };











