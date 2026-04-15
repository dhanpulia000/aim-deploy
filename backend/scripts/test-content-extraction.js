/**
 * 특정 URL의 본문 추출 테스트 스크립트
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../libs/db');
const { chromium } = require('playwright');

async function testContentExtraction(url) {
  console.log(`\n=== 본문 추출 테스트 ===`);
  console.log(`URL: ${url}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

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
          console.log('✓ iframe 컨텍스트 사용');
        }
      } catch (e) {
        console.log('⚠️ iframe 접근 실패, 메인 페이지 사용');
      }
    }

    // 제목 추출
    const title = await contextToUse.evaluate(() => {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
      const titleText = document.querySelector('.title_text, .article_title, h1, .article_title_text')?.textContent?.trim();
      return ogTitle || titleText || document.title || '';
    });

    console.log(`제목: ${title}`);

    // 본문 추출 시도
    const extractionResult = await contextToUse.evaluate(() => {
      let content = '';
      let usedSelector = 'none';
      const elementTexts = [];

      // 제목 정리
      const cleanTitle = (document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                         document.querySelector('.title_text, .article_title')?.textContent?.trim() ||
                         document.title || '').replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();

      // 방법 1: se-main-container 우선 시도
      const seMain = document.querySelector('.se-main-container');
      if (seMain) {
        let text = seMain.textContent?.trim() || '';
        
        // 제목 제거
        if (cleanTitle && text.startsWith(cleanTitle)) {
          text = text.substring(cleanTitle.length).trim();
          text = text.replace(/^[\s\n\r:]+/, '').trim();
        }
        
        // ": 네이버 카페" 제거
        text = text.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
        
        if (text.length >= 3) {
          content = text;
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

      // DOM 구조 정보 수집
      const seMainDebug = document.querySelector('.se-main-container');
      const articleView = document.querySelector('.article_view');
      const contentRenderer = document.querySelector('.ContentRenderer');
      const allSeElements = document.querySelectorAll('[class*="se-"]');

      return {
        content: content || '',
        usedSelector,
        cleanTitle,
        debugInfo: {
          hasSeMainContainer: !!seMainDebug,
          seMainTextLength: seMainDebug?.textContent?.trim().length || 0,
          seMainTextPreview: seMainDebug?.textContent?.trim().substring(0, 200) || '(none)',
          hasArticleView: !!articleView,
          articleViewTextLength: articleView?.textContent?.trim().length || 0,
          hasContentRenderer: !!contentRenderer,
          contentRendererTextLength: contentRenderer?.textContent?.trim().length || 0,
          allSeElementsCount: allSeElements.length,
          seElementsTexts: Array.from(allSeElements).slice(0, 3).map(el => ({
            className: el.className,
            textLength: el.textContent?.trim().length || 0,
            textPreview: el.textContent?.trim().substring(0, 100) || '(none)'
          }))
        }
      };
    });

    console.log(`\n본문 추출 결과:`);
    console.log(`  사용된 셀렉터: ${extractionResult.usedSelector}`);
    console.log(`  본문 길이: ${extractionResult.content.length}자`);
    console.log(`  본문 미리보기: ${extractionResult.content.substring(0, 200)}`);

    console.log(`\n디버깅 정보:`);
    console.log(`  .se-main-container 존재: ${extractionResult.debugInfo.hasSeMainContainer}`);
    console.log(`  .se-main-container 텍스트 길이: ${extractionResult.debugInfo.seMainTextLength}자`);
    if (extractionResult.debugInfo.seMainTextLength > 0) {
      console.log(`  .se-main-container 미리보기: ${extractionResult.debugInfo.seMainTextPreview}`);
    }
    console.log(`  .article_view 존재: ${extractionResult.debugInfo.hasArticleView}`);
    console.log(`  .article_view 텍스트 길이: ${extractionResult.debugInfo.articleViewTextLength}자`);
    console.log(`  .ContentRenderer 존재: ${extractionResult.debugInfo.hasContentRenderer}`);
    console.log(`  .ContentRenderer 텍스트 길이: ${extractionResult.debugInfo.contentRendererTextLength}자`);
    console.log(`  [class*="se-"] 요소 개수: ${extractionResult.debugInfo.allSeElementsCount}`);

    if (extractionResult.content.length === 0) {
      console.log(`\n⚠️ 본문 추출 실패!`);
      console.log(`  가능한 원인:`);
      console.log(`    1. 로그인이 필요한 게시글`);
      console.log(`    2. 셀렉터가 변경됨`);
      console.log(`    3. 동적 로딩으로 인한 지연`);
    } else {
      console.log(`\n✓ 본문 추출 성공!`);
    }

  } catch (error) {
    console.error(`\n❌ 에러 발생:`, error.message);
  } finally {
    await browser.close();
  }
}

// 명령줄 인자로 URL 받기
const url = process.argv[2];
if (!url) {
  console.log('사용법: node test-content-extraction.js <URL>');
  console.log('예시: node test-content-extraction.js "https://cafe.naver.com/f-e/cafes/28866679/articles/6154474"');
  process.exit(1);
}

testContentExtraction(url).catch(console.error);
