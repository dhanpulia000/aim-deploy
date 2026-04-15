/**
 * ArticleList.nhn(제보 게시판 등) 목록 파싱 반영 테스트
 * - 구형 URL 로드 후 tbody tr vs #upperArticleList tr 개수 비교
 * 실행: cd backend && node scripts/test-articlelist-parsing.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const REPORT_BOARD_LIST_URL = 'https://cafe.naver.com/ArticleList.nhn?search.clubid=28866679&search.menuid=107&search.boardtype=L';

async function run() {
  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const url = new URL(REPORT_BOARD_LIST_URL);
    url.searchParams.set('search.viewType', 'title');
    url.searchParams.set('search.listType', '50');
    const targetUrl = url.toString();

    console.log('제보 게시판(ArticleList.nhn) 로드 중...', targetUrl.substring(0, 70) + '...');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

    await page.waitForTimeout(3000);

    const stats = await page.evaluate(() => {
      const tbodyTr = document.querySelectorAll('tbody tr').length;
      const upperTr = document.querySelectorAll('#upperArticleList tr').length;
      let rows = [];
      if (tbodyTr > 0) {
        rows = Array.from(document.querySelectorAll('tbody tr'));
      } else if (upperTr > 0) {
        rows = Array.from(document.querySelectorAll('#upperArticleList tr'));
      }
      let withLink = 0;
      const dateTexts = [];
      rows.forEach((row) => {
        const link = row.querySelector('a.article, a[href*="/ArticleRead.nhn"], a[href*="ArticleRead.nhn"], a[href*="ArticleRead"]');
        if (link) withLink++;
        // 워커와 동일: td.td_normal.type_date 한 셀 (오늘=시간만 "00:27", 이전=날짜만 "2026.02.25.")
        let dateText = '';
        const dateCell = row.querySelector('td.td_normal.type_date, td.type_date, td[class*="type_date"]');
        if (dateCell) dateText = (dateCell.textContent || '').trim();
        if (!dateText) {
          dateText = row.querySelector('.date, .article-date, time')?.textContent?.trim() || row.querySelector('time')?.getAttribute('datetime') || '';
        }
        dateTexts.push(dateText || '(없음)');
      });
      return { tbodyTr, upperTr, totalRows: rows.length, withLink, dateTexts };
    });

    console.log('\n=== 파싱 결과 ===');
    console.log('  tbody tr 개수:', stats.tbodyTr);
    console.log('  #upperArticleList tr 개수:', stats.upperTr);
    console.log('  실제 사용 행 수:', stats.totalRows);
    console.log('  게시글 링크 있는 행 수:', stats.withLink);
    console.log('\n=== td.td_normal.type_date 셀 읽기 (상위 15행) ===');
    stats.dateTexts.slice(0, 15).forEach((txt, i) => {
      console.log('  행 ' + (i + 1) + ':', txt === '(없음)' ? txt : JSON.stringify(txt));
    });
    const readCount = stats.dateTexts.filter(t => t !== '(없음)').length;
    console.log('\n  날짜/시간 셀 읽힌 행:', readCount + '/' + stats.dateTexts.length);

    const ok = stats.totalRows >= 10 && stats.withLink > 0;
    if (ok && readCount > 0) {
      console.log('\n✅ 목록·링크·날짜 셀 모두 정상 반영됩니다.');
    } else if (readCount === 0) {
      console.log('\n⚠️  날짜 셀(td.td_normal.type_date)이 읽히지 않습니다. 클래스/구조 확인 필요.');
    } else {
      console.log('\n⚠️  행/링크가 부족합니다.');
    }
  } catch (err) {
    console.error('실행 오류:', err.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

run();
