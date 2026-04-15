/**
 * 본문 추출 디버깅 스크립트
 * 실제 Naver Cafe 페이지에서 어떤 셀렉터가 작동하는지 확인
 */

require('dotenv').config();
const { chromium } = require('playwright');
const { prisma } = require('../libs/db');

async function debugContentExtraction() {
  let browser = null;
  
  try {
    console.log('본문 추출 디버깅 시작...\n');

    // 최근 크롤링된 이슈 중 하나의 URL 가져오기
    const issue = await prisma.reportItemIssue.findFirst({
      where: {
        source: {
          startsWith: 'NAVER_CAFE'
        },
        sourceUrl: {
          not: null
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        sourceUrl: true,
        summary: true,
        detail: true
      }
    });

    if (!issue || !issue.sourceUrl) {
      console.log('크롤링된 이슈가 없거나 URL이 없습니다.');
      return;
    }

    console.log(`테스트 URL: ${issue.sourceUrl}`);
    console.log(`현재 제목: ${issue.summary}`);
    console.log(`현재 본문: ${issue.detail || '(없음)'}`);
    console.log('\n' + '='.repeat(80) + '\n');

    // 브라우저 시작
    browser = await chromium.launch({
      headless: false, // 디버깅을 위해 headless=false
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // 쿠키 로드
    const cookie = process.env.NAVER_CAFE_COOKIE;
    if (cookie) {
      const cookies = cookie.split(';').map(cookieStr => {
        const [name, value] = cookieStr.trim().split('=');
        return {
          name: name.trim(),
          value: value?.trim() || '',
          domain: '.naver.com',
          path: '/'
        };
      }).filter(c => c.name && c.value);
      
      if (cookies.length > 0) {
        await page.context().addCookies(cookies);
        console.log(`쿠키 로드: ${cookies.length}개\n`);
      }
    }

    // User-Agent 설정
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    console.log('페이지 로딩 중...');
    await page.goto(issue.sourceUrl, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    console.log('페이지 로드 완료\n');

    // 디버깅: 모든 가능한 셀렉터 테스트
    const debugInfo = await page.evaluate(() => {
      const results = {
        title: {},
        content: {},
        allSelectors: []
      };

      // 제목 추출 테스트
      const titleSelectors = [
        'meta[property="og:title"]',
        '.title_text',
        '.article_title',
        '.ArticleTitle',
        'title'
      ];

      titleSelectors.forEach(selector => {
        try {
          // eslint-disable-next-line no-undef
          const element = document.querySelector(selector);
          if (element) {
            const value = element.getAttribute('content') || element.textContent?.trim() || '';
            results.title[selector] = value.substring(0, 100);
          } else {
            results.title[selector] = null;
          }
        } catch (e) {
          results.title[selector] = `ERROR: ${e.message}`;
        }
      });

      // 본문 추출 테스트
      const contentSelectors = [
        '#articleBodyContents',
        '.article_view .se-main-container',
        '.article_view .se-component',
        '.ArticleContent',
        '.se-main-container',
        '#content-area',
        '.article_view',
        '.se-viewer',
        '.se-section-text',
        '.se-component-text',
        '.se-text',
        '[class*="se-"]',
        '[id*="article"]',
        '[class*="article"]'
      ];

      contentSelectors.forEach(selector => {
        try {
          // eslint-disable-next-line no-undef
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            results.content[selector] = {
              count: elements.length,
              firstElementText: elements[0].textContent?.trim().substring(0, 200) || '',
              firstElementHTML: elements[0].innerHTML?.substring(0, 200) || ''
            };
          } else {
            results.content[selector] = null;
          }
        } catch (e) {
          results.content[selector] = `ERROR: ${e.message}`;
        }
      });

      // 모든 클래스와 ID 찾기 (디버깅용)
      // eslint-disable-next-line no-undef
      const allElements = document.querySelectorAll('[class*="se-"], [id*="article"], [class*="article"]');
      allElements.forEach((el, idx) => {
        if (idx < 20) { // 최대 20개만
          results.allSelectors.push({
            tag: el.tagName,
            class: el.className,
            id: el.id,
            textLength: el.textContent?.length || 0,
            textPreview: el.textContent?.trim().substring(0, 100) || ''
          });
        }
      });

      return results;
    });

    console.log('=== 제목 추출 결과 ===');
    Object.entries(debugInfo.title).forEach(([selector, value]) => {
      console.log(`${selector}: ${value || '(없음)'}`);
    });

    console.log('\n=== 본문 추출 결과 ===');
    Object.entries(debugInfo.content).forEach(([selector, value]) => {
      if (value && typeof value === 'object' && value.count) {
        console.log(`\n${selector}:`);
        console.log(`  - 요소 개수: ${value.count}`);
        console.log(`  - 첫 번째 요소 텍스트: ${value.firstElementText.substring(0, 150)}...`);
      } else {
        console.log(`${selector}: (없음)`);
      }
    });

    console.log('\n=== 발견된 관련 요소들 (최대 20개) ===');
    debugInfo.allSelectors.forEach((info, idx) => {
      console.log(`\n[${idx + 1}]`);
      console.log(`  태그: ${info.tag}`);
      console.log(`  클래스: ${info.class || '(없음)'}`);
      console.log(`  ID: ${info.id || '(없음)'}`);
      console.log(`  텍스트 길이: ${info.textLength}자`);
      console.log(`  텍스트 미리보기: ${info.textPreview.substring(0, 100)}...`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('\n브라우저를 10초간 열어둡니다. 페이지를 확인하세요...');
    await page.waitForTimeout(10000);

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
    await prisma.$disconnect();
  }
}

debugContentExtraction();












