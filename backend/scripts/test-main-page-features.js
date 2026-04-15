/**
 * 메인 화면 기능 테스트 스크립트
 * 
 * 각 API 엔드포인트와 주요 기능들이 정상적으로 작동하는지 확인합니다.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query, queryOne } = require('../libs/db');
const logger = require('../utils/logger');

const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
const API_BASE = `${BASE_URL}/api`;

// 테스트 결과 수집
const results = {
  passed: [],
  failed: [],
  warnings: []
};

function logResult(testName, passed, message = '') {
  if (passed) {
    results.passed.push(testName);
    console.log(`✅ ${testName}${message ? `: ${message}` : ''}`);
  } else {
    results.failed.push(testName);
    console.log(`❌ ${testName}${message ? `: ${message}` : ''}`);
  }
}

function logWarning(testName, message) {
  results.warnings.push({ test: testName, message });
  console.log(`⚠️  ${testName}: ${message}`);
}

async function testDatabaseConnection() {
  try {
    const test = queryOne('SELECT 1 as test');
    logResult('데이터베이스 연결', test && test.test === 1);
    return test && test.test === 1;
  } catch (error) {
    logResult('데이터베이스 연결', false, error.message);
    return false;
  }
}

async function testIssuesData() {
  try {
    const issues = query('SELECT COUNT(*) as count FROM ReportItemIssue');
    const count = issues[0]?.count || 0;
    logResult('이슈 데이터 존재', count > 0, `${count}개 이슈`);
    
    // 최근 이슈 확인
    const recentIssues = query(`
      SELECT id, summary, status, severity, source, createdAt 
      FROM ReportItemIssue 
      ORDER BY createdAt DESC 
      LIMIT 5
    `);
    
    if (recentIssues.length > 0) {
      logResult('최근 이슈 조회', true, `${recentIssues.length}개`);
      recentIssues.forEach(issue => {
        console.log(`   - ${issue.summary?.substring(0, 50)} (${issue.status}, severity: ${issue.severity})`);
      });
    } else {
      logWarning('최근 이슈 조회', '최근 이슈가 없습니다');
    }
    
    return true;
  } catch (error) {
    logResult('이슈 데이터 확인', false, error.message);
    return false;
  }
}

async function testAgentsData() {
  try {
    const agents = query('SELECT COUNT(*) as count FROM Agent WHERE isActive = 1');
    const count = agents[0]?.count || 0;
    logResult('활성 에이전트 데이터', count > 0, `${count}명`);
    
    const activeAgents = query(`
      SELECT id, name, status, handling, todayResolved 
      FROM Agent 
      WHERE isActive = 1 
      LIMIT 5
    `);
    
    if (activeAgents.length > 0) {
      activeAgents.forEach(agent => {
        console.log(`   - ${agent.name} (${agent.status}, 처리중: ${agent.handling}, 오늘 해결: ${agent.todayResolved})`);
      });
    }
    
    return true;
  } catch (error) {
    logResult('에이전트 데이터 확인', false, error.message);
    return false;
  }
}

async function testProjectsData() {
  try {
    const projects = query('SELECT COUNT(*) as count FROM Project');
    const count = projects[0]?.count || 0;
    logResult('프로젝트 데이터', count > 0, `${count}개 프로젝트`);
    
    const projectList = query('SELECT id, name FROM Project LIMIT 5');
    if (projectList.length > 0) {
      projectList.forEach(project => {
        console.log(`   - ${project.name} (ID: ${project.id})`);
      });
    }
    
    return true;
  } catch (error) {
    logResult('프로젝트 데이터 확인', false, error.message);
    return false;
  }
}

async function testCategoriesData() {
  try {
    const groups = query('SELECT COUNT(*) as count FROM CategoryGroup WHERE isActive = 1');
    const categories = query('SELECT COUNT(*) as count FROM Category WHERE isActive = 1');
    
    const groupCount = groups[0]?.count || 0;
    const categoryCount = categories[0]?.count || 0;
    
    logResult('카테고리 데이터', groupCount > 0 && categoryCount > 0, 
      `${groupCount}개 그룹, ${categoryCount}개 카테고리`);
    
    return true;
  } catch (error) {
    logResult('카테고리 데이터 확인', false, error.message);
    return false;
  }
}

async function testFeedbackNotices() {
  try {
    const notices = query('SELECT COUNT(*) as count FROM CustomerFeedbackNotice');
    const count = notices[0]?.count || 0;
    logResult('공지사항 데이터', true, `${count}개 공지`);
    
    const recentNotices = query(`
      SELECT id, content, createdAt 
      FROM CustomerFeedbackNotice 
      ORDER BY createdAt DESC 
      LIMIT 3
    `);
    
    if (recentNotices.length > 0) {
      recentNotices.forEach(notice => {
        const preview = notice.content ? notice.content.substring(0, 50) : '(내용 없음)';
        console.log(`   - ${preview}`);
      });
    }
    
    return true;
  } catch (error) {
    logResult('공지사항 데이터 확인', false, error.message);
    return false;
  }
}

async function testIssueStatusDistribution() {
  try {
    const statuses = query(`
      SELECT status, COUNT(*) as count 
      FROM ReportItemIssue 
      GROUP BY status
    `);
    
    logResult('이슈 상태 분포', true);
    statuses.forEach(status => {
      console.log(`   - ${status.status}: ${status.count}개`);
    });
    
    return true;
  } catch (error) {
    logResult('이슈 상태 분포 확인', false, error.message);
    return false;
  }
}

async function testSeverityDistribution() {
  try {
    const severities = query(`
      SELECT severity, COUNT(*) as count 
      FROM ReportItemIssue 
      GROUP BY severity
      ORDER BY severity ASC
    `);
    
    logResult('심각도 분포', true);
    severities.forEach(sev => {
      const label = sev.severity === 1 ? '높음' : sev.severity === 2 ? '중간' : '낮음';
      console.log(`   - ${label} (${sev.severity}): ${sev.count}개`);
    });
    
    return true;
  } catch (error) {
    logResult('심각도 분포 확인', false, error.message);
    return false;
  }
}

async function testSourceDistribution() {
  try {
    const sources = query(`
      SELECT source, COUNT(*) as count 
      FROM ReportItemIssue 
      GROUP BY source
      ORDER BY count DESC
    `);
    
    logResult('소스 분포', true);
    sources.forEach(source => {
      console.log(`   - ${source.source}: ${source.count}개`);
    });
    
    return true;
  } catch (error) {
    logResult('소스 분포 확인', false, error.message);
    return false;
  }
}

async function testRequiresLoginIssues() {
  try {
    const loginRequired = query(`
      SELECT COUNT(*) as count 
      FROM ReportItemIssue 
      WHERE requiresLogin = 1
    `);
    const total = query('SELECT COUNT(*) as count FROM ReportItemIssue');
    
    const loginCount = loginRequired[0]?.count || 0;
    const totalCount = total[0]?.count || 0;
    
    logResult('로그인 필요 이슈', true, 
      `${loginCount}개 (전체 ${totalCount}개 중 ${((loginCount / totalCount) * 100).toFixed(1)}%)`);
    
    return true;
  } catch (error) {
    logResult('로그인 필요 이슈 확인', false, error.message);
    return false;
  }
}

async function testAIClassification() {
  try {
    const aiClassified = query(`
      SELECT COUNT(*) as count 
      FROM ReportItemIssue 
      WHERE aiClassificationMethod = 'AI'
    `);
    const ruleClassified = query(`
      SELECT COUNT(*) as count 
      FROM ReportItemIssue 
      WHERE aiClassificationMethod = 'RULE'
    `);
    
    const aiCount = aiClassified[0]?.count || 0;
    const ruleCount = ruleClassified[0]?.count || 0;
    const total = aiCount + ruleCount;
    
    if (total > 0) {
      const aiPercent = ((aiCount / total) * 100).toFixed(1);
      logResult('AI 분류 비율', true, 
        `AI: ${aiCount}개 (${aiPercent}%), RULE: ${ruleCount}개`);
    } else {
      logWarning('AI 분류 비율', '분류된 이슈가 없습니다');
    }
    
    return true;
  } catch (error) {
    logResult('AI 분류 확인', false, error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('='.repeat(60));
  console.log('메인 화면 기능 테스트 시작');
  console.log('='.repeat(60));
  console.log('');
  
  // 기본 연결 테스트
  await testDatabaseConnection();
  console.log('');
  
  // 데이터 존재 확인
  console.log('📊 데이터 존재 확인');
  console.log('-'.repeat(60));
  await testIssuesData();
  await testAgentsData();
  await testProjectsData();
  await testCategoriesData();
  await testFeedbackNotices();
  console.log('');
  
  // 통계 확인
  console.log('📈 통계 확인');
  console.log('-'.repeat(60));
  await testIssueStatusDistribution();
  await testSeverityDistribution();
  await testSourceDistribution();
  await testRequiresLoginIssues();
  await testAIClassification();
  console.log('');
  
  // 결과 요약
  console.log('='.repeat(60));
  console.log('테스트 결과 요약');
  console.log('='.repeat(60));
  console.log(`✅ 통과: ${results.passed.length}개`);
  console.log(`❌ 실패: ${results.failed.length}개`);
  console.log(`⚠️  경고: ${results.warnings.length}개`);
  console.log('');
  
  if (results.failed.length > 0) {
    console.log('실패한 테스트:');
    results.failed.forEach(test => {
      console.log(`  - ${test}`);
    });
    console.log('');
  }
  
  if (results.warnings.length > 0) {
    console.log('경고:');
    results.warnings.forEach(warning => {
      console.log(`  - ${warning.test}: ${warning.message}`);
    });
    console.log('');
  }
  
  const successRate = ((results.passed.length / (results.passed.length + results.failed.length)) * 100).toFixed(1);
  console.log(`성공률: ${successRate}%`);
  console.log('');
  
  if (results.failed.length === 0) {
    console.log('🎉 모든 테스트 통과!');
  } else {
    console.log('⚠️  일부 테스트 실패. 위의 실패 목록을 확인하세요.');
  }
  
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// 실행
runAllTests().catch(error => {
  console.error('테스트 실행 중 오류:', error);
  process.exit(1);
});

