/**
 * 크롤러 테스트 스크립트
 * 간단한 크롤링 테스트를 수행합니다
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

async function testCrawler() {
  try {
    console.log('=== 크롤러 테스트 시작 ===\n');
    
    // 1. 게시판 상태 확인
    console.log('1. 게시판 상태 확인:');
    const boards = query('SELECT id, name, enabled, isActive, lastScanAt, lastArticleId FROM MonitoredBoard');
    boards.forEach(board => {
      const lastScan = board.lastScanAt ? new Date(board.lastScanAt) : null;
      const diff = lastScan ? Math.round((Date.now() - lastScan.getTime()) / 1000 / 60) : null;
      console.log(`   - ${board.name}`);
      console.log(`     활성: ${board.enabled && board.isActive ? '예' : '아니오'}`);
      console.log(`     마지막 스캔: ${lastScan ? lastScan.toLocaleString('ko-KR') + ` (${diff}분 전)` : '없음'}`);
      console.log(`     마지막 ArticleId: ${board.lastArticleId || '없음'}`);
    });
    
    // 2. 최근 RawLog 확인
    console.log('\n2. 최근 수집된 RawLog 확인:');
    const recentLogs = query(`
      SELECT id, content, articleId, boardId, createdAt, metadata 
      FROM RawLog 
      WHERE boardId IS NOT NULL 
      ORDER BY createdAt DESC 
      LIMIT 5
    `);
    
    if (recentLogs.length === 0) {
      console.log('   최근 수집된 로그가 없습니다.');
    } else {
      recentLogs.forEach(log => {
        const board = boards.find(b => b.id === log.boardId);
        const createdAt = new Date(log.createdAt);
        let title = '제목 없음';
        try {
          if (log.metadata) {
            const meta = JSON.parse(log.metadata);
            title = meta.title || meta.summary || title;
          }
        } catch (e) {}
        if (!title || title === '제목 없음') {
          title = log.content ? log.content.substring(0, 50) : '제목 없음';
        }
        console.log(`   - [${board?.name || '알 수 없음'}] ${title.substring(0, 50)}`);
        console.log(`     수집 시간: ${createdAt.toLocaleString('ko-KR')}`);
        console.log(`     ArticleId: ${log.articleId || '없음'}`);
      });
    }
    
    // 3. 최근 이슈 확인
    console.log('\n3. 최근 생성된 이슈 확인:');
    const recentIssues = query(`
      SELECT id, summary, monitoredBoardId, createdAt 
      FROM ReportItemIssue 
      WHERE monitoredBoardId IS NOT NULL 
      ORDER BY createdAt DESC 
      LIMIT 5
    `);
    
    if (recentIssues.length === 0) {
      console.log('   최근 생성된 이슈가 없습니다.');
    } else {
      recentIssues.forEach(issue => {
        const board = boards.find(b => b.id === issue.monitoredBoardId);
        const createdAt = new Date(issue.createdAt);
        const diff = Math.round((Date.now() - createdAt.getTime()) / 1000 / 60);
        console.log(`   - [${board?.name || '알 수 없음'}] ${issue.summary?.substring(0, 50) || '제목 없음'}`);
        console.log(`     생성 시간: ${createdAt.toLocaleString('ko-KR')} (${diff}분 전)`);
      });
    }
    
    // 4. 크롤러 설정 확인
    console.log('\n4. 크롤러 설정 확인:');
    const intervalConfig = queryOne('SELECT * FROM MonitoringConfig WHERE key = ?', ['crawler.interval']);
    console.log(`   스캔 간격: ${intervalConfig?.value ? intervalConfig.value + '초' : '기본값 사용'}`);
    
    const cookieConfig = queryOne('SELECT * FROM MonitoringConfig WHERE key = ?', ['naverCafeCookie']);
    console.log(`   쿠키 설정: ${cookieConfig?.value ? '설정됨' : '없음'}`);
    
    // 5. 수동 스캔 트리거 테스트
    console.log('\n5. 수동 스캔 트리거 테스트:');
    const timestamp = Date.now().toString();
    execute('INSERT OR REPLACE INTO MonitoringConfig (key, value, updatedAt) VALUES (?, ?, ?)', 
      ['manual_scan_trigger', timestamp, new Date().toISOString()]);
    console.log(`   수동 스캔 트리거 설정 완료 (타임스탬프: ${timestamp})`);
    console.log('   워커가 30초 이내에 트리거를 감지하고 스캔을 시작할 것입니다.');
    
    console.log('\n=== 테스트 완료 ===');
    console.log('\n다음 명령으로 로그를 확인하세요:');
    console.log('tail -f logs/application-$(date +%Y-%m-%d).log | grep -E "Manual scan|Starting scan|Board scan"');
    
  } catch (error) {
    console.error('테스트 실패:', error);
    logger.error('[TestCrawler] Test failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

testCrawler();
