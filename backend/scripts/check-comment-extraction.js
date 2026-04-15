/**
 * 네이버 카페 리스트 페이지에서 댓글 수 추출 로직 테스트
 * 
 * 실제 네이버 카페 페이지 구조를 확인하여 댓글 수 추출이 제대로 작동하는지 테스트합니다.
 */

require('dotenv').config();
const { chromium } = require('playwright');
const logger = require('../utils/logger');

async function testCommentExtraction() {
  let browser = null;
  let page = null;

  try {
    console.log('='.repeat(80));
    console.log('네이버 카페 댓글 수 추출 테스트');
    console.log('='.repeat(80));
    console.log();

    browser = await chromium.launch({ headless: false });
    page = await browser.newPage();

    // 테스트할 네이버 카페 URL (실제 카페 URL 사용)
    const testUrl = 'https://cafe.naver.com/f-e/cafes/28866679/articles';
    
    console.log(`테스트 URL: ${testUrl}`);
    console.log('페이지 로딩 중...');
    console.log();

    await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // iframe 확인
    let context = page;
    try {
      const frame = await page.frame({ name: 'cafe_main' }) || 
                   await page.frame({ url: /cafe_main/ });
      if (frame) {
        context = frame;
        console.log('iframe 컨텍스트 사용');
      }
    } catch (e) {
      console.log('메인 페이지 컨텍스트 사용');
    }

    // 댓글 수 추출 테스트
    const results = await context.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const results = [];

      rows.slice(0, 10).forEach((row, index) => {
        const link = row.querySelector('a.article, a[href*="/ArticleRead.nhn"], a[href*="/ArticleDetail.nhn"]');
        const title = link?.textContent?.trim() || '';
        
        // 현재 코드의 댓글 수 추출 로직
        let commentCount = 0;
        const commentElement = row.querySelector(
          '.comment_count, .reply_count, .cmt_count, ' +
          '[class*="comment"], [class*="reply"], .comment, .reply'
        );
        
        if (commentElement) {
          const commentText = commentElement.textContent?.trim() || '';
          const match = commentText.match(/(\d+)/);
          if (match) {
            commentCount = parseInt(match[1], 10) || 0;
          }
        }

        // 추가 디버깅: 모든 가능한 댓글 관련 요소 찾기
        const allCommentElements = row.querySelectorAll(
          '[class*="comment"], [class*="reply"], [id*="comment"], [id*="reply"]'
        );
        
        const debugInfo = {
          title: title.substring(0, 50),
          commentCount: commentCount,
          foundElement: !!commentElement,
          elementText: commentElement?.textContent?.trim() || null,
          allCommentElements: Array.from(allCommentElements).map(el => ({
            tag: el.tagName,
            class: el.className,
            id: el.id,
            text: el.textContent?.trim()
          }))
        };

        results.push(debugInfo);
      });

      return results;
    });

    console.log('댓글 수 추출 결과:');
    console.log('-'.repeat(80));
    console.log();

    results.forEach((result, index) => {
      console.log(`${index + 1}. ${result.title}`);
      console.log(`   추출된 댓글 수: ${result.commentCount}`);
      console.log(`   댓글 요소 발견: ${result.foundElement ? '✅' : '❌'}`);
      if (result.elementText) {
        console.log(`   요소 텍스트: "${result.elementText}"`);
      }
      if (result.allCommentElements.length > 0) {
        console.log(`   발견된 댓글 관련 요소: ${result.allCommentElements.length}개`);
        result.allCommentElements.slice(0, 3).forEach(el => {
          console.log(`     - ${el.tag}.${el.class || '(no class)'}#${el.id || '(no id)'}: "${el.text?.substring(0, 30)}"`);
        });
      }
      console.log();
    });

    console.log('='.repeat(80));
    console.log('테스트 완료');
    console.log('='.repeat(80));

  } catch (error) {
    logger.error('테스트 실패', { error: error.message, stack: error.stack });
    console.error('에러:', error.message);
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
  }
}

testCommentExtraction();





