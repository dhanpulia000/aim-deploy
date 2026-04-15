/**
 * 최근 게시글 50개 본문 재수집 및 수정 스크립트
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, execute } = require('../libs/db');
const logger = require('../utils/logger');
const { chromium } = require('playwright');

async function extractContentFromUrl(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // iframe 확인
    const iframe = await page.$('iframe#cafe_main, iframe#cafe_main_original, iframe[name="cafe_main"]');
    let contextToUse = page;
    let isInIframe = false;

    if (iframe) {
      try {
        const frame = await iframe.contentFrame();
        if (frame) {
          contextToUse = frame;
          isInIframe = true;
        }
      } catch (e) {
        // iframe 접근 실패 시 메인 페이지 사용
      }
    }

    // 본문 추출
    const result = await contextToUse.evaluate(() => {
      let content = '';
      let usedSelector = 'none';

      // 제목 정리
      const cleanTitle = (document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                         document.querySelector('.title_text, .article_title')?.textContent?.trim() ||
                         document.title || '').replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();

      // 방법 1: se-main-container 우선 시도
      const seMainContainer = document.querySelector('.se-main-container');
      if (seMainContainer) {
        let collectedText = '';
        
        // 텍스트 요소 수집
        const textElements = seMainContainer.querySelectorAll('.se-text, .se-component-text, .se-section-text, p, div[class*="se-"]');
        const textArray = [];
        const seenTexts = new Set();
        
        textElements.forEach(el => {
          const text = el.textContent?.trim() || '';
          if (text && text.length > 1 && !text.match(/^[\s\n\r:]+$/)) {
            let isDuplicate = false;
            
            if (seenTexts.has(text)) {
              isDuplicate = true;
            } else {
              for (const seenText of seenTexts) {
                if (seenText.includes(text) && seenText.length > text.length) {
                  isDuplicate = true;
                  break;
                }
                if (text.includes(seenText) && text.length > seenText.length) {
                  const index = textArray.indexOf(seenText);
                  if (index > -1) {
                    textArray.splice(index, 1);
                    seenTexts.delete(seenText);
                  }
                  break;
                }
              }
            }
            
            if (!isDuplicate) {
              textArray.push(text);
              seenTexts.add(text);
            }
          }
        });
        
        if (textArray.length > 0) {
          collectedText = textArray.join('\n');
        } else {
          collectedText = seMainContainer.textContent?.trim() || '';
        }
        
        // 제목 제거
        if (cleanTitle && collectedText.startsWith(cleanTitle)) {
          let trimmed = collectedText.substring(cleanTitle.length).trim();
          trimmed = trimmed.replace(/^[\s\n\r:]+/, '').trim();
          if (trimmed.length >= 3) {
            collectedText = trimmed;
          }
        }
        
        // ": 네이버 카페" 제거
        collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
        collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*\n/g, '\n').trim();
        
        if (collectedText.length >= 3) {
          content = collectedText;
          usedSelector = '.se-main-container';
        }
      }

      // 방법 2: 다른 셀렉터 시도
      if (!content || content.length < 1) {
        const contentSelectors = [
          '.article_view .se-main-container',
          '.article_view .se-component',
          '.ContentRenderer',
          '#articleBodyContents',
          '.ArticleContent',
          '#content-area',
          '.article_view',
          '.se-viewer',
          '.se-section-text',
          '.se-component-text',
          '.se-text'
        ];
        
        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            let text = element.textContent?.trim() || '';
            
            // 제목 제거
            if (cleanTitle && text.startsWith(cleanTitle)) {
              let trimmed = text.substring(cleanTitle.length).trim();
              trimmed = trimmed.replace(/^[\s\n\r:]+/, '').trim();
              if (trimmed.length >= 3) {
                text = trimmed;
              }
            }
            
            // ": 네이버 카페" 제거
            text = text.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
            
            if (text.length >= 3) {
              content = text;
              usedSelector = selector;
              break;
            }
          }
        }
      }

      return {
        content: content || '',
        usedSelector,
        cleanTitle
      };
    });

    await browser.close();
    return result;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function backfillRecentIssues() {
  try {
    logger.info('[BackfillRecentIssues] Starting backfill for recent issues');

    // 본문이 비어있거나 제목과 동일한 최근 Issue 50개 찾기
    const issues = query(`
      SELECT 
        id, 
        summary, 
        detail,
        sourceUrl,
        externalPostId,
        createdAt
      FROM ReportItemIssue 
      WHERE source LIKE 'NAVER%' 
        AND sourceUrl IS NOT NULL
        AND sourceUrl != ''
        AND (
          detail IS NULL 
          OR detail = '' 
          OR detail = summary
        )
      ORDER BY createdAt DESC 
      LIMIT 50
    `);

    logger.info('[BackfillRecentIssues] Found issues to backfill', {
      count: issues.length
    });

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      
      try {
        logger.info(`[BackfillRecentIssues] Processing ${i + 1}/${issues.length}`, {
          issueId: issue.id,
          url: issue.sourceUrl,
          summary: issue.summary?.substring(0, 50)
        });

        // 본문 추출
        const result = await extractContentFromUrl(issue.sourceUrl);
        
        if (result.content && result.content.length >= 3 && result.content !== issue.summary) {
          // 본문이 제목과 다르고 3자 이상이면 업데이트
          execute(
            'UPDATE ReportItemIssue SET detail = ?, requiresLogin = 0, updatedAt = ? WHERE id = ?',
            [result.content, new Date().toISOString(), issue.id]
          );
          
          successCount++;
          logger.info('[BackfillRecentIssues] Successfully updated issue', {
            issueId: issue.id,
            oldDetailLength: issue.detail?.length || 0,
            newDetailLength: result.content.length,
            usedSelector: result.usedSelector,
            contentPreview: result.content.substring(0, 100)
          });
        } else {
          skipCount++;
          logger.info('[BackfillRecentIssues] Skipped issue (no valid content extracted)', {
            issueId: issue.id,
            contentLength: result.content?.length || 0,
            contentSameAsTitle: result.content === issue.summary
          });
        }

        // 요청 간 딜레이 (서버 부하 방지)
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        failCount++;
        logger.error('[BackfillRecentIssues] Failed to process issue', {
          issueId: issue.id,
          url: issue.sourceUrl,
          error: error.message
        });
      }
    }

    logger.info('[BackfillRecentIssues] Backfill completed', {
      total: issues.length,
      success: successCount,
      failed: failCount,
      skipped: skipCount
    });

    console.log('\n✅ 본문 재수집 완료');
    console.log(`  전체: ${issues.length}개`);
    console.log(`  성공: ${successCount}개`);
    console.log(`  실패: ${failCount}개`);
    console.log(`  스킵: ${skipCount}개`);

  } catch (error) {
    logger.error('[BackfillRecentIssues] Backfill failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  backfillRecentIssues()
    .then(() => {
      logger.info('[BackfillRecentIssues] Script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[BackfillRecentIssues] Script failed', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

module.exports = { backfillRecentIssues, extractContentFromUrl };





