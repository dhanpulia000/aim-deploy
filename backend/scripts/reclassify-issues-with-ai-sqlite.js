/**
 * AI가 분류하지 않은 모든 이슈를 AI로 재분류하는 스크립트 (better-sqlite3 버전)
 * 
 * 사용법:
 *   node scripts/reclassify-issues-with-ai-sqlite.js [projectId]
 * 
 * 예시:
 *   node scripts/reclassify-issues-with-ai-sqlite.js        # 모든 프로젝트
 *   node scripts/reclassify-issues-with-ai-sqlite.js 1      # 프로젝트 ID 1만
 */

require('dotenv').config();
const { query, queryOne, execute } = require('../libs/db');
const { classifyIssueCategory } = require('../services/issueClassifier');
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

/** 네이버 수집 경로와 동일: 중분류가 있으면 Category.importance로 severity/importance 확정 */
function applyCategoryFirstSeverity(classification) {
  if (!classification || !classification.categoryId) return classification;
  const cat = queryOne('SELECT importance FROM Category WHERE id = ?', [classification.categoryId]);
  if (!cat || !cat.importance) return classification;
  const map = { HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sev = map[cat.importance] ?? 2;
  return {
    ...classification,
    importance: cat.importance,
    severity: sev
  };
}

async function reclassifyBatch(limit, projectId = null) {
  let sql = `
    SELECT id, summary, detail, scrapedComments, projectId, importance, 
           categoryGroupId, categoryId, severity, aiClassificationMethod
    FROM ReportItemIssue
    WHERE (aiClassificationMethod IS NULL OR aiClassificationMethod != 'AI')
  `;
  const params = [];
  
  if (projectId) {
    sql += ' AND projectId = ?';
    params.push(projectId);
  }
  
  // OFFSET 누적 금지: 한 배치 처리 후 동일 조건에서 다시 앞에서부터 가져와야 함
  sql += ' ORDER BY createdAt DESC LIMIT ?';
  params.push(limit);
  
  const issues = query(sql, params);
  
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
      const { db } = require('../libs/db');
      const raw = await classifyIssueCategory({
        text: text,
        db: db,
        projectId: issue.projectId
      });
      const classification = applyCategoryFirstSeverity(raw);

      // AI 분류 성공한 경우만 업데이트 (groupId는 필수)
      if (classification.aiClassificationMethod === 'AI' && classification.groupId) {
        const updateFields = [];
        const updateParams = [];
        
        if (classification.importance) {
          updateFields.push('importance = ?');
          updateParams.push(classification.importance);
        }
        if (classification.groupId) {
          updateFields.push('categoryGroupId = ?');
          updateParams.push(classification.groupId);
        }
        if (classification.categoryId !== undefined) {
          updateFields.push('categoryId = ?');
          updateParams.push(classification.categoryId || null);
        }
        if (classification.severity !== undefined && classification.severity !== null) {
          updateFields.push('severity = ?');
          updateParams.push(classification.severity);
        }
        if (classification.sentiment) {
          updateFields.push('sentiment = ?');
          updateParams.push(classification.sentiment);
        }
        if (classification.trend !== undefined) {
          updateFields.push('trend = ?');
          updateParams.push(classification.trend || null);
        }
        if (classification.otherGameTitle !== undefined) {
          updateFields.push('otherGameTitle = ?');
          updateParams.push(classification.otherGameTitle || null);
        }
        
        updateFields.push('aiClassificationMethod = ?');
        updateParams.push('AI');
        
        if (classification.aiClassificationReason) {
          updateFields.push('aiClassificationReason = ?');
          updateParams.push(classification.aiClassificationReason);
        }
        
        updateFields.push('updatedAt = ?');
        updateParams.push(new Date().toISOString());
        
        updateParams.push(issue.id);
        
        execute(
          `UPDATE ReportItemIssue SET ${updateFields.join(', ')} WHERE id = ?`,
          updateParams
        );
        
        successCount++;
        logger.info(`[Reclassify] Issue ${issue.id.substring(0, 10)}... classified`, {
          groupId: classification.groupId,
          categoryId: classification.categoryId
        });
      } else {
        skipCount++;
        logger.debug(`[Reclassify] Issue ${issue.id.substring(0, 10)}... skipped (no AI classification or missing groupId)`);
      }
    } catch (error) {
      errorCount++;
      logger.error(`[Reclassify] Failed to classify issue ${issue.id}`, {
        error: error.message
      });
    }
  }
  
  return { successCount, skipCount, errorCount, batchRowCount: issues.length };
}

async function main() {
  const projectId = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  
  if (projectId && isNaN(projectId)) {
    console.error('❌ Invalid project ID:', process.argv[2]);
    process.exit(1);
  }
  
  console.log('🚀 AI 재분류 시작...');
  if (projectId) {
    console.log(`📌 프로젝트 ID: ${projectId}`);
  } else {
    console.log('📌 모든 프로젝트');
  }
  
  const BATCH_SIZE = 10; // 한 번에 처리할 이슈 수
  let totalSuccess = 0;
  let totalSkip = 0;
  let totalError = 0;
  
  // 전체 개수 확인
  let countSql = "SELECT COUNT(*) as count FROM ReportItemIssue WHERE (aiClassificationMethod IS NULL OR aiClassificationMethod != 'AI')";
  const countParams = [];
  if (projectId) {
    countSql += ' AND projectId = ?';
    countParams.push(projectId);
  }
  const totalCount = queryOne(countSql, countParams).count;
  
  console.log(`📊 재분류 대상 이슈: ${totalCount}개\n`);
  
  let batches = 0;
  let noSuccessStreak = 0;
  const MAX_NO_SUCCESS_BATCHES = 5;

  while (true) {
    const result = await reclassifyBatch(BATCH_SIZE, projectId);
    totalSuccess += result.successCount;
    totalSkip += result.skipCount;
    totalError += result.errorCount;
    batches += 1;

    if (result.successCount === 0 && result.batchRowCount > 0) {
      noSuccessStreak += 1;
    } else {
      noSuccessStreak = 0;
    }

    const doneApprox = Math.min(totalSuccess + totalSkip + totalError, batches * BATCH_SIZE);
    const percentage = totalCount > 0 ? ((doneApprox / totalCount) * 100).toFixed(1) : 0;

    console.log(`배치 ${batches} — 누적 성공: ${totalSuccess}, 건너뜀: ${totalSkip}, 오류: ${totalError} (대략 진행 ${percentage}%)`);

    if (result.batchRowCount === 0) {
      break;
    }

    if (noSuccessStreak >= MAX_NO_SUCCESS_BATCHES) {
      console.warn(
        `⚠️ 연속 ${MAX_NO_SUCCESS_BATCHES}배치에서 AI 갱신 성공이 0건입니다. 동일 대상이 반복될 수 있어 중단합니다. OpenAI 키·쿼터·네트워크를 확인하세요.`
      );
      break;
    }

    // API 호출 제한을 고려한 딜레이 (OpenAI Rate Limit)
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
  }
  
  console.log('\n✅ 재분류 완료!');
  console.log(`📊 결과:`);
  console.log(`  - 성공: ${totalSuccess}개`);
  console.log(`  - 건너뜀: ${totalSkip}개`);
  console.log(`  - 오류: ${totalError}개`);
  console.log(`  - 총 처리: ${totalSuccess + totalSkip + totalError}개`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ 재분류 실패:', error);
    process.exit(1);
  });
}

module.exports = { reclassifyBatch, main };



