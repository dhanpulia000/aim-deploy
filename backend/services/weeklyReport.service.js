const ExcelJS = require('exceljs');
const { query, queryOne } = require('../libs/db');
const logger = require('../utils/logger');
const { getWeekRange } = require('../utils/dates.util');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { buildWeeklyReportData } = require('./weeklyReportData');
const { writeWeeklyReportToExcel } = require('./weeklyReportExcelWriter');

// 상수 정의 (매직 넘버 제거)
const PROJECT_IDS = {
  PC: 1,
  MOBILE: 2
};

const SENTIMENT_TYPES = {
  POSITIVE: 'pos',
  NEGATIVE: 'neg',
  NEUTRAL: 'neu'
};

const SENTIMENT_LABELS = {
  [SENTIMENT_TYPES.POSITIVE]: '긍정',
  [SENTIMENT_TYPES.NEGATIVE]: '부정',
  [SENTIMENT_TYPES.NEUTRAL]: '중립'
};

const borderStyle = {
  style: 'thin',
  color: { argb: 'FF000000' }
};

const headerFill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE0E0E0' }
};

// 템플릿 파일 경로 (값 있는 참고용 / 기본)
const TEMPLATE_WEEKLY_PC_PATH = path.join(__dirname, '../../PUBG PC 모니터링 주간 보고서 - 1월 4주차.xlsx');
const TEMPLATE_WEEKLY_MOBILE_PATH = path.join(__dirname, '../../PUBG MOBILE 모니터링 주간 보고서 - 1월 4주차.xlsx');
// 빈 템플릿 (데이터 영역만 비운 버전, 있으면 우선 사용 → 템플릿 잔여 데이터 방지)
const TEMPLATE_WEEKLY_PC_BLANK = path.join(__dirname, '../../PUBG PC 모니터링 주간 보고서 - 빈.xlsx');
const TEMPLATE_WEEKLY_MOBILE_BLANK = path.join(__dirname, '../../PUBG MOBILE 모니터링 주간 보고서 - 빈.xlsx');

/**
 * 템플릿 기준 분류/플랫폼/주제 매핑 (주간보고서 결과물이 템플릿 항목과 일치하도록)
 * - Mobile: MOBILE_WEEKLY_REPORT_MAPPING 기준 9개 카테고리
 * - PC: 인게임/컨텐츠 대분류 + 주제 정규화
 */
const TEMPLATE_CATEGORY_MAP_MOBILE = {
  '유료': '유료 아이템',
  '유료 아이템': '유료 아이템',
  '컨텐츠': '게임 플레이 관련 문의',
  '콘텐츠': '게임 플레이 관련 문의',
  '게임 플레이 관련 문의': '게임 플레이 관련 문의',
  '게임플레이': '게임 플레이 관련 문의',
  '버그': '버그',
  '서버': '서버/접속',
  '접속': '서버/접속',
  '서버/접속': '서버/접속',
  '커뮤니티': '커뮤니티/이스포츠',
  '이스포츠': '커뮤니티/이스포츠',
  '커뮤니티/이스포츠': '커뮤니티/이스포츠',
  '불법프로그램': '불법프로그램',
  '치트': '불법프로그램',
  '비매너': '비매너 행위',
  '비매너 행위': '비매너 행위',
  '이용 제한': '이용 제한 조치',
  '이용제한': '이용 제한 조치',
  '이용 제한 조치': '이용 제한 조치',
  '타게임': '타게임'
};

const TEMPLATE_CATEGORY_GROUP_MOBILE = {
  '유료': '유료 아이템',
  '컨텐츠': '게임 플레이 관련 문의',
  '콘텐츠': '게임 플레이 관련 문의',
  '버그': '버그',
  '서버': '서버/접속',
  '접속': '서버/접속',
  '커뮤니티': '커뮤니티/이스포츠',
  '이스포츠': '커뮤니티/이스포츠',
  '불법프로그램': '불법프로그램',
  '비매너': '비매너 행위',
  '이용 제한': '이용 제한 조치',
  '이용제한': '이용 제한 조치',
  '타게임': '타게임'
};

function normalizeCategoryForTemplate(projectId, categoryGroup, category) {
  const cg = (categoryGroup || '').trim();
  const c = (category || '').trim();
  if (projectId === PROJECT_IDS.MOBILE) {
    const mappedGroup = TEMPLATE_CATEGORY_GROUP_MOBILE[cg] || TEMPLATE_CATEGORY_GROUP_MOBILE[c] || (cg || c || '기타 동향');
    const mappedCat = TEMPLATE_CATEGORY_MAP_MOBILE[c] || TEMPLATE_CATEGORY_MAP_MOBILE[cg] || (c || cg || '기타');
    return { categoryGroup: mappedGroup, category: mappedCat };
  }
  // PC: 대분류는 컨텐츠/콘텐츠 통일, 나머지 정규화만
  const group = (cg || c).replace(/콘텐츠/g, '컨텐츠').trim() || '-';
  const cat = (c || cg).replace(/콘텐츠/g, '컨텐츠').trim() || '-';
  return { categoryGroup: group, category: cat };
}
const normalizeCategoryForTemplateFn = normalizeCategoryForTemplate;

/**
 * PC 주간보고서 동향 리스트 섹션 정의 (분류·주제 기준)
 * - 분류/주제 항목이 바뀌면 아래 설정만 수정하면 됨 (코드 수정 불필요)
 * - 분류: 해당 섹션에 넣을 대분류 키워드 배열 (문자열 포함 여부로 매칭)
 * - 주제: (선택) 해당 섹션에 넣을 주제 키워드 배열; 있으면 "분류+주제" 전용 섹션으로 우선 매칭
 * - 주제제외: true이면 "분류=컨텐츠" 중 전용 섹션 주제를 제외한 나머지만 이 섹션에 포함
 */
const PC_TREND_SECTION_ORDER = [
  { key: 'ingame', title: '■ 인게임 동향', 분류: ['버그', '퍼포먼스', '서버', '접속'] },
  { key: 'content', title: '■ 컨텐츠 동향', 분류: ['컨텐츠'], 주제제외: true },
  { key: 'content_2fa', title: '■ 2차 인증 관련 동향', 분류: ['컨텐츠'], 주제: ['2차 인증'] },
  { key: 'content_392', title: '■ 패치노트 #39.2 - 블루존 생성기 동향', 분류: ['컨텐츠'], 주제: ['#39.2 - 블루존 생성기', '블루존 생성기'] },
  { key: 'content_map', title: '■ 맵 서비스 리포트 : 맵 로테이션 동향', 분류: ['컨텐츠'], 주제: ['맵 서비스 리포트', '맵 로테이션'] },
  { key: 'anticheat', title: '■ 안티치트 동향', 분류: ['불법프로그램', '불법', '치트', '안티치트'] },
  { key: 'community', title: '■ 커뮤니티 동향', 분류: ['커뮤니티', '이스포츠'] },
  { key: 'othergame', title: '■ 타게임 동향', 분류: ['타게임'] }
];

function assignPcTrendSection(categoryGroup, category) {
  const cg = String(categoryGroup || '').replace(/콘텐츠/g, '컨텐츠').trim();
  const cat = String(category || '').replace(/콘텐츠/g, '컨텐츠').trim();

  const match분류 = (list) => Array.isArray(list) && list.some(kw => kw && cg.includes(kw));
  const match주제 = (list) => Array.isArray(list) && list.some(kw => kw && (cat === kw || cat.includes(kw)));

  // 전용 주제 섹션(분류+주제 지정) 우선: 컨텐츠이면서 주제가 일치하는 경우
  const topicSections = PC_TREND_SECTION_ORDER.filter(s => s.주제 && !s.주제제외);
  for (const s of topicSections) {
    if (match분류(s.분류) && match주제(s.주제)) return s.key;
  }
  // 컨텐츠이지만 전용 섹션에 해당 없으면 일반 컨텐츠
  if (match분류(['컨텐츠'])) return 'content';
  // 분류만 있는 섹션 (인게임, 안티치트, 커뮤니티, 타게임)
  const 분류Only = PC_TREND_SECTION_ORDER.filter(s => !s.주제 && !s.주제제외);
  for (const s of 분류Only) {
    if (match분류(s.분류)) return s.key;
  }
  return 'content';
}

/**
 * 셀 스타일을 참조 공유 없이 속성별 깊은 복사 (RichText/XML 손상 방지)
 * cell.style = templateCell.style 대신 font/fill/alignment/border를 새 객체로 할당
 */
function copyCellStyleIndependently(destCell, srcCell) {
  if (!destCell || !srcCell) return;
  const s = srcCell.style || srcCell;
  try {
    if (s.font && typeof s.font === 'object') destCell.font = { ...s.font };
    if (s.fill && typeof s.fill === 'object') destCell.fill = { ...s.fill };
    if (s.alignment && typeof s.alignment === 'object') destCell.alignment = { ...s.alignment };
    if (s.border && typeof s.border === 'object') {
      destCell.border = {};
      ['top', 'left', 'bottom', 'right'].forEach((side) => {
        if (s.border[side] && typeof s.border[side] === 'object') destCell.border[side] = { ...s.border[side] };
      });
    }
    if (s.numFmt !== undefined) destCell.numFmt = s.numFmt;
  } catch (e) {
    try {
      destCell.style = JSON.parse(JSON.stringify(s || {}));
    } catch (_) { /* fallback 실패 시 무시 */ }
  }
}

class WeeklyReportService {
  /** weeklyReportData.buildWeeklyReportData 등에서 호출: 템플릿용 대분류/중분류 정규화 */
  normalizeCategoryForTemplate(projectId, categoryGroup, category) {
    return normalizeCategoryForTemplateFn(projectId, categoryGroup, category);
  }

  /**
   * 주간 보고서 생성
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   * @param {string} platform - 플랫폼 (pc/mobile)
   * @returns {Promise<Buffer>} 엑셀 파일 버퍼
   */
  async generateWeeklyReport(startDate, endDate, platform = 'pc') {
    try {
      // 입력값 검증
      if (!startDate || !endDate) {
        throw new Error('시작일과 종료일은 필수입니다.');
      }

      // platform을 projectId로 변환
      const projectId = this.getProjectIdFromPlatform(platform);
      
      // 이전 주차 계산
      const { prevWeekStart, prevWeekEnd } = this.calculatePreviousWeek(startDate, endDate);

      // 주차 정보 계산
      const weekInfo = this.getWeekInfo(startDate);
      
      // 데이터 수집 (projectId 필터 적용)
      const currentWeekData = await this.collectWeekData(startDate, endDate, projectId);
      if (!currentWeekData) {
        throw new Error('현재 주차 데이터 수집에 실패했습니다.');
      }
      currentWeekData.weekInfo = weekInfo;
      
      const prevWeekData = await this.collectWeekData(prevWeekStart, prevWeekEnd, projectId);
      if (!prevWeekData) {
        throw new Error('이전 주차 데이터 수집에 실패했습니다.');
      }
      prevWeekData.weekInfo = this.getWeekInfo(prevWeekStart);
      
      // 워크북 생성
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'AIMGLOBAL';
      workbook.created = new Date();
      workbook.modified = new Date();

      // 5개 시트 생성
      await this.createFirstSheet(workbook, currentWeekData, prevWeekData, startDate, endDate, weekInfo, platform);
      await this.createSecondSheet(workbook, currentWeekData, prevWeekData, startDate, endDate);
      await this.createThirdSheet(workbook, startDate, endDate, projectId);
      await this.createFourthSheet(workbook, startDate, endDate, projectId);
      await this.createFifthSheet(workbook, startDate, endDate, projectId);

      const buffer = await workbook.xlsx.writeBuffer();
      logger.info('Weekly report generated', { startDate, endDate, platform, bufferSize: buffer.length });
      return buffer;
    } catch (error) {
      logger.error('Failed to generate weekly report', {
        error: error.message,
        stack: error.stack,
        startDate,
        endDate,
        platform
      });
      throw error;
    }
  }

  /**
   * 플랫폼 문자열을 projectId로 변환
   * @param {string} platform - 플랫폼 ('pc' 또는 'mobile')
   * @returns {number} 프로젝트 ID
   */
  getProjectIdFromPlatform(platform) {
    return platform === 'mobile' ? PROJECT_IDS.MOBILE : PROJECT_IDS.PC;
  }

  /**
   * 이전 주차 날짜 계산
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   * @returns {Object} 이전 주차 시작일과 종료일
   */
  calculatePreviousWeek(startDate, endDate) {
    try {
      const prevWeekStart = new Date(startDate);
      prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevWeekEnd = new Date(endDate);
      prevWeekEnd.setDate(prevWeekEnd.getDate() - 7);
      
      return {
        prevWeekStart: prevWeekStart.toISOString().split('T')[0],
        prevWeekEnd: prevWeekEnd.toISOString().split('T')[0]
      };
    } catch (error) {
      logger.error('Failed to calculate previous week', { startDate, endDate, error: error.message });
      throw new Error('이전 주차 날짜 계산에 실패했습니다.');
    }
  }

  /**
   * 주차 정보 계산 (예: "12월 4째주")
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @returns {Object} 주차 정보
   */
  getWeekInfo(startDate) {
    try {
      const date = new Date(startDate + 'T00:00:00.000Z');
      if (isNaN(date.getTime())) {
        throw new Error(`Invalid date format: ${startDate}`);
      }
      
      const month = date.getMonth() + 1;
      const day = date.getDate();
      
      // 해당 월의 첫 번째 날짜
      const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
      const firstDayOfWeek = firstDay.getDay(); // 0 (일요일) ~ 6 (토요일)
      
      // 첫 번째 주의 시작일 계산 (일요일 기준)
      const firstSunday = firstDayOfWeek === 0 ? 1 : 8 - firstDayOfWeek;
      
      // 현재 날짜가 몇 주차인지 계산
      let weekNumber;
      if (day < firstSunday) {
        weekNumber = 1;
      } else {
        weekNumber = Math.floor((day - firstSunday) / 7) + 1;
      }
      
      return {
        month,
        week: weekNumber,
        label: `${month}월${weekNumber}째주`
      };
    } catch (error) {
      logger.error('Failed to calculate week info', { startDate, error: error.message });
      return {
        month: 0,
        week: 0,
        label: '날짜 오류'
      };
    }
  }

  /**
   * 주간 데이터 수집
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   * @param {number} projectId - 프로젝트 ID (1: PUBG PC, 2: PUBG MOBILE)
   * @returns {Promise<Object>} 수집된 데이터
   */
  async collectWeekData(startDate, endDate, projectId) {
    try {
      // 입력값 검증
      if (!startDate || !endDate || !projectId) {
        logger.error('Invalid parameters for collectWeekData', { startDate, endDate, projectId });
        return null;
      }

      const startDateTime = new Date(`${startDate}T00:00:00.000Z`);
      const endDateTime = new Date(`${endDate}T23:59:59.999Z`);
      
      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        logger.error('Invalid date format', { startDate, endDate });
        return null;
      }

      // 이슈 데이터 조회 (projectId 필터 적용)
      const issues = this.queryIssuesWithCategories(startDate, endDate, projectId);
      
      // RawLog 데이터 조회 (게시글 등록량, projectId 필터 적용 - MonitoredBoard를 통해)
      const rawLogs = this.queryRawLogsByProject(startDateTime, endDateTime, projectId);
      
      return {
        issues: issues || [],
        rawLogs: rawLogs || [],
        totalIssues: (issues || []).length,
        totalPosts: (rawLogs || []).length
      };
    } catch (error) {
      logger.error('Failed to collect week data', {
        startDate,
        endDate,
        projectId,
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * 이슈 데이터 조회 (카테고리 정보 포함)
   * @param {string} startDate - 시작 날짜
   * @param {string} endDate - 종료 날짜
   * @param {number} projectId - 프로젝트 ID
   * @returns {Array} 이슈 배열
   */
  queryIssuesWithCategories(startDate, endDate, projectId) {
    try {
      const issues = query(
        `SELECT i.*, cg.id as categoryGroup_id, cg.name as categoryGroup_name, cg.code as categoryGroup_code,
                c.id as category_id, c.name as category_name
         FROM ReportItemIssue i
         LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
         LEFT JOIN Category c ON i.categoryId = c.id
         WHERE (i.excludedFromReport = 0 OR i.excludedFromReport IS NULL)
         AND i.projectId = ?
         AND i.date >= ? AND i.date <= ?
         ORDER BY i.date ASC`,
        [projectId, startDate, endDate]
      );

      if (!Array.isArray(issues)) {
        logger.warn('queryIssuesWithCategories returned non-array', { issues });
        return [];
      }

      return issues.map(issue => ({
        ...issue,
        categoryGroup: issue.categoryGroup_id ? {
          id: issue.categoryGroup_id,
          name: issue.categoryGroup_name,
          code: issue.categoryGroup_code
        } : null,
        category: issue.category_id ? {
          id: issue.category_id,
          name: issue.category_name
        } : null
      }));
    } catch (error) {
      logger.error('Failed to query issues with categories', {
        startDate,
        endDate,
        projectId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * RawLog 데이터 조회 (프로젝트별)
   * @param {Date} startDateTime - 시작 날짜/시간
   * @param {Date} endDateTime - 종료 날짜/시간
   * @param {number} projectId - 프로젝트 ID
   * @returns {Array} RawLog 배열
   */
  queryRawLogsByProject(startDateTime, endDateTime, projectId) {
    try {
      const rawLogs = query(
        `SELECT rl.timestamp 
         FROM RawLog rl
         LEFT JOIN MonitoredBoard mb ON rl.boardId = mb.id
         WHERE mb.projectId = ?
         AND rl.timestamp >= ? AND rl.timestamp <= ?
         ORDER BY rl.timestamp ASC`,
        [projectId, startDateTime.toISOString(), endDateTime.toISOString()]
      );

      return Array.isArray(rawLogs) ? rawLogs : [];
    } catch (error) {
      logger.error('Failed to query raw logs by project', {
        startDateTime,
        endDateTime,
        projectId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * 첫 번째 시트 생성 (00월0주차)
   */
  async createFirstSheet(workbook, currentData, prevData, startDate, endDate, weekInfo, platform) {
    const sheet = workbook.addWorksheet(weekInfo.label, {
      properties: { defaultRowHeight: 20 }
    });

    let currentRow = 1;

    // 1. 주간 동향 수 (성향별/이슈별 그래프)
    currentRow = this.createTrendCharts(sheet, currentData, prevData, currentRow);
    currentRow += 2;

    // 2. 주간 부정 동향 요약
    currentRow = this.createNegativeTrendSummary(sheet, currentData.issues, currentRow);
    currentRow += 2;

    // 3. 주간 긍정 동향 요약
    currentRow = this.createPositiveTrendSummary(sheet, currentData.issues, currentRow);
    currentRow += 2;

    // 4. 커뮤니티 주요 동향
    currentRow = this.createCommunityTrends(sheet, currentData.issues, currentRow);
    currentRow += 2;

    // 5. 모니터링 업무 현황
    currentRow = this.createMonitoringStatus(sheet, currentData, prevData, startDate, endDate, currentRow);
    currentRow += 2;

    // 6. 협의 및 논의 사항 / 요청 사항 / 비고
    currentRow = this.createDiscussionSection(sheet, currentRow);
    
    // 열 너비 설정
    this.setColumnWidths(sheet, [20, 15, 15, 50, 15]);
  }

  /**
   * 열 너비 설정 헬퍼 함수
   * @param {Object} sheet - ExcelJS 시트
   * @param {Array<number>} widths - 열 너비 배열
   */
  setColumnWidths(sheet, widths) {
    widths.forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });
  }

  /**
   * 주간 동향 수 차트 생성
   */
  createTrendCharts(sheet, currentData, prevData, startRow) {
    // 성향별 통계
    const currentSentiment = this.getSentimentStats(currentData?.issues || []);
    const prevSentiment = this.getSentimentStats(prevData?.issues || []);
    
    // 이슈별 통계 (대분류 기준)
    const currentIssues = this.getIssueStatsByCategory(currentData?.issues || []);
    const prevIssues = this.getIssueStatsByCategory(prevData?.issues || []);
    
    // 성향별 데이터 테이블
    sheet.getCell(startRow, 1).value = '성향별 주간 동향 수';
    sheet.getCell(startRow, 1).font = { bold: true, size: 14 };
    startRow++;
    
    const sentimentHeader = sheet.getRow(startRow);
    sentimentHeader.getCell(1).value = '성향';
    sentimentHeader.getCell(2).value = '전주 건수';
    sentimentHeader.getCell(3).value = '금주 건수';
    this.styleHeaderRow(sentimentHeader, 3);
    startRow++;

    Object.values(SENTIMENT_LABELS).forEach(sentimentLabel => {
      const row = sheet.getRow(startRow);
      row.getCell(1).value = sentimentLabel;
      row.getCell(2).value = prevSentiment[sentimentLabel] || 0;
      row.getCell(3).value = currentSentiment[sentimentLabel] || 0;
      this.styleDataRow(row, 3);
      startRow++;
    });
    
    startRow += 2;
    
    // 이슈별 데이터 테이블
    sheet.getCell(startRow, 1).value = '이슈별 주간 동향 수';
    sheet.getCell(startRow, 1).font = { bold: true, size: 14 };
    startRow++;

    const issueHeader = sheet.getRow(startRow);
    issueHeader.getCell(1).value = '대분류';
    issueHeader.getCell(2).value = '전주 건수';
    issueHeader.getCell(3).value = '금주 건수';
    this.styleHeaderRow(issueHeader, 3);
    startRow++;

    // 모든 대분류 수집
    const allCategories = new Set();
    Object.keys(currentIssues).forEach(cat => allCategories.add(cat));
    Object.keys(prevIssues).forEach(cat => allCategories.add(cat));
    
    Array.from(allCategories).sort().forEach(category => {
      const row = sheet.getRow(startRow);
      row.getCell(1).value = category || '기타';
      row.getCell(2).value = prevIssues[category] || 0;
      row.getCell(3).value = currentIssues[category] || 0;
      this.styleDataRow(row, 3);
      startRow++;
    });
    
    return startRow;
  }

  /**
   * 헤더 행 스타일 적용
   * @param {Object} row - ExcelJS 행
   * @param {number} columnCount - 컬럼 개수
   */
  styleHeaderRow(row, columnCount) {
    for (let col = 1; col <= columnCount; col++) {
      const cell = row.getCell(col);
      cell.font = { bold: true };
      cell.fill = headerFill;
      cell.border = borderStyle;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  }

  /**
   * 데이터 행 스타일 적용
   * @param {Object} row - ExcelJS 행
   * @param {number} columnCount - 컬럼 개수
   */
  styleDataRow(row, columnCount) {
    for (let col = 1; col <= columnCount; col++) {
      const cell = row.getCell(col);
      cell.border = borderStyle;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  }

  /**
   * 성향별 통계 계산
   * @param {Array} issues - 이슈 배열
   * @returns {Object} 성향별 통계
   */
  getSentimentStats(issues) {
    if (!Array.isArray(issues)) {
      return { '긍정': 0, '부정': 0, '중립': 0 };
    }

    const stats = { '긍정': 0, '부정': 0, '중립': 0 };
    issues.forEach(issue => {
      const sentiment = this.normalizeSentiment(issue.sentiment);
      if (sentiment === SENTIMENT_TYPES.POSITIVE) {
        stats['긍정']++;
      } else if (sentiment === SENTIMENT_TYPES.NEGATIVE) {
        stats['부정']++;
      } else {
        stats['중립']++;
      }
    });
    return stats;
  }

  /**
   * 성향 값 정규화
   * @param {string} sentiment - 성향 값
   * @returns {string} 정규화된 성향 값
   */
  normalizeSentiment(sentiment) {
    if (!sentiment) return SENTIMENT_TYPES.NEUTRAL;
    
    const normalized = sentiment.toLowerCase().trim();
    if (normalized === SENTIMENT_TYPES.POSITIVE || normalized.includes('긍정')) {
      return SENTIMENT_TYPES.POSITIVE;
    }
    if (normalized === SENTIMENT_TYPES.NEGATIVE || normalized.includes('부정')) {
      return SENTIMENT_TYPES.NEGATIVE;
    }
    return SENTIMENT_TYPES.NEUTRAL;
  }

  /**
   * 대분류별 이슈 통계 계산
   * @param {Array} issues - 이슈 배열
   * @returns {Object} 대분류별 통계
   */
  getIssueStatsByCategory(issues) {
    if (!Array.isArray(issues)) {
      return {};
    }

    const stats = {};
    issues.forEach(issue => {
      const category = issue.categoryGroup?.name || issue.category?.name || '기타';
      stats[category] = (stats[category] || 0) + 1;
    });
    return stats;
  }

  /**
   * 주간 부정 동향 요약 생성
   */
  createNegativeTrendSummary(sheet, issues, startRow) {
    sheet.getCell(startRow, 1).value = '주간 부정 동향 요약';
    sheet.getCell(startRow, 1).font = { bold: true, size: 14 };
    startRow++;
    
    // 부정 이슈 필터링
    const negativeIssues = this.filterIssuesBySentiment(issues, SENTIMENT_TYPES.NEGATIVE);
    
    return this.createTrendSummaryTable(sheet, negativeIssues, startRow);
  }

  /**
   * 주간 긍정 동향 요약 생성
   */
  createPositiveTrendSummary(sheet, issues, startRow) {
    sheet.getCell(startRow, 1).value = '주간 긍정 동향 요약';
    sheet.getCell(startRow, 1).font = { bold: true, size: 14 };
    startRow++;

    // 긍정 이슈 필터링
    const positiveIssues = this.filterIssuesBySentiment(issues, SENTIMENT_TYPES.POSITIVE);
    
    return this.createTrendSummaryTable(sheet, positiveIssues, startRow);
  }

  /**
   * 성향별 이슈 필터링
   * @param {Array} issues - 이슈 배열
   * @param {string} targetSentiment - 대상 성향
   * @returns {Array} 필터링된 이슈 배열
   */
  filterIssuesBySentiment(issues, targetSentiment) {
    if (!Array.isArray(issues)) {
      return [];
    }

    return issues.filter(issue => {
      const sentiment = this.normalizeSentiment(issue.sentiment);
      return sentiment === targetSentiment;
    });
  }

  /**
   * 동향 요약 테이블 생성
   * @param {Object} sheet - ExcelJS 시트
   * @param {Array} issues - 이슈 배열
   * @param {number} startRow - 시작 행
   * @returns {number} 다음 행 번호
   */
  createTrendSummaryTable(sheet, issues, startRow) {
    if (!Array.isArray(issues) || issues.length === 0) {
      return startRow;
    }

    // 요인별 그룹화
    const trendGroups = {};
    issues.forEach(issue => {
      const key = this.getTrendKey(issue);
      if (!trendGroups[key]) {
        trendGroups[key] = [];
      }
      trendGroups[key].push(issue);
    });
    
    // 건수 순으로 정렬
    const sortedTrends = Object.entries(trendGroups)
      .map(([key, items]) => ({ key, count: items.length, issues: items }))
      .sort((a, b) => b.count - a.count);
    
    sortedTrends.forEach(trend => {
      if (trend.issues.length === 0) return;
      
      const row = sheet.getRow(startRow);
      const description = this.getFinalDescription(trend.issues[0]);
      row.getCell(1).value = `${description} (${trend.count}건)`;
      row.getCell(1).border = borderStyle;
      row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      startRow++;
    });
    
    return startRow;
  }

  /**
   * 커뮤니티 주요 동향 생성
   */
  createCommunityTrends(sheet, issues, startRow) {
    sheet.getCell(startRow, 1).value = '커뮤니티 주요 동향';
    sheet.getCell(startRow, 1).font = { bold: true, size: 14 };
    startRow++;

    if (!Array.isArray(issues)) {
      return startRow;
    }

    // 부정/긍정/기타로 분류
    const negativeIssues = this.filterIssuesBySentiment(issues, SENTIMENT_TYPES.NEGATIVE);
    const positiveIssues = this.filterIssuesBySentiment(issues, SENTIMENT_TYPES.POSITIVE);
    const otherIssues = issues.filter(issue => {
      const sentiment = this.normalizeSentiment(issue.sentiment);
      return sentiment !== SENTIMENT_TYPES.POSITIVE && sentiment !== SENTIMENT_TYPES.NEGATIVE;
    });
    
    // 부정 동향
    if (negativeIssues.length > 0) {
      sheet.getCell(startRow, 1).value = `부정 동향 (${negativeIssues.length}건)`;
      sheet.getCell(startRow, 1).font = { bold: true };
      startRow++;
      startRow = this.createTrendTable(sheet, negativeIssues, startRow);
      startRow++;
    }
    
    // 긍정 동향
    if (positiveIssues.length > 0) {
      sheet.getCell(startRow, 1).value = `긍정 동향 (${positiveIssues.length}건)`;
      sheet.getCell(startRow, 1).font = { bold: true };
      startRow++;
      startRow = this.createTrendTable(sheet, positiveIssues, startRow);
      startRow++;
    }
    
    // 기타 동향
    if (otherIssues.length > 0) {
      sheet.getCell(startRow, 1).value = `기타 동향 (${otherIssues.length}건)`;
      sheet.getCell(startRow, 1).font = { bold: true };
      startRow++;
      startRow = this.createTrendTable(sheet, otherIssues, startRow);
      startRow++;
    }
    
    return startRow;
  }

  /**
   * 동향 테이블 생성 (대분류/중분류/내용)
   */
  createTrendTable(sheet, issues, startRow) {
    if (!Array.isArray(issues) || issues.length === 0) {
      return startRow;
    }

    // 헤더
    const header = sheet.getRow(startRow);
    header.getCell(1).value = '대분류';
    header.getCell(2).value = '중분류';
    header.getCell(3).value = '내용';
    this.styleHeaderRow(header, 3);
    startRow++;

    // 대분류/중분류별 그룹화
    const grouped = {};
    issues.forEach(issue => {
      const categoryGroup = issue.categoryGroup?.name || '기타';
      const category = issue.category?.name || '기타';
      const key = `${categoryGroup}|${category}`;
      if (!grouped[key]) {
        grouped[key] = {
          categoryGroup,
          category,
          issues: []
        };
      }
      grouped[key].issues.push(issue);
    });
    
    // 데이터 행
    Object.values(grouped).forEach(group => {
      const row = sheet.getRow(startRow);
      row.getCell(1).value = group.categoryGroup;
      row.getCell(2).value = group.category;
      
      // 내용: 같은 대분류/중분류의 이슈들을 요약
      const contents = group.issues
        .map(issue => {
          const desc = this.getFinalDescription(issue);
          return `> ${desc}`;
        })
        .filter(Boolean); // 빈 문자열 제거
      
      row.getCell(3).value = contents.length > 0 ? contents.join('\n') : '내용 없음';
      row.getCell(3).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
      
      this.styleDataRow(row, 3);
      startRow++;
    });

    return startRow;
  }

  /**
   * 모니터링 업무 현황 생성
   */
  createMonitoringStatus(sheet, currentData, prevData, startDate, endDate, startRow) {
    sheet.getCell(startRow, 1).value = '모니터링 업무 현황';
    sheet.getCell(startRow, 1).font = { bold: true, size: 14 };
    startRow++;
    
    // 일별 데이터 집계
    const dailyStats = this.getDailyStats(currentData, startDate, endDate);
    
    // 헤더
    const header = sheet.getRow(startRow);
    header.getCell(1).value = '날짜';
    header.getCell(2).value = '게시글 등록량';
    header.getCell(3).value = '이슈 취합건수';
    this.styleHeaderRow(header, 3);
    startRow++;
    
    // 일별 데이터
    Object.keys(dailyStats).sort().forEach(date => {
      const stats = dailyStats[date];
      const row = sheet.getRow(startRow);
      row.getCell(1).value = date;
      row.getCell(2).value = stats.posts || 0;
      row.getCell(3).value = stats.issues || 0;
      this.styleDataRow(row, 3);
      startRow++;
    });
    
    // 주차별 합계
    const row = sheet.getRow(startRow);
    row.getCell(1).value = '합계';
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = currentData?.totalPosts || 0;
    row.getCell(2).font = { bold: true };
    row.getCell(3).value = currentData?.totalIssues || 0;
    row.getCell(3).font = { bold: true };
    this.styleDataRow(row, 3);
    
    return startRow + 1;
  }

  /**
   * 일별 통계 계산
   * @param {Object} data - 데이터 객체
   * @param {string} startDate - 시작 날짜
   * @param {string} endDate - 종료 날짜
   * @returns {Object} 일별 통계
   */
  getDailyStats(data, startDate, endDate) {
    const stats = {};
    
    try {
      // 날짜 범위 생성
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        logger.error('Invalid date range for getDailyStats', { startDate, endDate });
        return stats;
      }

      const current = new Date(start);
      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        stats[dateStr] = { posts: 0, issues: 0 };
        current.setDate(current.getDate() + 1);
      }
      
      // 게시글 등록량 집계
      if (Array.isArray(data?.rawLogs)) {
        data.rawLogs.forEach(log => {
          if (!log || !log.timestamp) return;
          
          try {
            const date = new Date(log.timestamp);
            if (!isNaN(date.getTime())) {
              const dateStr = date.toISOString().split('T')[0];
              if (stats[dateStr]) {
                stats[dateStr].posts++;
              }
            }
          } catch (error) {
            logger.warn('Failed to parse timestamp in rawLog', { log, error: error.message });
          }
        });
      }
      
      // 이슈 취합건수 집계
      if (Array.isArray(data?.issues)) {
        data.issues.forEach(issue => {
          try {
            let dateStr;
            if (issue.date) {
              dateStr = issue.date;
            } else if (issue.createdAt) {
              // createdAt이 문자열이거나 Date 객체일 수 있음
              const date = typeof issue.createdAt === 'string' 
                ? new Date(issue.createdAt) 
                : issue.createdAt;
              if (!isNaN(date.getTime())) {
                dateStr = date.toISOString().split('T')[0];
              }
            }
            
            if (dateStr && stats[dateStr]) {
              stats[dateStr].issues++;
            }
          } catch (error) {
            logger.warn('Failed to parse issue date', { issue, error: error.message });
          }
        });
      }
    } catch (error) {
      logger.error('Failed to calculate daily stats', {
        startDate,
        endDate,
        error: error.message
      });
    }
    
    return stats;
  }

  /**
   * 협의 및 논의 사항 / 요청 사항 / 비고 생성
   */
  createDiscussionSection(sheet, startRow) {
    const sections = ['협의 및 논의 사항', '요청 사항', '비고'];
    
    sections.forEach(sectionName => {
      sheet.getCell(startRow, 1).value = sectionName;
      sheet.getCell(startRow, 2).value = '-';
      sheet.getCell(startRow, 1).font = { bold: true };
      sheet.getCell(startRow, 1).border = borderStyle;
      sheet.getCell(startRow, 2).border = borderStyle;
      startRow++;
    });
    
    return startRow;
  }

  /**
   * 두 번째 시트 생성 (주요 이슈 건수 증감)
   */
  async createSecondSheet(workbook, currentData, prevData, startDate, endDate) {
    const sheet = workbook.addWorksheet('주요 이슈 건수 증감');
    
    let currentRow = 1;
    
    // 전주/금주 MO 총 취합량
    sheet.getCell(currentRow, 1).value = '전주 MO 총 취합량';
    sheet.getCell(currentRow, 2).value = prevData?.totalIssues || 0;
    sheet.getCell(currentRow, 1).font = { bold: true };
    currentRow++;
    
    sheet.getCell(currentRow, 1).value = '금주 MO 총 취합량';
    sheet.getCell(currentRow, 2).value = currentData?.totalIssues || 0;
    sheet.getCell(currentRow, 1).font = { bold: true };
    currentRow += 2;
    
    // 대분류별 통계
    const currentStats = this.getIssueStatsByCategory(currentData?.issues || []);
    const prevStats = this.getIssueStatsByCategory(prevData?.issues || []);
    
    // 헤더
    const header = sheet.getRow(currentRow);
    const headerLabels = [
      '순위', '주요 이슈 구분', '전주 건수', '금주 건수',
      '전주 비율 (MO 취합량 대비 %)', '금주 비율 (MO 취합량 대비 %)',
      '증감', '전주 대비 %'
    ];
    
    headerLabels.forEach((label, index) => {
      header.getCell(index + 1).value = label;
    });
    
    this.styleHeaderRow(header, headerLabels.length);
    currentRow++;
    
    // 대분류별로 정렬 (금주 건수 기준 내림차순)
    const allCategories = new Set();
    Object.keys(currentStats).forEach(cat => allCategories.add(cat));
    Object.keys(prevStats).forEach(cat => allCategories.add(cat));
    
    const sortedCategories = Array.from(allCategories)
      .map(cat => ({
        name: cat || '기타',
        current: currentStats[cat] || 0,
        prev: prevStats[cat] || 0
      }))
      .sort((a, b) => b.current - a.current);
    
    sortedCategories.forEach((cat, index) => {
      const row = sheet.getRow(currentRow);
      const rank = index + 1;
      const prevTotal = prevData?.totalIssues || 0;
      const currentTotal = currentData?.totalIssues || 0;
      
      const prevRatio = prevTotal > 0 ? (cat.prev / prevTotal * 100).toFixed(1) : '0.0';
      const currentRatio = currentTotal > 0 ? (cat.current / currentTotal * 100).toFixed(1) : '0.0';
      const change = parseFloat(currentRatio) - parseFloat(prevRatio);
      const changePercent = cat.prev > 0 ? ((cat.current - cat.prev) / cat.prev * 100).toFixed(1) : '0.0';
      
      row.getCell(1).value = rank;
      row.getCell(2).value = cat.name;
      row.getCell(3).value = cat.prev;
      row.getCell(4).value = cat.current;
      row.getCell(5).value = parseFloat(prevRatio);
      row.getCell(6).value = parseFloat(currentRatio);
      row.getCell(7).value = change > 0 ? `↑${change.toFixed(1)}%` : change < 0 ? `↓${Math.abs(change).toFixed(1)}%` : '0.0%';
      row.getCell(8).value = parseFloat(changePercent);
      
      this.styleDataRow(row, headerLabels.length);
      currentRow++;
    });
    
    // 열 너비 설정
    this.setColumnWidths(sheet, [8, 25, 12, 12, 25, 25, 12, 12]);
  }

  /**
   * 세 번째 시트 생성 (공유 이슈 시간 순)
   */
  async createThirdSheet(workbook, startDate, endDate, projectId) {
    const sheet = workbook.addWorksheet('공유 이슈 시간 순');
    
    try {
      const startDateTime = new Date(`${startDate}T00:00:00.000Z`);
      const endDateTime = new Date(`${endDate}T23:59:59.999Z`);
      
      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        sheet.getCell(1, 1).value = '날짜 형식 오류';
        return;
      }
      
      // IssueShareLog 조회 (SUCCESS 상태만, projectId 필터 적용)
      // INNER JOIN 사용: issueId가 유효한 ReportItemIssue만 조회
      const shareLogs = this.queryShareLogs(startDateTime, endDateTime, projectId);
      
      if (!Array.isArray(shareLogs) || shareLogs.length === 0) {
        sheet.getCell(1, 1).value = '공유된 이슈가 없습니다.';
        return;
      }
      
      // 헤더
      const header = sheet.getRow(1);
      const headerLabels = ['공유 시간', '이슈 내용', '담당 Agent', '공유 대상', '상태'];
      headerLabels.forEach((label, index) => {
        header.getCell(index + 1).value = label;
      });
      this.styleHeaderRow(header, headerLabels.length);
      
      // 데이터 행
      shareLogs.forEach((log, index) => {
        const row = sheet.getRow(index + 2);
        const timeStr = this.formatDateTime(log.sentAt);
        
        row.getCell(1).value = timeStr;
        row.getCell(2).value = log.summary || log.detail || '';
        row.getCell(2).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        row.getCell(3).value = log.agent_name || '';
        row.getCell(4).value = this.formatShareTarget(log.target);
        row.getCell(5).value = '공유 완료';
        
        this.styleDataRow(row, headerLabels.length);
        // 내용 컬럼은 왼쪽 정렬 유지
        row.getCell(2).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
      });
      
      // 열 너비 설정
      this.setColumnWidths(sheet, [18, 60, 15, 15, 12]);
    } catch (error) {
      logger.error('Failed to create third sheet', {
        startDate,
        endDate,
        projectId,
        error: error.message,
        stack: error.stack
      });
      sheet.getCell(1, 1).value = '시트 생성 중 오류가 발생했습니다.';
    }
  }

  /**
   * 공유 로그 조회
   * @param {Date} startDateTime - 시작 날짜/시간
   * @param {Date} endDateTime - 종료 날짜/시간
   * @param {number} projectId - 프로젝트 ID
   * @returns {Array} 공유 로그 배열
   */
  queryShareLogs(startDateTime, endDateTime, projectId) {
    try {
      const shareLogs = query(
        `SELECT sl.*, i.summary, i.detail, i.date,
                a.name as agent_name
         FROM IssueShareLog sl
         INNER JOIN ReportItemIssue i ON sl.issueId = i.id
         LEFT JOIN Agent a ON sl.agentId = a.id
         WHERE sl.status = 'SUCCESS'
         AND (i.excludedFromReport = 0 OR i.excludedFromReport IS NULL)
         AND i.projectId = ?
         AND sl.sentAt >= ? AND sl.sentAt <= ?
         ORDER BY sl.sentAt ASC`,
        [projectId, startDateTime.toISOString(), endDateTime.toISOString()]
      );

      return Array.isArray(shareLogs) ? shareLogs : [];
    } catch (error) {
      logger.error('Failed to query share logs', {
        startDateTime,
        endDateTime,
        projectId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * 날짜/시간 포맷팅
   * @param {string|Date} dateTime - 날짜/시간
   * @returns {string} 포맷팅된 문자열
   */
  formatDateTime(dateTime) {
    try {
      const sentAt = dateTime instanceof Date ? dateTime : new Date(dateTime);
      if (isNaN(sentAt.getTime())) {
        return '날짜 오류';
      }
      
      return `${sentAt.getFullYear()}-${String(sentAt.getMonth() + 1).padStart(2, '0')}-${String(sentAt.getDate()).padStart(2, '0')} ${String(sentAt.getHours()).padStart(2, '0')}:${String(sentAt.getMinutes()).padStart(2, '0')}`;
    } catch (error) {
      logger.warn('Failed to format date time', { dateTime, error: error.message });
      return '날짜 오류';
    }
  }

  /**
   * 공유 대상 포맷팅
   * @param {string} target - 공유 대상
   * @returns {string} 포맷팅된 문자열
   */
  formatShareTarget(target) {
    if (!target) return '';
    if (target === 'Client_Channel') return '고객사';
    if (target === 'Internal_Channel') return '내부';
    return target;
  }

  /**
   * 네 번째 시트 생성 (VoC)
   * @param {Object} workbook - ExcelJS 워크북
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   * @param {number} projectId - 프로젝트 ID (1: PUBG PC, 2: PUBG MOBILE)
   */
  async createFourthSheet(workbook, startDate, endDate, projectId) {
    try {
      // 일일보고서의 VoC 로직을 주간 단위로 취합
      const excelReportService = require('./excelReport.service');
      
      // VoC 시트 생성 (projectId 필터 적용, projectId IS NULL 제외)
      await excelReportService.createVoCSheet(workbook, startDate, endDate, projectId, null);
    } catch (error) {
      logger.error('Failed to create fourth sheet (VoC)', {
        startDate,
        endDate,
        projectId,
        error: error.message,
        stack: error.stack
      });
      // 빈 시트라도 생성하여 오류 방지
      const vocSheet = workbook.addWorksheet('VoC');
      vocSheet.getCell(1, 1).value = 'VoC 시트 생성 중 오류가 발생했습니다.';
    }
  }

  /**
   * 다섯 번째 시트 생성 (Data)
   * @param {Object} workbook - ExcelJS 워크북
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   * @param {number} projectId - 프로젝트 ID (1: PUBG PC, 2: PUBG MOBILE)
   */
  async createFifthSheet(workbook, startDate, endDate, projectId) {
    const sheet = workbook.addWorksheet('Data');
    
    try {
      const startDateTime = new Date(`${startDate}T00:00:00.000Z`);
      const endDateTime = new Date(`${endDate}T23:59:59.999Z`);
      
      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        sheet.getCell(1, 1).value = '날짜 형식 오류';
        return;
      }
      
      // IssueShareLog에서 공유된 이슈 조회 (projectId 필터 적용)
      // INNER JOIN 사용: issueId가 유효한 ReportItemIssue만 조회
      const shareLogs = this.queryShareLogsForDataSheet(startDateTime, endDateTime, projectId);
      
      if (!Array.isArray(shareLogs) || shareLogs.length === 0) {
        sheet.getCell(1, 1).value = '공유된 이슈가 없습니다.';
        return;
      }
      
      // 날짜별로 그룹화
      const dateGroups = this.groupShareLogsByDate(shareLogs);
      
      // 헤더
      const header = sheet.getRow(1);
      const headerLabels = [
        '주차', '날짜', '담당 Agent', '커뮤니티 이슈',
        '이용자 동향', '공유 내용', '요청 내용', '비고'
      ];
      headerLabels.forEach((label, index) => {
        header.getCell(index + 1).value = label;
      });
      this.styleHeaderRow(header, headerLabels.length);
      
      // 데이터 행
      let currentRow = 2;
      Object.keys(dateGroups).sort().forEach(date => {
        const logs = dateGroups[date];
        const weekLabel = this.getWeekLabel(date);
        
        logs.forEach(log => {
          const row = sheet.getRow(currentRow);
          const timeStr = this.formatTime(log.sentAt);
          
          row.getCell(1).value = weekLabel;
          row.getCell(2).value = date;
          row.getCell(3).value = log.agent_name || '';
          row.getCell(4).value = log.categoryGroup_name || log.category_name || '';
          row.getCell(5).value = this.getSentimentLabel(log.sentiment || 'neu');
          row.getCell(6).value = `${log.summary || log.detail || ''} - ${timeStr}`;
          row.getCell(6).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
          row.getCell(7).value = ''; // 요청 내용은 별도로 수집 필요
          row.getCell(8).value = ''; // 비고
          
          this.styleDataRow(row, headerLabels.length);
          // 공유 내용 컬럼은 왼쪽 정렬 유지
          row.getCell(6).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
          currentRow++;
        });
      });
      
      // 열 너비 설정
      this.setColumnWidths(sheet, [15, 12, 15, 20, 12, 50, 30, 20]);
    } catch (error) {
      logger.error('Failed to create fifth sheet (Data)', {
        startDate,
        endDate,
        projectId,
        error: error.message,
        stack: error.stack
      });
      sheet.getCell(1, 1).value = '시트 생성 중 오류가 발생했습니다.';
    }
  }

  /**
   * Data 시트용 공유 로그 조회
   * @param {Date} startDateTime - 시작 날짜/시간
   * @param {Date} endDateTime - 종료 날짜/시간
   * @param {number} projectId - 프로젝트 ID
   * @returns {Array} 공유 로그 배열
   */
  queryShareLogsForDataSheet(startDateTime, endDateTime, projectId) {
    try {
      const shareLogs = query(
        `SELECT sl.*, i.summary, i.detail, i.date, i.categoryGroupId, i.categoryId, i.sentiment,
                cg.name as categoryGroup_name, c.name as category_name,
                a.name as agent_name
         FROM IssueShareLog sl
         INNER JOIN ReportItemIssue i ON sl.issueId = i.id
         LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
         LEFT JOIN Category c ON i.categoryId = c.id
         LEFT JOIN Agent a ON sl.agentId = a.id
         WHERE sl.status = 'SUCCESS'
         AND (i.excludedFromReport = 0 OR i.excludedFromReport IS NULL)
         AND i.projectId = ?
         AND sl.sentAt >= ? AND sl.sentAt <= ?
         ORDER BY i.date ASC, sl.sentAt ASC`,
        [projectId, startDateTime.toISOString(), endDateTime.toISOString()]
      );

      return Array.isArray(shareLogs) ? shareLogs : [];
    } catch (error) {
      logger.error('Failed to query share logs for data sheet', {
        startDateTime,
        endDateTime,
        projectId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * 공유 로그를 날짜별로 그룹화
   * @param {Array} shareLogs - 공유 로그 배열
   * @returns {Object} 날짜별 그룹화된 객체
   */
  groupShareLogsByDate(shareLogs) {
    const dateGroups = {};
    
    shareLogs.forEach(log => {
      try {
        const date = log.date || (log.sentAt ? new Date(log.sentAt).toISOString().split('T')[0] : null);
        if (date) {
          if (!dateGroups[date]) {
            dateGroups[date] = [];
          }
          dateGroups[date].push(log);
        }
      } catch (error) {
        logger.warn('Failed to group share log by date', { log, error: error.message });
      }
    });
    
    return dateGroups;
  }

  /**
   * 시간 포맷팅 (HH:mm)
   * @param {string|Date} dateTime - 날짜/시간
   * @returns {string} 포맷팅된 시간 문자열
   */
  formatTime(dateTime) {
    try {
      const sentAt = dateTime instanceof Date ? dateTime : new Date(dateTime);
      if (isNaN(sentAt.getTime())) {
        return '00:00';
      }
      
      return `${String(sentAt.getHours()).padStart(2, '0')}:${String(sentAt.getMinutes()).padStart(2, '0')}`;
    } catch (error) {
      logger.warn('Failed to format time', { dateTime, error: error.message });
      return '00:00';
    }
  }

  /**
   * 주차 레이블 생성 (예: "11월 2주차")
   * @param {string} dateStr - 날짜 문자열 (YYYY-MM-DD)
   * @returns {string} 주차 레이블
   */
  getWeekLabel(dateStr) {
    try {
      const weekInfo = this.getWeekInfo(dateStr);
      return `${weekInfo.month}월 ${weekInfo.week}주차`;
    } catch (error) {
      logger.error('Failed to calculate week label', { dateStr, error: error.message });
      return '';
    }
  }

  /**
   * 성향 레이블 변환
   * @param {string} sentiment - 성향 값
   * @returns {string} 성향 레이블
   */
  getSentimentLabel(sentiment) {
    if (!sentiment) return SENTIMENT_LABELS[SENTIMENT_TYPES.NEUTRAL];
    
    const normalized = sentiment.toLowerCase().trim();
    if (normalized === SENTIMENT_TYPES.POSITIVE) {
      return SENTIMENT_LABELS[SENTIMENT_TYPES.POSITIVE];
    }
    if (normalized === SENTIMENT_TYPES.NEGATIVE) {
      return SENTIMENT_LABELS[SENTIMENT_TYPES.NEGATIVE];
    }
    return SENTIMENT_LABELS[SENTIMENT_TYPES.NEUTRAL];
  }

  /**
   * 트렌드 키 생성 (요인별 그룹화용)
   * @param {Object} issue - 이슈 객체
   * @returns {string} 트렌드 키
   */
  getTrendKey(issue) {
    // 대분류 + 중분류 + 요약의 첫 부분을 키로 사용
    const categoryGroup = issue.categoryGroup?.name || '';
    const category = issue.category?.name || '';
    const summary = this.getFinalDescription(issue);
    const key = `${categoryGroup}|${category}|${summary.substring(0, 50)}`;
    return key;
  }

  /**
   * 최종 설명 텍스트 추출
   * @param {Object} issue - 이슈 객체
   * @returns {string} 설명 텍스트
   */
  getFinalDescription(issue) {
    if (!issue) return '내용 없음';
    
    // 우선순위: aiClassificationReason > summary > detail
    if (issue.aiClassificationReason && typeof issue.aiClassificationReason === 'string' && issue.aiClassificationReason.trim()) {
      return issue.aiClassificationReason.trim();
    }
    if (issue.summary && typeof issue.summary === 'string' && issue.summary.trim()) {
      return issue.summary.trim();
    }
    if (issue.detail && typeof issue.detail === 'string' && issue.detail.trim()) {
      // 최대 200자로 제한
      const trimmed = issue.detail.trim();
      return trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed;
    }
    return '내용 없음';
  }

  /**
   * PC 전용: LLM 기반 "■ 전반적인 동향" 생성
   * - PUBG PC 모니터링 주간 보고서 템플릿만 참고 (Mobile과 완전 분리)
   * @returns {Promise<string>} 자연스러운 문어체 요약 (5문장, 단락 형식 — PC 템플릿 5줄 기준)
   */
  async summarizeWeeklySentimentWithLLM({ startDate, endDate, negVoc, posVoc }) {
    const AI_API_KEY = process.env.OPENAI_API_KEY;
    const AI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const AI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    if (!AI_API_KEY) {
      logger.debug('[WeeklyReport:PC] OpenAI API key not configured, skipping LLM');
      return null;
    }

    const neg = Array.isArray(negVoc) ? negVoc : [];
    const pos = Array.isArray(posVoc) ? posVoc : [];
    const total = neg.length + pos.length;

    // VoC 데이터를 요약하여 프롬프트에 포함
    const formatVocForPrompt = (vocList, label) => {
      if (!vocList || vocList.length === 0) return '';
      const themes = new Map();
      vocList.forEach(v => {
        const theme = String(v.categoryGroup || '').trim() || '기타';
        if (!themes.has(theme)) themes.set(theme, []);
        themes.get(theme).push({
          content: String(v.content || '').trim().substring(0, 100),
          category: String(v.category || '').trim()
        });
      });
      const lines = [`${label} VoC (총 ${vocList.length}건):`];
      Array.from(themes.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .forEach(([theme, items]) => {
          lines.push(`  - ${theme}: ${items.length}건`);
          if (items.length > 0 && items[0].content) {
            lines.push(`    예시: "${items[0].content.substring(0, 60)}..."`);
          }
        });
      return lines.join('\n');
    };

    // PC 템플릿 예시 (PUBG PC 모니터링 주간 보고서 — ■ 전반적인 동향 블록 스타일)
    const templateExample = `불법 프로그램 이용자가 지속적으로 다수 존재한다는 인식이 이어지고 있으며, 이에 따른 공정성 훼손과 플레이 의욕 저하, 제재 처리 지연 및 운영진 소통 부족에 대한 불만이 함께 확인되고 있습니다. 또한 맵·그래픽·UI 오류 등 각종 인게임 버그와 프레임 드랍, 크래시 등 기술적 문제가 지속적으로 보고되고 있어, 게임 플레이 경험에 부정적 영향을 미치고 있습니다.`;

    // System 프롬프트 (PC 전용 — Mobile 템플릿/결과물과 무관)
    const systemPrompt = [
      '당신은 **PUBG PC** 모니터링 주간 보고서 전용 작성 전문가입니다. (모바일 보고서가 아님)',
      '**PUBG PC 모니터링 주간 보고서** 템플릿의 "■ 전반적인 동향" 섹션(단일 블록) 요약문만 작성합니다.',
      '주어진 VoC는 PC 커뮤니티(Steam, Reddit 등) 기준이므로 PC 맥락으로 서술하세요.',
      '',
      '⚠️ 절대 규칙:',
      '1. 반드시 5문장으로 작성하세요 (템플릿이 5줄로 이루어져 있음)',
      '2. 단락 형식으로 작성하세요 (줄바꿈 없이 한 문단)',
      '3. 자연스러운 문어체 보고서 톤을 사용하세요',
      '4. 금지 사항:',
      '   - 대괄호 [] 사용 금지 (예: [컨텐츠] 같은 형식)',
      '   - 불릿 포인트(-) 사용 금지',
      '   - 파이프(|) 사용 금지',
      '   - 콜론(:)으로 나열하는 형식 금지',
      '   - "N건으로 확인되었으며", "N건으로 집계되었으며", "총 N건으로" 같은 데이터 집계 표현 금지',
      '   - "이번 주 VoC 데이터에서는", "금주 VoC는" 같은 명시적 데이터 언급 금지',
      '   - 키워드 나열 형식 금지',
      '   - 템플릿 예시와 다른 스타일 (데이터 중심적 서술) 금지',
      '5. 필수 포함 사항:',
      '   - 전체 집계 (부정/긍정 건수)',
      '   - 주요 부정 동향 1~2개 (원인/맥락 포함)',
      '   - 긍정 동향 (있는 경우)',
      '   - 종합적 시사점 또는 모니터링 강조',
      '',
      '아래 **PC 템플릿** 예시와 동일한 스타일로 작성하세요:',
      '',
      '=== PC 템플릿 예시 (■ 전반적인 동향) ===',
      templateExample,
      ''
    ].join('\n');

    // User 프롬프트
    const userPrompt = [
      `기간: ${startDate} ~ ${endDate}`,
      '',
      formatVocForPrompt(neg, '부정'),
      '',
      formatVocForPrompt(pos, '긍정'),
      '',
      '위 데이터를 바탕으로 템플릿 예시와 **완전히 동일한 스타일**의 자연스러운 요약문을 작성하세요.',
      '',
      '⚠️ 중요:',
      '- 템플릿 예시처럼 직접적이고 간결한 문어체로 작성하세요',
      '- "불법 프로그램 이용자가 지속적으로..."처럼 주제를 바로 시작하세요',
      '- 데이터 집계 수치를 명시적으로 언급하지 마세요 (예: "총 111건", "48건으로")',
      '- "이번 주 VoC 데이터에서는" 같은 서두를 사용하지 마세요',
      '- 템플릿 예시의 톤과 구조를 정확히 따르세요',
      '',
      '반드시 5문장, 단락 형식, 자연스러운 문어체로 작성하고, 금지된 패턴을 사용하지 마세요.'
    ].join('\n');

    try {
      const response = await axios.post(
        `${AI_BASE_URL}/chat/completions`,
        {
          model: AI_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3, // 창의성과 일관성의 균형
          max_tokens: 500, // 충분한 길이 확보
          presence_penalty: 0,
          frequency_penalty: 0
        },
        {
          headers: {
            Authorization: `Bearer ${AI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000 // 15초 타임아웃
        }
      );

      const summary = response.data?.choices?.[0]?.message?.content?.trim();
      if (!summary) {
        logger.warn('[WeeklyReport] LLM returned empty summary');
        return null;
      }

      // 금지 패턴 검증
      const prohibitedPatterns = [
        /\[.*?\]/g, // 대괄호
        /^\s*[-•]\s+/m, // 불릿 포인트
        /\|\s*/, // 파이프
        /:\s*$/m, // 콜론으로 끝나는 나열
        /\d+건으로\s*(확인|집계|조사)되었으며/, // 데이터 집계 표현
        /총\s*\d+건으로/, // "총 N건으로" 패턴
        /이번\s*주\s*VoC\s*데이터에서는/, // 명시적 데이터 언급
        /금주\s*VoC는/ // 명시적 데이터 언급
      ];

      const hasProhibited = prohibitedPatterns.some(pattern => pattern.test(summary));
      if (hasProhibited) {
        logger.warn('[WeeklyReport] LLM summary contains prohibited patterns, rejecting');
        return null;
      }

      // 문장 수 확인 (템플릿 5줄 기준: 5문장)
      const sentenceCount = (summary.match(/[.!?]\s+/g) || []).length + 1;
      if (sentenceCount < 4 || sentenceCount > 6) {
        logger.warn(`[WeeklyReport:PC] LLM summary has ${sentenceCount} sentences (expected 5, allow 4-6), rejecting`);
        return null;
      }

      logger.info('[WeeklyReport:PC] LLM summary generated successfully', { sentenceCount, length: summary.length });
      return summary;
    } catch (error) {
      logger.error('[WeeklyReport] LLM summarization failed', {
        error: error.message,
        code: error.code,
        response: error.response?.data
      });
      return null;
    }
  }

  /**
   * (핵심) 전반적인 동향 생성: 부정/긍정 VoC 텍스트를 기반으로 전문 문어체 요약(5문장, 템플릿 5줄 기준)
   * - LLM 기반 생성 시도 후, 실패 시 규칙 기반 요약으로 폴백
   * - 사용자 요구: @1월 3주차.csv의 '■ 전반적인 동향'과 유사한 톤
   */
  async summarizeWeeklySentiment({ startDate, endDate, negVoc, posVoc }) {
    // LLM 기반 요약 시도
    try {
      const llmSummary = await this.summarizeWeeklySentimentWithLLM({ startDate, endDate, negVoc, posVoc });
      if (llmSummary) {
        logger.info('[WeeklyReport] Using LLM-generated summary');
        return llmSummary;
      }
    } catch (error) {
      logger.warn('[WeeklyReport] LLM summarization failed, falling back to rule-based', { error: error.message });
    }

    // 폴백: 규칙 기반 요약
    logger.debug('[WeeklyReport] Using rule-based summary (fallback)');
    const neg = Array.isArray(negVoc) ? negVoc : [];
    const pos = Array.isArray(posVoc) ? posVoc : [];
    const total = neg.length + pos.length;

    const topN = (arr, keyFn, n = 3) => {
      const m = new Map();
      arr.forEach(v => {
        const k = keyFn(v);
        if (!k) return;
        m.set(k, (m.get(k) || 0) + 1);
      });
      return Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k, c]) => ({ k, c }));
    };

    // 테마(대분류) 기반으로 소제목 + 요약문 구성
    const themeLabel = (raw) => {
      const r = String(raw || '').trim() || '기타';
      return r.replace(/\s+/g, '');
    };

    const groupByTheme = (arr) => {
      const m = new Map();
      arr.forEach(v => {
        const key = themeLabel(v.categoryGroup);
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(v);
      });
      return m;
    };

    const negThemes = groupByTheme(neg);
    const posThemes = groupByTheme(pos);

    const sortedNegThemes = Array.from(negThemes.entries())
      .map(([k, items]) => ({ k, items, c: items.length }))
      .sort((a, b) => b.c - a.c);

    const sortedPosThemes = Array.from(posThemes.entries())
      .map(([k, items]) => ({ k, items, c: items.length }))
      .sort((a, b) => b.c - a.c);

    const pickExample = (items) => {
      const top = topN(
        items,
        v => {
          const t = String(v.content || '').trim();
          if (!t) return '';
          return t.length > 45 ? t.slice(0, 45) + '…' : t;
        },
        1
      )[0];
      return top?.k || '';
    };

    // 5문장 목표 (템플릿 5줄 기준):
    // 1) 전체 집계 1문장
    // 2) 부정 테마 1~2개를 각 1문장으로 요약(총 2문장)
    // 3) 긍정 테마 0~1문장
    // 4) 결론 1문장
    const sentences = [];

    sentences.push(`금주(${startDate}~${endDate}) 커뮤니티 VoC는 부정 ${neg.length}건, 긍정 ${pos.length}건으로 집계되었습니다.`);

    const topNeg = sortedNegThemes.slice(0, 2); // 최대 2개 테마
    if (topNeg.length === 0) {
      sentences.push(`부정 동향은 특정 주제에 편중되기보다는 다양한 주제에서 산발적으로 관찰되었습니다.`);
    } else {
      topNeg.forEach(t => {
        const example = pickExample(t.items);
        // 1문장으로 통합: "관련 불만이 N건으로 확인되었으며, 대표적으로 "..."와 유사한 언급이 반복되어 개선 체감에 대한 요구가 지속되었습니다."
        const exClause = example ? ` 대표적으로 "${example}"와(과) 유사한 언급이 반복되어` : '';
        sentences.push(`[${t.k}] 관련 불만이 ${t.c}건으로 확인되었으며,${exClause} 개선 체감에 대한 요구가 지속되었습니다.`);
      });
    }

    const topPos = sortedPosThemes[0];
    if (topPos && pos.length > 0) {
      sentences.push(`한편 긍정 반응은 [${topPos.k}] 영역에서 상대적으로 관찰되었으며, 일부 개선/콘텐츠에 대한 기대가 확인되었습니다.`);
    }

    sentences.push(total > 0
      ? `종합적으로, 주요 이슈의 재발 여부와 대응 현황에 대한 모니터링을 강화할 필요가 있습니다.`
      : `종합적으로, 유의미한 VoC 표본이 제한적이어서 추세 판단에 주의가 필요합니다.`
    );

    // 5문장 목표 (템플릿 5줄): 부족하면 보강 문장 1종씩 추가
    const fillers = [
      '종합적으로, 주요 이슈의 재발 여부와 대응 현황에 대한 모니터링을 강화할 필요가 있습니다.',
      '관련 동향은 지속 모니터링이 필요합니다.',
      '이에 대한 추이를 계속 확인할 예정입니다.'
    ];
    for (let i = 0; sentences.length < 5 && i < fillers.length; i++) {
      sentences.push(fillers[i]);
    }
    return sentences.slice(0, 5).join(' ');
  }

  /**
   * Mobile 전용: LLM으로 "■ 주간 부정 동향 요약"(B9) / "■ 주간 긍정 동향 요약"(B11) 본문 생성
   * - PUBG MOBILE 모니터링 주간 보고서 템플릿만 참고 (PC 템플릿/결과물과 완전 분리)
   * - 모바일 템플릿 9개 카테고리(유료 아이템, 게임 플레이 관련 문의, 버그, 서버/접속 등) 반영
   * @returns {{ negSummary: string, posSummary: string } | null}
   */
  async summarizeMobileNegPosWithLLM({ startDate, endDate, negVoc, posVoc }) {
    const AI_API_KEY = process.env.OPENAI_API_KEY;
    const AI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const AI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    if (!AI_API_KEY) {
      logger.debug('[WeeklyReport:Mobile] OpenAI API key not configured, skipping LLM');
      return null;
    }

    const neg = Array.isArray(negVoc) ? negVoc : [];
    const pos = Array.isArray(posVoc) ? posVoc : [];

    const formatVocForPrompt = (vocList, label) => {
      if (!vocList || vocList.length === 0) return '(해당 없음)';
      const themes = new Map();
      vocList.forEach(v => {
        const theme = String(v.categoryGroup || '').trim() || '기타';
        if (!themes.has(theme)) themes.set(theme, []);
        themes.get(theme).push(String(v.content || '').trim().substring(0, 80));
      });
      const lines = [`${label} VoC ${vocList.length}건:`];
      Array.from(themes.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .forEach(([theme, items]) => {
          lines.push(`  - ${theme}: ${items.length}건, 예: "${(items[0] || '').substring(0, 50)}..."`);
        });
      return lines.join('\n');
    };

    // PUBG MOBILE 모니터링 주간 보고서 템플릿의 ■ 주간 부정/긍정 동향 요약 블록 스타일 (모바일 전용)
    const templateExampleNeg = `불법 프로그램 이용에 대한 불만이 다수 확인되었으며, 공정성 훼손과 제재 처리 지연에 대한 언급이 반복됩니다. 인게임 버그·크래시·프레임 드랍 등 기술적 문제와 서버/접속 이슈도 지속 보고되고 있어, 게임 플레이 경험에 부정적 영향을 미치고 있습니다. 유료 아이템·이용 제한 조치 관련 문의와 비매너 행위 신고도 일부 확인되었습니다.`;
    const templateExamplePos = `업데이트·이벤트·콘텐츠에 대한 기대와 만족 의견이 일부 확인되었으며, 개선 체감과 운영 소통에 대한 긍정적 반응이 있습니다.`;

    const systemPrompt = [
      '당신은 **PUBG MOBILE** 모니터링 주간 보고서 전용 작성 전문가입니다. (PC 보고서가 아님)',
      '**PUBG MOBILE 모니터링 주간 보고서** 템플릿의 다음 두 블록만 작성합니다:',
      '  - "■ 주간 부정 동향 요약" 본문 (B9 셀)',
      '  - "■ 주간 긍정 동향 요약" 본문 (B11 셀)',
      '모바일 템플릿은 PC와 시트 구조·카테고리가 다릅니다. VoC는 모바일 커뮤니티·인앱 기준이므로 모바일 맥락(유료 아이템, 게임 플레이 관련 문의, 버그, 서버/접속, 커뮤니티/이스포츠, 불법프로그램, 비매너 행위, 이용 제한 조치, 타게임 등)으로 서술하세요.',
      '',
      '규칙:',
      '1. 부정 요약·긍정 요약 각각 5문장, 단락 형식(줄바꿈 없이 한 문단, 모바일 템플릿 5줄 기준)',
      '2. 자연스러운 문어체, 보고서 톤',
      '3. 금지: 대괄호 [] 나열, 불릿(-), "N건으로 확인되었으며", "이번 주 VoC에서는" 등',
      '4. **모바일 템플릿** 예시와 동일한 톤으로 작성 (직접적·간결)',
      '',
      '=== 모바일 템플릿 예시 (■ 주간 부정 동향 요약) ===',
      templateExampleNeg,
      '',
      '=== 모바일 템플릿 예시 (■ 주간 긍정 동향 요약) ===',
      templateExamplePos
    ].join('\n');

    const userPrompt = [
      `기간: ${startDate} ~ ${endDate}`,
      '',
      formatVocForPrompt(neg, '부정'),
      '',
      formatVocForPrompt(pos, '긍정'),
      '',
      '위 **모바일 VoC** 데이터를 바탕으로 PUBG MOBILE 템플릿의 "■ 주간 부정 동향 요약", "■ 주간 긍정 동향 요약" 블록에 들어갈 본문을 작성하세요. 반드시 아래 형식만 사용하세요 (다른 설명 없이 두 블록만 출력):',
      '',
      '【부정동향】',
      '(여기에 부정 동향 요약 5문장)',
      '',
      '【긍정동향】',
      '(여기에 긍정 동향 요약 5문장)'
    ].join('\n');

    try {
      const response = await axios.post(
        `${AI_BASE_URL}/chat/completions`,
        {
          model: AI_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 600,
          presence_penalty: 0,
          frequency_penalty: 0
        },
        {
          headers: {
            Authorization: `Bearer ${AI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000
        }
      );

      const raw = response.data?.choices?.[0]?.message?.content?.trim();
      if (!raw) {
        logger.warn('[WeeklyReport:Mobile] LLM returned empty');
        return null;
      }

      const negMatch = raw.match(/【부정동향】\s*([\s\S]*?)(?=【긍정동향】|$)/);
      const posMatch = raw.match(/【긍정동향】\s*([\s\S]*?)$/);
      // 줄바꿈(\n) 포함 순수 문자열로 반환 (WeeklyReportData 요약문용)
      const negSummary = (negMatch ? negMatch[1].trim() : '').replace(/\r/g, '');
      const posSummary = (posMatch ? posMatch[1].trim() : '').replace(/\r/g, '');

      if (!negSummary && !posSummary) {
        logger.warn('[WeeklyReport:Mobile] LLM output format invalid');
        return null;
      }

      logger.info('[WeeklyReport:Mobile] LLM neg/pos summary generated');
      return {
        negSummary: negSummary || '금주 주요 부정 동향 없음',
        posSummary: posSummary || '금주 주요 긍정 동향 없음'
      };
    } catch (error) {
      logger.error('[WeeklyReport:Mobile] LLM summarization failed', { error: error.message });
      return null;
    }
  }

  /**
   * Mobile 전용: 부정/긍정 요약 생성 (LLM 시도 후 규칙 기반 폴백)
   * - PC summarizeWeeklySentiment / fillMainSummaryTextBlocks 로직과 완전 분리
   */
  async summarizeMobileNegPos({ startDate, endDate, negVoc, posVoc }) {
    try {
      const llm = await this.summarizeMobileNegPosWithLLM({ startDate, endDate, negVoc, posVoc });
      if (llm) {
        return llm;
      }
    } catch (e) {
      logger.warn('[WeeklyReport:Mobile] LLM failed, using fallback', { error: e.message });
    }

    // 폴백: 기존 규칙 기반 (groupTopN + formatSummaryLines)
    const groupTopN = (arr, n = 3) => {
      const m = new Map();
      (Array.isArray(arr) ? arr : []).forEach(v => {
        const cg = String(v.categoryGroup || '').trim() || '기타';
        const c = String(v.category || '').trim() || '-';
        const key = `${cg}|||${c}`;
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(v);
      });
      return Array.from(m.entries())
        .map(([k, items]) => {
          const [cg, cat] = k.split('|||');
          const sample = String(items[0]?.content || '').trim();
          return { cg, c: cat, count: items.length, sample };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, n);
    };
    const formatSummaryLines = (items) => {
      if (!items || items.length === 0) return '';
      return items.map((t, idx) => {
        const sample = t.sample ? (t.sample.length > 80 ? t.sample.slice(0, 80) + '…' : t.sample) : '';
        const label = t.c && t.c !== '-' ? `${t.cg} / ${t.c}` : `${t.cg}`;
        return `${idx + 1}. ${label} (${t.count}건)${sample ? ` - ${sample}` : ''}`;
      }).join('\n');
    };

    const negTop = groupTopN(negVoc || [], 3);
    const posTop = groupTopN(posVoc || [], 3);
    return {
      negSummary: formatSummaryLines(negTop) || '금주 주요 부정 동향 없음',
      posSummary: formatSummaryLines(posTop) || '금주 주요 긍정 동향 없음'
    };
  }

  /**
   * ISSUE 기반으로 금주 최고의/최악의 동향 리스트를 생성한다.
   * - 템플릿 구조와 동일하게 대분류/중분류별로 그룹화하여 소제목 생성
   * - ISSUE가 없으면 VoC를 테마 그룹화하여 대체한다.
   */
  buildKeyTrendsFromIssuesOrVoc(issues, voc) {
    const iss = Array.isArray(issues) ? issues : [];
    const v = Array.isArray(voc) ? voc : [];

    // VoC 데이터를 대분류/중분류별로 그룹화 (템플릿 구조와 동일하게)
    const groupVocByCategory = (vocList, sentimentFilter = null) => {
      const grouped = new Map();
      vocList.forEach(v => {
        // 성향 필터링
        if (sentimentFilter) {
          const sentiment = String(v.sentiment || '').trim();
          if (sentimentFilter === '긍정' && !sentiment.includes('긍정')) return;
          if (sentimentFilter === '부정' && !sentiment.includes('부정')) return;
        }
        
        // 대분류와 중분류 조합으로 그룹화
        const categoryGroup = String(v.categoryGroup || '').trim() || '기타';
        const category = String(v.category || '').trim() || '';
        
        // 소제목 생성: "[대분류] 중분류 관련 {성향} 동향" 또는 "대분류 관련 {성향} 동향"
        let sectionTitle = '';
        if (categoryGroup.includes('컨텐츠') || categoryGroup.includes('커뮤니티')) {
          // [컨텐츠], [커뮤니티] 형식
          sectionTitle = category 
            ? `[${categoryGroup}] ${category} 관련 ${sentimentFilter || '주요'} 동향`
            : `[${categoryGroup}] 관련 ${sentimentFilter || '주요'} 동향`;
        } else {
          // 일반 형식: "대분류 관련 {성향} 동향"
          sectionTitle = category
            ? `${categoryGroup} 관련 ${sentimentFilter || '주요'} 동향`
            : `${categoryGroup} 관련 ${sentimentFilter || '주요'} 동향`;
        }
        
        if (!grouped.has(sectionTitle)) {
          grouped.set(sectionTitle, []);
        }
        grouped.get(sectionTitle).push(v);
      });
      return grouped;
    };

    // 긍정 VoC 그룹화
    const posVoc = v.filter(x => String(x.sentiment || '').includes('긍정'));
    const posGroups = groupVocByCategory(posVoc, '긍정');
    const sortedPosGroups = Array.from(posGroups.entries())
      .map(([title, items]) => ({ title, items, count: items.length }))
      .sort((a, b) => b.count - a.count);

    // 부정 VoC 그룹화
    const negVoc = v.filter(x => String(x.sentiment || '').includes('부정'));
    const negGroups = groupVocByCategory(negVoc, '부정');
    const sortedNegGroups = Array.from(negGroups.entries())
      .map(([title, items]) => ({ title, items, count: items.length }))
      .sort((a, b) => b.count - a.count);

    // 최고의 동향 생성 (템플릿 구조와 동일하게)
    // 템플릿 형식: "   섹션 제목\n  \n - 내용\n - 내용\n \n"
    const bestLines = [];
    if (sortedPosGroups.length > 0) {
      sortedPosGroups.forEach((group, idx) => {
        if (idx > 0) bestLines.push(' '); // 섹션 사이 빈 줄
        bestLines.push(`   ${group.title}`);
        bestLines.push('  ');
        // 각 그룹에서 대표적인 내용 3-5개 추출
        group.items.slice(0, 5).forEach(item => {
          const content = String(item.content || '').trim();
          if (content) {
            const shortContent = content.length > 100 ? content.substring(0, 100) + '…' : content;
            bestLines.push(` - ${shortContent}`);
          }
        });
      });
    } else {
      bestLines.push('금주 주요 긍정 동향 없음');
    }

    // 최악의 동향 생성 (템플릿 구조와 동일하게)
    const worstLines = [];
    if (sortedNegGroups.length > 0) {
      sortedNegGroups.forEach((group, idx) => {
        if (idx > 0) worstLines.push(' '); // 섹션 사이 빈 줄
        worstLines.push(`   ${group.title}`);
        worstLines.push('  ');
        // 각 그룹에서 대표적인 내용 3-5개 추출
        group.items.slice(0, 5).forEach(item => {
          const content = String(item.content || '').trim();
          if (content) {
            const shortContent = content.length > 100 ? content.substring(0, 100) + '…' : content;
            worstLines.push(` - ${shortContent}`);
          }
        });
      });
    } else {
      worstLines.push('금주 주요 부정 동향 없음');
    }

    return { bestLines, worstLines };
  }

  /**
   * VoC 테마 그룹화: 샘플처럼 [컨텐츠], [버그] 등의 소제목을 자동 부여
   * - 기본은 대분류(categoryGroup)를 사용
   * - 값 정규화(띄어쓰기/슬래시 제거 등)로 묶음 품질 개선
   */
  groupVocThemes(voc) {
    const map = new Map();
    (Array.isArray(voc) ? voc : []).forEach(v => {
      const raw = String(v.categoryGroup || '').trim() || '기타';
      const key = raw.replace(/\s+/g, '').replace(/[\/\|]/g, '·');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(v);
    });
    return map;
  }

  /**
   * 일일보고서 엑셀 파일을 기반으로 템플릿을 사용하여 주간 보고서 생성
   * @param {string} dailyExcelPath - 일일보고서 엑셀 파일 경로
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   * @param {number} projectId - 프로젝트 ID (1: PC, 2: MOBILE)
   * @param {Object} options - 추가 옵션
   * @returns {Promise<Buffer>} 생성된 주간 보고서 엑셀 버퍼
   */
  async generateWeeklyReportFromExcel(dailyExcelPath, startDate, endDate, projectId = PROJECT_IDS.PC, options = {}) {
    // projectId에 따라 템플릿 경로 선택 (빈 템플릿이 있으면 우선 사용)
    const fs = require('fs');
    const basePath = projectId === PROJECT_IDS.MOBILE ? TEMPLATE_WEEKLY_MOBILE_PATH : TEMPLATE_WEEKLY_PC_PATH;
    const blankPath = projectId === PROJECT_IDS.MOBILE ? TEMPLATE_WEEKLY_MOBILE_BLANK : TEMPLATE_WEEKLY_PC_BLANK;
    const templatePath = options.templatePath || (fs.existsSync(blankPath) ? blankPath : basePath);
    
    logger.info('Generating weekly report from daily Excel using template', {
      dailyExcelPath,
      templatePath,
      startDate,
      endDate,
      projectId
    });

    // 템플릿 워크북 로드 후 새 워크북으로 복사 (RichText 객체 문제 회피)
    const originalTemplateWb = new ExcelJS.Workbook();
    await originalTemplateWb.xlsx.readFile(templatePath);
    
    // 템플릿을 버퍼로 저장 후 다시 읽어서 새 워크북 생성 (RichText 객체 문제 회피)
    // 이렇게 하면 RichText 객체가 일반 텍스트로 변환되어 처리하기 쉬워짐
    // 주의: 공유 수식은 이 과정에서 제거되지 않으므로 별도 처리 필요
    const templateBuffer = await originalTemplateWb.xlsx.writeBuffer();
    const templateWb = new ExcelJS.Workbook();
    await templateWb.xlsx.load(templateBuffer);

    // 1. 템플릿 메타데이터 초기화 (Corruption Fix): 명명된 범위·자동필터 제거
    if (templateWb.definedNames && typeof templateWb.definedNames.model !== 'undefined') {
      templateWb.definedNames.model = [];
    }
    if (templateWb.model && templateWb.model.definedNames) {
      templateWb.model.definedNames = [];
    }
    templateWb.worksheets.forEach((sheet) => {
      if (sheet.autoFilter != null) sheet.autoFilter = null;
    });

    // 템플릿 로드 직후 공유 수식 초기화: D15 셀을 포함하여 수식 오류가 예상되는 모든 셀의 값을 null로 초기화
    try {
      for (const sheet of templateWb.worksheets) {
        // 안티치트_INDEX 시트의 D15, C14 등 수식이 있는 셀 초기화
        if (sheet.name === '안티치트_INDEX') {
          // R14-R15 행의 수식 셀 초기화
          const problemCells = [
            { row: 14, col: 3 }, // C14
            { row: 14, col: 4 }, // D14
            { row: 15, col: 3 }, // C15
            { row: 15, col: 4 }  // D15
          ];
          problemCells.forEach(({ row, col }) => {
            try {
              const cell = sheet.getCell(row, col);
              // 수식 정보를 완전히 제거하고 null로 초기화
              cell.value = null;
              if (cell.sharedFormula) {
                delete cell.sharedFormula;
                cell.sharedFormula = null;
              }
              // value 객체 내부의 sharedFormula도 제거
              if (cell.value && typeof cell.value === 'object' && cell.value.sharedFormula) {
                cell.value = null;
              }
            } catch (e) {
              // 개별 셀 처리 오류는 무시
            }
          });
        }
        
        // 모든 시트에서 공유 수식 제거 (내부 모델)
        if (sheet.model && sheet.model.rows) {
          for (const row of sheet.model.rows) {
            if (row.cells) {
              for (const cell of Object.values(row.cells)) {
                if (cell.sharedFormula) {
                  delete cell.sharedFormula;
                }
              }
            }
          }
        }
      }
    } catch (e) {
      this.logger.warn('템플릿 로드 직후 공유 수식 제거 오류:', e.message);
    }
    
    // Named Range 제거 (엑셀 복구 오류 방지) - 더 강력한 방법
    try {
      // 방법 1: definedNames 컬렉션을 통해 제거
      if (templateWb.definedNames && templateWb.definedNames.length > 0) {
        const namesToRemove = [];
        templateWb.definedNames.forEach((name) => {
          namesToRemove.push(name.name);
        });
        namesToRemove.forEach((name) => {
          try {
            templateWb.definedNames.remove(name);
          } catch (e) {
            // 제거 실패는 무시
          }
        });
      }
      
      // 방법 2: 내부 모델에서 직접 제거 (더 강력)
      if (templateWb.model && templateWb.model.definedNames) {
        templateWb.model.definedNames = [];
      }
      
      // 방법 3: writeBuffer 전에 다시 한 번 확인 및 제거
      // (이 부분은 writeBuffer 직전에 다시 실행됨)
    } catch (e) {
      this.logger.warn('Named Range 제거 오류:', e.message);
    }
    
    // 공유 수식(Shared Formula) 정리: 모든 시트에서 공유 수식을 제거
    // ExcelJS가 공유 수식을 제대로 처리하지 못할 수 있으므로 제거
    // 주의: 이 작업은 선택적이며, 오류가 발생해도 계속 진행
    try {
      for (const sheet of templateWb.worksheets) {
        try {
          // eachRow를 사용하여 공유 수식 제거
          sheet.eachRow({ includeEmpty: false }, (row) => {
            row.eachCell({ includeEmpty: false }, (cell) => {
              if (cell.sharedFormula) {
                // 공유 수식 제거 (일반 수식은 유지)
                try {
                  cell.sharedFormula = null;
                } catch (e) {
                  // 개별 셀 처리 오류는 무시
                }
              }
            });
          });
        } catch (e) {
          // 시트별 처리 오류는 무시하고 계속 진행
          this.logger.warn(`공유 수식 처리 오류 (${sheet.name}):`, e.message);
        }
      }
    } catch (e) {
      // 전체 공유 수식 처리 오류는 무시하고 계속 진행
      this.logger.warn('공유 수식 처리 중 전체 오류:', e.message);
    }

    // 일일보고서 워크북 로드
    const dailyWb = new ExcelJS.Workbook();
    await dailyWb.xlsx.readFile(dailyExcelPath);

    // 현재 주차 데이터 파싱
    const currentWeekData = await this.parseExcelData(dailyWb, startDate, endDate, projectId);
    
    // 이전 주차 데이터 파싱
    const { prevWeekStart, prevWeekEnd } = this.calculatePreviousWeek(startDate, endDate);
    const prevWeekData = await this.parseExcelData(dailyWb, prevWeekStart, prevWeekEnd, projectId);

    // 메인 시트 이름 설정 (PC: "1월 4주차", Mobile: "1월 3주차" 등)
    // 템플릿에서 주차 이름이 포함된 첫 번째 시트를 찾거나, 기본값 사용
    let templateMain = null;
    for (const sheet of templateWb.worksheets) {
      if (sheet.name.includes('주차')) {
        templateMain = sheet;
        break;
      }
    }
    if (!templateMain) {
      templateMain = templateWb.worksheets[0];
    }
    if (!templateMain) {
      throw new Error('템플릿 메인 시트를 찾을 수 없습니다.');
    }

    const currentLabel = this.formatMainWeekSheetName(startDate);
    const prevLabel = this.formatMainWeekSheetName(prevWeekStart);

    // 현재 주차 시트 이름 변경
    if (templateMain.name !== currentLabel) {
      templateMain.name = currentLabel;
    }

    // 이전 주차 시트 처리
    // - MOBILE: 템플릿에 이전 주차 시트가 없으면 복제하여 생성(요구사항)
    // - PC: 템플릿 구조를 100% 유지해야 하므로 "없으면 생성"하지 않고, 존재할 때만 채움
    let prevSheet = templateWb.getWorksheet(prevLabel);
    if (!prevSheet && projectId === PROJECT_IDS.MOBILE) {
      prevSheet = this.cloneWorksheet(templateWb, templateMain, prevLabel);
    }

    // 1) WeeklyReportData 객체 우선 생성 (모든 원천 데이터 분석 + AI 요약문은 \n 포함 순수 문자열로)
    const data = await buildWeeklyReportData(this, dailyWb, startDate, endDate, projectId);
    data.meta.mainSheetName = currentLabel;
    data.meta.prevSheetName = prevLabel;
    try {
      const mainSh = templateWb.getWorksheet(currentLabel) || templateMain;
      const l4 = mainSh.getCell('L4').value;
      if (l4 != null && (typeof l4 === 'string' ? l4.trim() : '')) {
        const str = typeof l4 === 'string' ? l4 : (l4.richText ? l4.richText.map(t => t.text || '').join('') : String(l4));
        if (!/^\d{4}[-.]\d{2}[-.]\d{2}\s*~/.test(str)) data.meta.authorName = str.trim();
      }
    } catch (_) {}

    // 2) 엑셀 생성: WeeklyReportData만 인자로 셀 값 + 스타일만 적용
    await writeWeeklyReportToExcel(templateWb, data, { copyCellStyleIndependently: this.copyCellStyleIndependently });

    // 이전 주차 데이터 채우기 (템플릿에 해당 시트가 있는 경우에만)
    if (prevSheet) {
      await this.fillMainSummarySheetFromDailyExcel(templateWb, {
        startDate: prevWeekStart,
        endDate: prevWeekEnd,
        projectId,
        mainSheetName: prevLabel
      });

      await this.fillMainSummaryTextBlocksFromDailyExcel(templateWb, {
        startDate: prevWeekStart,
        endDate: prevWeekEnd,
        projectId,
        voc: prevWeekData.voc || [],
        issues: prevWeekData.issues || [],
        mainSheetName: prevLabel
      });

      await this.fillMainIngameTrendTableFromDailyExcel(templateWb, {
        startDate: prevWeekStart,
        endDate: prevWeekEnd,
        projectId,
        voc: prevWeekData.voc || [],
        mainSheetName: prevLabel
      });
    } else {
      logger.info('Prev week sheet not present in template; skipping prev week fill', {
        projectId,
        prevLabel
      });
    }

    // 커뮤니티 일반 시트 채우기
    await this.fillCommunityGeneralSheetFromDailyExcel(templateWb, {
      startDate,
      endDate,
      projectId,
      voc: currentWeekData.voc || []
    });

    // 안티치트_INDEX 시트 채우기 (PC 전용, Mobile에는 없을 수 있음)
    if (projectId === PROJECT_IDS.PC || templateWb.getWorksheet('안티치트_INDEX')) {
      await this.fillAntiCheatIndexSheetFromDailyExcel(templateWb, {
        startDate,
        endDate,
        projectId,
        voc: currentWeekData.voc || [],
        dailyWorkbook: dailyWb
      });
    }

    // 제보게시판 시트 채우기 (PC 전용, Mobile에는 없을 수 있음)
    if (projectId === PROJECT_IDS.PC || templateWb.getWorksheet('제보게시판')) {
      await this.fillReportBoardSheetFromDailyExcel(templateWb, {
        startDate,
        endDate,
        projectId,
        voc: currentWeekData.voc || []
      });
    }

    // MOBILE: [object Object] 방지용 정규화(템플릿 잔존 객체 포함)
    if (projectId === PROJECT_IDS.MOBILE) {
      this.normalizeWorkbookObjectCellsForMobile(templateWb);
    }

    // 파일 저장 전 최종 공유 수식 제거 및 Named Range 제거 (Excel "제거된/복구된 레코드" 경고 방지)
    try {
      // 명명된 범위 완전 제거 — workbook.xml에 아무 것도 남기지 않도록
      if (templateWb.definedNames && templateWb.definedNames.length > 0) {
        const remainingNames = [];
        templateWb.definedNames.forEach((name) => remainingNames.push(name.name));
        remainingNames.forEach((name) => {
          try { templateWb.definedNames.remove(name); } catch (e) { /* ignore */ }
        });
      }
      if (templateWb.model && templateWb.model.definedNames) {
        templateWb.model.definedNames = [];
      }
      // 내부 모델에서 속성 자체 제거 (ExcelJS가 workbook.xml에 definedNames 노드를 쓰지 않도록)
      if (templateWb.model && 'definedNames' in templateWb.model) {
        delete templateWb.model.definedNames;
      }
      if (templateWb.workbook && templateWb.workbook.definedNames) {
        templateWb.workbook.definedNames = [];
        delete templateWb.workbook.definedNames;
      }
      if (templateWb.definedNames && templateWb.definedNames.length > 0) {
        try { templateWb.definedNames = []; } catch (e) { /* ignore */ }
      }

      // sheet3 셀 정보 복구 경고 방지: 3번째 시트 수식 → 값 치환
      const sheet3 = templateWb.worksheets[2];
      if (sheet3) {
        try {
          sheet3.eachRow({ includeEmpty: false }, (row) => {
            row.eachCell({ includeEmpty: false }, (cell) => {
              if (cell.sharedFormula || (cell.value && typeof cell.value === 'object' && (cell.value.sharedFormula || cell.value.formula))) {
                const result = (cell.value && cell.value.result != null) ? cell.value.result : '';
                cell.value = result;
                if (cell.sharedFormula) { delete cell.sharedFormula; cell.sharedFormula = null; }
              }
            });
          });
        } catch (e) {
          this.logger.warn('sheet3 수식 치환 오류:', e.message);
        }
      }
      
      // 공유 수식 최종 제거
      for (const sheet of templateWb.worksheets) {
        try {
          // ExcelJS 내부 모델 접근
          if (sheet.model && sheet.model.rows) {
            for (const row of sheet.model.rows) {
              if (row.cells) {
                for (const cellKey of Object.keys(row.cells)) {
                  const cell = row.cells[cellKey];
                  if (cell && cell.sharedFormula) {
                    delete cell.sharedFormula;
                  }
                }
              }
            }
          }
          // API 레벨에서도 제거
          sheet.eachRow({ includeEmpty: false }, (row) => {
            row.eachCell({ includeEmpty: false }, (cell) => {
              if (cell.sharedFormula) {
                delete cell.sharedFormula;
                cell.sharedFormula = null;
              }
              // value 객체 내부의 sharedFormula/formula 제거 — 값만 남겨 수식 관련 복구 경고 방지
              if (cell.value && typeof cell.value === 'object' && (cell.value.sharedFormula || cell.value.formula)) {
                const result = cell.value.result;
                cell.value = result != null ? result : null;
              }
            });
          });
        } catch (e) {
          this.logger.warn(`최종 공유 수식 제거 오류 (${sheet.name}):`, e.message);
        }
      }
    } catch (e) {
      this.logger.warn('최종 공유 수식 제거 중 전체 오류:', e.message);
    }
    
    const buffer = await templateWb.xlsx.writeBuffer();
    logger.info('Weekly report generated using template', {
      templatePath,
      dailyExcelPath,
      startDate,
      endDate,
      projectId,
      bufferSize: buffer.length
    });
    return buffer;
  }

  /**
   * 일일보고서 엑셀 파일에서 데이터 파싱
   * @param {ExcelJS.Workbook} workbook - 엑셀 워크북
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   * @param {number} projectId - 프로젝트 ID
   * @returns {Promise<Object>} 파싱된 데이터 {voc: [], issues: []}
   */
  async parseExcelData(workbook, startDate, endDate, projectId) {
    const result = { voc: [], issues: [] };

    // VoC 시트 파싱 (PC: VoC/커뮤니티 일반, Mobile: VoC)
    const vocSheet = workbook.getWorksheet('VoC') || workbook.getWorksheet('커뮤니티 일반');
    if (vocSheet) {
      result.voc = await this.parseVoCSheet(vocSheet, startDate, endDate, projectId);
    }

    // ISSUE 시트 파싱 (PC: ISSUE/이슈, Mobile: Issue)
    const issueSheet = workbook.getWorksheet('ISSUE') || workbook.getWorksheet('이슈') || workbook.getWorksheet('Issue');
    if (issueSheet) {
      result.issues = await this.parseIssueSheet(issueSheet, startDate, endDate, projectId);
    }

    return result;
  }

  /**
   * VoC 시트 파싱
   * @param {ExcelJS.Worksheet} sheet - VoC 시트
   * @param {string} startDate - 시작 날짜
   * @param {string} endDate - 종료 날짜
   * @param {number} projectId - 프로젝트 ID
   * @returns {Promise<Array>} VoC 배열
   */
  async parseVoCSheet(sheet, startDate, endDate, projectId) {
    const vocList = [];
    const start = new Date(startDate + 'T00:00:00.000Z');
    const end = new Date(endDate + 'T23:59:59.999Z');

    const getCellString = (cellValue) => {
      if (cellValue == null) return '';
      if (typeof cellValue === 'object') {
        if (cellValue.text) return String(cellValue.text).trim();
        if (cellValue.result && typeof cellValue.result !== 'object') {
          return String(cellValue.result).trim();
        }
        return '';
      }
      return String(cellValue).trim();
    };

    // 헤더 찾기
    let headerRow = null;
    const headerMap = {};
    
    for (let rowNum = 1; rowNum <= Math.min(10, sheet.rowCount); rowNum++) {
      const row = sheet.getRow(rowNum);
      let hasHeader = false;
      
      for (let col = 1; col <= sheet.columnCount; col++) {
        const cellValue = String(row.getCell(col).value || '').trim();
        if (!cellValue) continue;

        if (cellValue.includes('날짜') || cellValue.includes('Date')) {
          headerMap.date = col;
          hasHeader = true;
        } else if (cellValue.includes('플랫폼') || cellValue.toLowerCase().includes('platform')) {
          headerMap.platform = col;
          hasHeader = true;
        } else if (cellValue.includes('내용') || cellValue.includes('Content')) {
          headerMap.content = col;
          hasHeader = true;
        } else if (cellValue.includes('성향') || cellValue.includes('Sentiment')) {
          headerMap.sentiment = col;
          hasHeader = true;
        } else if (cellValue.includes('대분류') || cellValue.includes('Category Group')) {
          headerMap.categoryGroup = col;
          hasHeader = true;
        } else if (cellValue.includes('중분류') || cellValue.includes('Category')) {
          headerMap.category = col;
          hasHeader = true;
        } else if (cellValue.includes('출처') || cellValue.includes('Source')) {
          headerMap.source = col;
          hasHeader = true;
        } else if (cellValue.includes('종류') || cellValue.includes('Type')) {
          headerMap.type = col;
          hasHeader = true;
        } else if (cellValue.includes('중요도')) {
          headerMap.importance = col;
          hasHeader = true;
        } else if (cellValue.replace(/\s+/g, '').includes('판단/확인사항')) {
          headerMap.judgement = col;
          hasHeader = true;
        } else if (cellValue.includes('근무')) {
          headerMap.workType = col;
          hasHeader = true;
        } else if (cellValue.includes('비고')) {
          headerMap.note = col;
          hasHeader = true;
        } else if (cellValue.includes('링크') || cellValue.includes('URL')) {
          headerMap.url = col;
          hasHeader = true;
        }
      }

      if (hasHeader && Object.keys(headerMap).length >= 3) {
        headerRow = rowNum;
        break;
      }
    }

    if (!headerRow) {
      logger.warn('VoC sheet header not found');
      return vocList;
    }

    // 데이터 행 파싱
    // VoC 시트: B열(2번 컬럼) 5행부터 날짜 데이터, 4행이 헤더. 엑셀 필터(자동 필터)는
    // 표시만 숨길 뿐 셀 데이터를 제거하지 않으므로, 모든 행(headerRow+1 ~ rowCount)을
    // 순회해도 필터로 인해 빠지는 행은 없음. row.hidden은 건드리지 않고 전부 읽음.
    for (let rowNum = headerRow + 1; rowNum <= sheet.rowCount; rowNum++) {
      const rowObj = sheet.getRow(rowNum);
      
      // 날짜 필터링
      let vocDate = null;
      if (headerMap.date) {
        const dateValue = rowObj.getCell(headerMap.date).value;
        if (dateValue instanceof Date) {
          vocDate = dateValue;
        } else if (typeof dateValue === 'string') {
          vocDate = new Date(dateValue);
        } else if (typeof dateValue === 'number') {
          // Excel serial date
          vocDate = ExcelJS.DateTime.fromExcelSerialNumber(dateValue);
        }
      }

      if (!vocDate || isNaN(vocDate.getTime())) continue;
      if (vocDate < start || vocDate > end) continue;

      // 플랫폼/출처 값 추출
      const platformRaw = headerMap.platform
        ? getCellString(rowObj.getCell(headerMap.platform).value)
        : '';
      const sourceRaw = headerMap.source
        ? getCellString(rowObj.getCell(headerMap.source).value)
        : '';

      // 플랫폼 필터링 (projectId 기반)
      // Mobile 일일 보고서 파일 자체가 모바일 전용이므로, projectId가 MOBILE이면 플랫폼 필터 스킵
      if (projectId !== PROJECT_IDS.MOBILE) {
        const platformText = platformRaw || sourceRaw;
        const isPC = /PC|Steam|steam/i.test(platformText);
        if (platformText && projectId === PROJECT_IDS.PC && !isPC) continue;
      }

      const voc = {
        date: vocDate.toISOString().split('T')[0],
        content: headerMap.content ? getCellString(rowObj.getCell(headerMap.content).value) : '',
        sentiment: headerMap.sentiment ? getCellString(rowObj.getCell(headerMap.sentiment).value) : '',
        categoryGroup: headerMap.categoryGroup ? getCellString(rowObj.getCell(headerMap.categoryGroup).value) : '',
        category: headerMap.category ? getCellString(rowObj.getCell(headerMap.category).value) : '',
        platform: platformRaw,
        source: sourceRaw,
        type: headerMap.type ? getCellString(rowObj.getCell(headerMap.type).value) : '',
        importance: headerMap.importance ? getCellString(rowObj.getCell(headerMap.importance).value) : '',
        judgement: headerMap.judgement ? getCellString(rowObj.getCell(headerMap.judgement).value) : '',
        workType: headerMap.workType ? getCellString(rowObj.getCell(headerMap.workType).value) : '',
        note: headerMap.note ? getCellString(rowObj.getCell(headerMap.note).value) : '',
        postUrls: []
      };

      // URL 수집 (여러 컬럼에서)
      // 하이퍼링크와 일반 텍스트 URL 모두 추출
      // 반환: { text: 표시텍스트, url: 주소 } (하이퍼링크 형태로 P열에 쓰기 위함)
      const extractUrlFromCell = (cell) => {
        if (!cell) return null;
        if (cell.hyperlink) {
          const link = cell.hyperlink;
          if (typeof link === 'string') return { text: link, url: link };
          if (link && typeof link === 'object') {
            const address = link.address || link.hyperlink || '';
            const text = (link.text != null && link.text !== '') ? String(link.text) : address;
            if (address) return { text, url: address };
          }
        }
        const cellValue = cell.value;
        if (!cellValue) return null;
        let strValue = '';
        if (cellValue.richText && Array.isArray(cellValue.richText)) {
          strValue = cellValue.richText.map(t => t.text || '').join('').trim();
        } else {
          strValue = String(cellValue).trim();
        }
        if (strValue && (strValue.startsWith('http') || strValue.includes('cafe.naver') || strValue.includes('discord'))) {
          return { text: strValue, url: strValue };
        }
        return null;
      };

      const pushLinkIfNew = (item) => {
        if (!item || !item.url) return;
        const exists = voc.postUrls.some(p => (typeof p === 'object' ? p.url : p) === item.url);
        if (!exists) voc.postUrls.push(item);
      };

      if (headerMap.url) {
        const item = extractUrlFromCell(rowObj.getCell(headerMap.url));
        if (item) pushLinkIfNew(item);
      }
      for (let col = 14; col <= 23; col++) {
        const item = extractUrlFromCell(rowObj.getCell(col));
        if (item) pushLinkIfNew(item);
      }

      // 템플릿 분류/플랫폼/주제와 일치하도록 정규화 (결과물에 템플릿 표준 라벨만 노출)
      const normalized = normalizeCategoryForTemplate(projectId, voc.categoryGroup, voc.category);
      voc.categoryGroup = normalized.categoryGroup;
      voc.category = normalized.category;

      vocList.push(voc);
    }

    return vocList;
  }

  /**
   * ISSUE 시트 파싱
   * @param {ExcelJS.Worksheet} sheet - ISSUE 시트
   * @param {string} startDate - 시작 날짜
   * @param {string} endDate - 종료 날짜
   * @param {number} projectId - 프로젝트 ID
   * @returns {Promise<Array>} ISSUE 배열
   */
  async parseIssueSheet(sheet, startDate, endDate, projectId) {
    const issueList = [];
    const start = new Date(startDate + 'T00:00:00.000Z');
    const end = new Date(endDate + 'T23:59:59.999Z');

    // 헤더 찾기
    let headerRow = null;
    const headerMap = {};
    
    for (let rowNum = 1; rowNum <= Math.min(10, sheet.rowCount); rowNum++) {
      const row = sheet.getRow(rowNum);
      let hasHeader = false;
      
      for (let col = 1; col <= sheet.columnCount; col++) {
        const cellValue = String(row.getCell(col).value || '').trim();
        if (!cellValue) continue;

        if (cellValue.includes('날짜') || cellValue.includes('Date')) {
          headerMap.date = col;
          hasHeader = true;
        } else if (cellValue.includes('요약') || cellValue.includes('Summary')) {
          headerMap.summary = col;
          hasHeader = true;
        } else if (cellValue.includes('상세') || cellValue.includes('세부 내용') || cellValue.includes('Detail')) {
          headerMap.detail = col;
          hasHeader = true;
        } else if (cellValue.includes('대분류') || cellValue === '분류') {
          // Mobile Issue 시트는 "분류" 컬럼만 있음
          headerMap.categoryGroup = col;
          headerMap.category = col;
          hasHeader = true;
        } else if (cellValue.replace(/\s+/g, '') === '공유시간') {
          headerMap.shareTime = col;
          hasHeader = true;
        } else if (cellValue.replace(/\s+/g, '') === '공유방식') {
          headerMap.shareMethod = col;
          hasHeader = true;
        } else if (cellValue.includes('성향')) {
          headerMap.sentiment = col;
          hasHeader = true;
        }
      }

      if (hasHeader && Object.keys(headerMap).length >= 2) {
        headerRow = rowNum;
        break;
      }
    }

    if (!headerRow) {
      logger.warn('Issue sheet header not found');
      return issueList;
    }

    // 데이터 행 파싱
    for (let rowNum = headerRow + 1; rowNum <= sheet.rowCount; rowNum++) {
      const rowObj = sheet.getRow(rowNum);
      
      let issueDate = null;
      if (headerMap.date) {
        const dateValue = rowObj.getCell(headerMap.date).value;
        if (dateValue instanceof Date) {
          issueDate = dateValue;
        } else if (typeof dateValue === 'string') {
          issueDate = new Date(dateValue);
        } else if (typeof dateValue === 'number') {
          issueDate = ExcelJS.DateTime.fromExcelSerialNumber(dateValue);
        }
      }

      if (!issueDate || isNaN(issueDate.getTime())) continue;
      if (issueDate < start || issueDate > end) continue;

      const catVal = headerMap.categoryGroup ? String(rowObj.getCell(headerMap.categoryGroup).value || '').trim() : '';
      const shareTimeVal = headerMap.shareTime ? rowObj.getCell(headerMap.shareTime).value : null;
      const shareMethodVal = headerMap.shareMethod ? rowObj.getCell(headerMap.shareMethod).value : null;
      const issue = {
        date: issueDate.toISOString().split('T')[0],
        summary: headerMap.summary ? String(rowObj.getCell(headerMap.summary).value || '').trim() : '',
        detail: headerMap.detail ? String(rowObj.getCell(headerMap.detail).value || '').trim() : '',
        categoryGroup: catVal,
        category: catVal,
        sentiment: headerMap.sentiment ? String(rowObj.getCell(headerMap.sentiment).value || '').trim() : '',
        shareTime: shareTimeVal instanceof Date
          ? shareTimeVal
          : (typeof shareTimeVal === 'string' ? new Date(shareTimeVal) : null),
        shareMethod: shareMethodVal != null ? String(shareMethodVal).trim() : ''
      };

      // 템플릿 분류와 일치하도록 정규화 (Mobile: 9개 표준 라벨, PC: 대/중분류 통일)
      const normalized = normalizeCategoryForTemplate(projectId, issue.categoryGroup, issue.category);
      issue.categoryGroup = normalized.categoryGroup;
      issue.category = normalized.category;

      issueList.push(issue);
    }

    return issueList;
  }

  /**
   * Mobile 전용: 워크북 내 객체형 셀 값을 문자열로 정규화
   * - RichText / Result / Hyperlink 객체 등이 엑셀에서 [object Object]로 보이는 문제 방지
   * - Date/Formula는 유지
   */
  normalizeWorkbookObjectCellsForMobile(workbook) {
    const toText = (v) => {
      if (v == null) return '';
      if (typeof v !== 'object') return String(v);
      if (v instanceof Date) return v;
      if (v.richText) return v.richText.map(x => x.text || '').join('');
      if (typeof v.text === 'string') return v.text;
      if (v.result != null && typeof v.result !== 'object') return String(v.result);
      if (v.hyperlink && typeof v.text === 'string') return v.text;
      return String(v);
    };

    workbook.worksheets.forEach(sh => {
      const maxR = Math.min(sh.rowCount || 0, 600);
      const maxC = Math.min(sh.columnCount || 0, 40);
      for (let r = 1; r <= maxR; r++) {
        const row = sh.getRow(r);
        for (let c = 1; c <= maxC; c++) {
          const cell = row.getCell(c);
          if (cell && cell.formula) continue;
          const v = cell?.value;
          if (v && typeof v === 'object' && !(v instanceof Date)) {
            // 하이퍼링크 셀은 객체 그대로 유지(클릭 가능한 링크 보존)
            if (v.hyperlink != null && (typeof v.text === 'string' || v.text == null)) {
              continue;
            }
            const t = toText(v);
            cell.value = t instanceof Date ? t : String(t);
          }
        }
      }
    });
  }

  /**
   * Mobile 전용: 주간 템플릿의 VoC 시트에 데이터 채우기
   * - 템플릿 구조: 4행 헤더, 5행부터 데이터 (A:H + 링크 컬럼)
   */
  fillMobileWeeklyVocSheet(templateWb, ctx) {
    const { startDate, endDate, projectId, voc } = ctx;
    const sh = templateWb.getWorksheet('VoC');
    if (!sh) return;

    // 데이터 영역 클리어(5행~) - 헤더(1~4행)는 유지, 템플릿 샘플 데이터 완전 제거 (1~23열)
    const clearEndRow = 500;
    const clearColEnd = 23;
    const maxR = Math.min(sh.rowCount || 0, 600);
    for (let r = 5; r <= Math.max(maxR, clearEndRow); r++) {
      const row = sh.getRow(r);
      for (let c = 1; c <= clearColEnd; c++) {
        const cell = row.getCell(c);
        if (cell.formula) continue;
        cell.value = null;
      }
    }

    // 기간 필터(엄격)
    const filtered = (voc || []).filter(v => v?.date && v.date >= startDate && v.date <= endDate);

    // 템플릿 정렬 기준: 대분류 → 중분류 → 날짜(최신순)
    const pid = projectId === undefined ? PROJECT_IDS.MOBILE : projectId;
    const sorted = [...filtered].sort((a, b) => {
      const na = normalizeCategoryForTemplate(pid, a.categoryGroup, a.category);
      const nb = normalizeCategoryForTemplate(pid, b.categoryGroup, b.category);
      const cg = (na.categoryGroup || '').localeCompare(nb.categoryGroup || '');
      if (cg !== 0) return cg;
      const cat = (na.category || '').localeCompare(nb.category || '');
      if (cat !== 0) return cat;
      const da = (a.date || '').toString();
      const db = (b.date || '').toString();
      return db.localeCompare(da);
    });

    // 데이터가 기본 영역(5~500, 최대 496행)을 초과하면 행 추가
    const maxDataRows = clearEndRow - 5 + 1;
    if (sorted.length > maxDataRows) {
      const needInsert = sorted.length - maxDataRows;
      const styleRow = 5;
      for (let i = 0; i < needInsert; i++) {
        sh.insertRow(clearEndRow + 1, []);
        const dest = sh.getRow(clearEndRow + 1);
        const src = sh.getRow(styleRow);
        try {
          if (src.height != null) dest.height = src.height;
        } catch (_) {}
        for (let c = 1; c <= clearColEnd; c++) {
          try {
            const sc = src.getCell(c);
            const dc = dest.getCell(c);
            copyCellStyleIndependently(dc, sc);
            if (sc.numFmt) dc.numFmt = sc.numFmt;
          } catch (_) {}
        }
      }
    }

    // 입력: A 날짜, B 출처, C 대분류, D 중분류, E 종류, F 성향, G 중요도, H 내용, I~ 링크
    let writeRow = 5;
    sorted.forEach(v => {
      const norm = normalizeCategoryForTemplate(pid, v.categoryGroup, v.category);
      const row = sh.getRow(writeRow);
      row.getCell(1).value = v.date || '';
      row.getCell(2).value = v.source || v.platform || '';
      row.getCell(3).value = norm.categoryGroup || '';
      row.getCell(4).value = norm.category || '';
      row.getCell(5).value = v.type || '';
      row.getCell(6).value = v.sentiment || '';
      row.getCell(7).value = v.importance || '';
      row.getCell(8).value = v.content || '';

      const urls = Array.isArray(v.postUrls) ? v.postUrls : [];
      urls.slice(0, 10).forEach((u, i) => {
        const cell = row.getCell(9 + i);
        if (u != null) {
          const url = typeof u === 'object' && u.url != null ? u.url : String(u);
          cell.value = { text: '1', hyperlink: url };
        } else {
          cell.value = '';
        }
      });
      writeRow++;
    });

    // 빈 칸 제거: 데이터 마지막 행 이후 구간 완전 클리어 (템플릿 데이터 절대 잔존 방지)
    const lastDataRow = writeRow - 1;
    const finalClearEnd = Math.max(clearEndRow, lastDataRow + 200);
    for (let r = lastDataRow + 1; r <= finalClearEnd; r++) {
      try {
        const row = sh.getRow(r);
        for (let c = 1; c <= clearColEnd; c++) {
          const cell = row.getCell(c);
          if (!cell.formula) cell.value = null;
        }
      } catch (_) {
        break;
      }
    }

    // VoC 요약 통계: 6행 21~23열 (총 건수, 대분류 수, 중분류 수) — 템플릿에 있던 352, 10, 24 등 채움
    const uniqueGroups = new Set(sorted.map(v => normalizeCategoryForTemplate(pid, v.categoryGroup, v.category).categoryGroup).filter(Boolean));
    const uniqueCats = new Set(sorted.map(v => normalizeCategoryForTemplate(pid, v.categoryGroup, v.category).category).filter(Boolean));
    try {
      sh.getRow(6).getCell(21).value = filtered.length;
      sh.getRow(6).getCell(22).value = uniqueGroups.size;
      sh.getRow(6).getCell(23).value = uniqueCats.size;
    } catch (_) {}
  }

  /**
   * Mobile 전용: '공유 이슈 시간 순' 시트 채우기
   * - 템플릿은 상단에 샘플 텍스트가 다수 존재하므로 데이터 영역을 비우고, 공유시간 기준으로 요약 목록 기입
   */
  fillMobileSharedIssueTimeSheet(templateWb, ctx) {
    const { issues } = ctx;
    const sh = templateWb.getWorksheet('공유 이슈 시간 순');
    if (!sh) return;

    // 데이터 영역 클리어: 3행~ (1~2행은 타이틀 유지, 템플릿 샘플 데이터 완전 제거)
    const clearEndRow = 500;
    for (let r = 3; r <= clearEndRow; r++) {
      const row = sh.getRow(r);
      for (let c = 1; c <= 12; c++) {
        const cell = row.getCell(c);
        if (cell.formula) continue;
        cell.value = null;
      }
    }

    const list = (Array.isArray(issues) ? issues : [])
      .filter(i => i && (i.summary || i.detail))
      .sort((a, b) => {
        const at = a.shareTime instanceof Date && !isNaN(a.shareTime.getTime()) ? a.shareTime.getTime() : 0;
        const bt = b.shareTime instanceof Date && !isNaN(b.shareTime.getTime()) ? b.shareTime.getTime() : 0;
        return bt - at;
      });

    // 데이터가 기본 영역(3~500, 최대 498행)을 초과하면 행 추가
    const maxDataRows = clearEndRow - 3 + 1;
    if (list.length > maxDataRows) {
      const needInsert = list.length - maxDataRows;
      const styleRow = 3;
      for (let i = 0; i < needInsert; i++) {
        sh.insertRow(clearEndRow + 1, []);
        const dest = sh.getRow(clearEndRow + 1);
        const src = sh.getRow(styleRow);
        try {
          if (src.height != null) dest.height = src.height;
        } catch (_) {}
        for (let c = 1; c <= 12; c++) {
          try {
            const sc = src.getCell(c);
            const dc = dest.getCell(c);
            if (sc.style) dc.style = JSON.parse(JSON.stringify(sc.style || {}));
          } catch (_) {}
        }
      }
    }

    // row2의 건수 셀(대략 13열)에 기입
    try {
      sh.getRow(2).getCell(13).value = `${list.length}건`;
    } catch (_) {}

    let r = 3;
    list.forEach((i) => {
      const title = String(i.summary || i.detail || '').trim();
      const datePart = i.date ? i.date.slice(5).replace('-', '/') : '';
      const timePart = i.shareTime instanceof Date && !isNaN(i.shareTime.getTime())
        ? i.shareTime.toISOString().slice(11, 16)
        : '';
      const method = String(i.shareMethod || '').trim();
      const line = `${title} - (${datePart}${timePart ? ' ' + timePart : ''}${method ? ' / ' + method : ''})`;
      const row = sh.getRow(r);
      for (let c = 1; c <= 12; c++) row.getCell(c).value = line;
      r++;
    });

    // 빈 칸 제거: 데이터 마지막 행 이후 구간 완전 클리어
    const lastDataRow = r - 1;
    for (let rowNum = lastDataRow + 1; rowNum <= Math.max(clearEndRow, lastDataRow + 100); rowNum++) {
      try {
        const row = sh.getRow(rowNum);
        for (let c = 1; c <= 12; c++) {
          const cell = row.getCell(c);
          if (!cell.formula) cell.value = null;
        }
      } catch (_) {
        break;
      }
    }
  }

  /**
   * Mobile 전용: '주요 이슈 건수 증감' 시트 채우기
   * - VoC 대분류 기준으로 전주/금주 건수 및 비율을 계산하여 랭킹 테이블 작성
   */
  fillMobileIssueCountDeltaSheet(templateWb, ctx) {
    const { projectId, currentVoc, prevVoc } = ctx;
    const sh = templateWb.getWorksheet('주요 이슈 건수 증감');
    if (!sh) return;

    const pid = projectId === undefined ? PROJECT_IDS.MOBILE : projectId;

    // 랭킹 테이블 헤더는 7행, 데이터는 8행부터로 가정
    const startRow = 8;
    const maxR = 60;
    const clearEndRow = 120;

    // 기존 데이터 클리어(8~) — 템플릿 샘플 데이터 완전 제거 (1~10열, 10열=전 주 대비 %)
    for (let r = startRow; r <= clearEndRow; r++) {
      const row = sh.getRow(r);
      for (let c = 1; c <= 10; c++) {
        const cell = row.getCell(c);
        if (cell.formula) continue;
        cell.value = null;
      }
    }

    const countBy = (arr) => {
      const m = new Map();
      (Array.isArray(arr) ? arr : []).forEach(v => {
        const n = normalizeCategoryForTemplate(pid, v.categoryGroup, v.category);
        const cg = String(n.categoryGroup || '').trim() || '기타';
        m.set(cg, (m.get(cg) || 0) + 1);
      });
      return m;
    };
    const prevMap = countBy(prevVoc);
    const currMap = countBy(currentVoc);
    const prevTotal = (Array.isArray(prevVoc) ? prevVoc.length : 0) || 1;
    const currTotal = (Array.isArray(currentVoc) ? currentVoc.length : 0) || 1;

    const keys = Array.from(new Set([...prevMap.keys(), ...currMap.keys()]));
    const rows = keys.map(k => {
      const prev = prevMap.get(k) || 0;
      const curr = currMap.get(k) || 0;
      const prevRate = prev / prevTotal;
      const currRate = curr / currTotal;
      const diff = curr - prev;
      const diffRate = currRate - prevRate;
      return { k, prev, curr, prevRate, currRate, diff, diffRate };
    }).sort((a,b)=>b.curr - a.curr);

    // 상단 총 취합량 영역(행5의 숫자 위치) 업데이트 시도
    try {
      // 템플릿 기준: C5(전 주 취합량), F5(금주 취합량) 위치에 숫자가 있음
      sh.getRow(5).getCell(3).value = prevTotal;
      sh.getRow(5).getCell(6).value = currTotal;
    } catch (_) {}

    // 템플릿 표준 라벨 → 시트 제목/요약 (이미 정규화된 대분류명 사용)
    const labelMap = (cg) => {
      const s = String(cg || '').trim();
      if (!s) return { title: '기타', summary: '기타 관련 이용자 동향' };
      if (s.includes('유료')) return { title: '유료 아이템', summary: '유료 아이템과 관련된 이용자 동향' };
      if (s.includes('게임 플레이') || s.includes('컨텐츠')) return { title: '게임 플레이 관련 문의', summary: '게임 플레이 및 콘텐츠 관련 이용자 동향' };
      if (s.includes('버그')) return { title: '버그', summary: '버그와 관련된 이용자 동향' };
      if (s.includes('서버') || s.includes('접속')) return { title: '서버/접속', summary: '서버 및 클라이언트 관련 불안정 동향' };
      if (s.includes('커뮤니티') || s.includes('이스포츠')) return { title: '커뮤니티/이스포츠', summary: '커뮤니티 및 이스포츠 관련 이용자 동향' };
      if (s.includes('불법')) return { title: '불법프로그램', summary: '불법프로그램 관련 이용자 동향' };
      if (s.includes('비매너')) return { title: '비매너 행위', summary: '비매너 행위 관련 이용자 동향' };
      if (s.includes('이용 제한')) return { title: '이용 제한 조치', summary: '이용 제한 조치 관련 이용자 동향' };
      if (s.includes('타게임')) return { title: '타게임', summary: '타게임 관련 이용자 동향' };
      return { title: s, summary: `${s} 관련 이용자 동향` };
    };

    rows.slice(0, 20).forEach((it, idx) => {
      const r = startRow + idx;
      const row = sh.getRow(r);
      const mapped = labelMap(it.k);
      row.getCell(1).value = idx + 1;
      row.getCell(2).value = mapped.title;
      row.getCell(3).value = mapped.summary;
      row.getCell(4).value = it.prev;
      row.getCell(5).value = it.curr;
      row.getCell(6).value = it.prevRate;
      row.getCell(7).value = it.currRate;
      row.getCell(8).value = it.diff;
      row.getCell(9).value = it.diffRate;
      row.getCell(10).value = it.diffRate;
    });
  }

  /**
   * Mobile 전용: 메인 주차 시트 상단의 '성향별 주간 동향 수' / '이슈 별 동향 수' 블록 갱신
   * - 템플릿 기준 위치:
   *   - 성향별: N5~Q6 (14~17열) [주차라벨, 긍정, 부정, 중립]
   *   - 이슈별: S5~AA6 (19~27열) [주차라벨, 게임플레이, 유료, 버그, 서버, 이용제한, 불법, 비매너, 커뮤니티/이스포츠]
   */
  fillMobileMainCountBlocks(templateWb, ctx) {
    const { currentLabel, prevLabel, projectId, currentVoc, prevVoc } = ctx;
    const sh = templateWb.getWorksheet(currentLabel) || templateWb.worksheets.find(s => s.name.includes('주차'));
    if (!sh) return;

    const pid = projectId === undefined ? PROJECT_IDS.MOBILE : projectId;

    const countSent = (arr) => {
      const list = Array.isArray(arr) ? arr : [];
      return {
        pos: list.filter(v => String(v.sentiment || '').includes('긍정')).length,
        neg: list.filter(v => String(v.sentiment || '').includes('부정')).length,
        neu: list.filter(v => String(v.sentiment || '').includes('중립')).length,
      };
    };

    const bucket = (v) => {
      const n = normalizeCategoryForTemplate(pid, v.categoryGroup, v.category);
      const cg = String(n.categoryGroup || '').trim();
      const c = String(n.category || '').trim();
      const type = String(v.type || '').trim();
      if (cg.includes('유료')) return 'paid';
      if (cg.includes('버그')) return 'bug';
      if (cg.includes('서버') || cg.includes('접속') || c.includes('접속')) return 'server';
      if (cg.includes('불법')) return 'cheat';
      if (c.includes('비매너') || cg.includes('비매너')) return 'manner';
      if (cg.includes('커뮤니티') || cg.includes('이스포츠')) return 'community';
      if (c.includes('이용 제한') || c.includes('이용제한') || type.includes('제재') || c.includes('정지')) return 'restriction';
      return 'gameplay';
    };

    const countIssues = (arr) => {
      const out = {
        gameplay: 0,
        paid: 0,
        bug: 0,
        server: 0,
        restriction: 0,
        cheat: 0,
        manner: 0,
        community: 0,
      };
      (Array.isArray(arr) ? arr : []).forEach(v => {
        const k = bucket(v);
        out[k] = (out[k] || 0) + 1;
      });
      return out;
    };

    const prevS = countSent(prevVoc);
    const currS = countSent(currentVoc);
    const prevI = countIssues(prevVoc);
    const currI = countIssues(currentVoc);

    // 라벨(“1월 3째주” 형태) 그대로 유지하되, 값만 갱신하는 것이 안전.
    // 다만 라벨이 비어있으면 prevLabel/currentLabel을 넣는다.
    const ensureLabel = (row, col, fallback) => {
      const cell = sh.getRow(row).getCell(col);
      const cur = String(cell.value || '').trim();
      if (!cur) cell.value = fallback;
    };

    // prev row (5)
    ensureLabel(5, 14, prevLabel);
    sh.getRow(5).getCell(15).value = prevS.pos;
    sh.getRow(5).getCell(16).value = prevS.neg;
    sh.getRow(5).getCell(17).value = prevS.neu;

    ensureLabel(5, 19, prevLabel);
    sh.getRow(5).getCell(20).value = prevI.gameplay;
    sh.getRow(5).getCell(21).value = prevI.paid;
    sh.getRow(5).getCell(22).value = prevI.bug;
    sh.getRow(5).getCell(23).value = prevI.server;
    sh.getRow(5).getCell(24).value = prevI.restriction;
    sh.getRow(5).getCell(25).value = prevI.cheat;
    sh.getRow(5).getCell(26).value = prevI.manner;
    sh.getRow(5).getCell(27).value = prevI.community;

    // current row (6)
    ensureLabel(6, 14, currentLabel);
    sh.getRow(6).getCell(15).value = currS.pos;
    sh.getRow(6).getCell(16).value = currS.neg;
    sh.getRow(6).getCell(17).value = currS.neu;

    ensureLabel(6, 19, currentLabel);
    sh.getRow(6).getCell(20).value = currI.gameplay;
    sh.getRow(6).getCell(21).value = currI.paid;
    sh.getRow(6).getCell(22).value = currI.bug;
    sh.getRow(6).getCell(23).value = currI.server;
    sh.getRow(6).getCell(24).value = currI.restriction;
    sh.getRow(6).getCell(25).value = currI.cheat;
    sh.getRow(6).getCell(26).value = currI.manner;
    sh.getRow(6).getCell(27).value = currI.community;
  }

  /**
   * 메인 SUMMARY 시트에 기본 정보 채우기 (날짜 범위, 플랫폼)
   */
  async fillMainSummarySheetFromDailyExcel(templateWb, ctx) {
    const { startDate, endDate, projectId, mainSheetName } = ctx;
    const mainSheet = templateWb.getWorksheet(mainSheetName) || templateWb.worksheets[0];
    if (!mainSheet) {
      throw new Error('템플릿에서 메인 SUMMARY 시트를 찾을 수 없습니다.');
    }

    // B2: 시트 주차와 동일하게 "N월 M주차 (start일~end일)" 형식으로 헤더 반영 (startDate 기반 동적 주차)
    try {
      const d1 = new Date(startDate + 'T00:00:00.000Z');
      const d2 = new Date(endDate + 'T00:00:00.000Z');
      const dayRange = `${d1.getUTCDate()}일~${d2.getUTCDate()}일`;
      const b2Value = `${mainSheetName} (${dayRange})`;
      mainSheet.getCell(2, 2).value = String(b2Value);
    } catch (e) {
      mainSheet.getCell(2, 2).value = String(mainSheetName || '');
    }

    // 날짜 범위 패턴 검사용 정규식 (YYYY-MM-DD, YYYY.MM.DD 둘 다)
    const dateRangePattern = /^\d{4}[-.]\d{2}[-.]\d{2}\s*~\s*\d{4}[-.]\d{2}[-.]\d{2}/;

    // 템플릿의 L4 작성자 이름을 미리 읽어서 보존 (날짜 범위로 덮어써지기 전에)
    const l4Cell = mainSheet.getCell('L4');
    const l4Value = l4Cell.value;
    let authorName = '';
    if (l4Value) {
      if (typeof l4Value === 'object' && Array.isArray(l4Value.richText)) {
        authorName = l4Value.richText.map(t => t.text || '').join('').trim();
      } else if (typeof l4Value === 'string') {
        authorName = l4Value.trim();
      } else {
        authorName = String(l4Value).trim();
      }
      // 날짜 범위 패턴이면 무시 (이전에 잘못 덮어써진 경우)
      if (dateRangePattern.test(authorName)) {
        authorName = '';
      }
    }

    // 취합 날짜: 템플릿 4행에서 "데이터 취합 기간" 라벨 다음 셀에만 표기(셀 위치 오류 방지)
    const toTemplateDate = (d) => {
      const s = String(d).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '.');
      return s;
    };
    const dateRangeText = `${toTemplateDate(startDate)} ~ ${toTemplateDate(endDate)}`;
    const getCellText = (cell) => {
      if (!cell || cell.value == null) return '';
      const v = cell.value;
      if (typeof v === 'string') return v.trim();
      if (typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map(t => t.text || '').join('').trim();
      if (typeof v === 'object' && v.text != null) return String(v.text).trim();
      return String(v).trim();
    };
    let dateCol = 8; // 기본 H열
    for (let col = 2; col <= 14; col++) {
      const cell = mainSheet.getCell(4, col);
      const text = getCellText(cell);
      if (text.includes('데이터') && text.includes('취합')) {
        dateCol = col + 1; // 라벨 다음 열이 날짜 셀(라벨이 여러 셀에 걸쳐 있으면 가장 오른쪽+1)
      }
    }
    const dateCell = mainSheet.getCell(4, dateCol);
    if (dateCell.isMerged && dateCell.master) {
      mainSheet.getCell(dateCell.master.address).value = dateRangeText;
    } else {
      dateCell.value = dateRangeText;
    }

    // K4="작성자" 명시적으로 설정 (템플릿에서 읽은 값이 날짜 범위로 덮어써졌을 수 있으므로 항상 확인)
    const k4Cell = mainSheet.getCell('K4');
    const k4Value = k4Cell.value;
    let k4Text = '';
    if (k4Value) {
      if (typeof k4Value === 'object' && Array.isArray(k4Value.richText)) {
        k4Text = k4Value.richText.map(t => t.text || '').join('').trim();
      } else {
        k4Text = String(k4Value).trim();
      }
    }
    // K4가 "작성자"가 아니거나 날짜 범위로 덮어써진 경우 명시적으로 "작성자"로 설정
    if (!k4Text || !k4Text.includes('작성자') || dateRangePattern.test(k4Text)) {
      k4Cell.value = '작성자';
    }

    // L4 작성자 이름 복원 (템플릿에서 읽은 값 또는 빈 문자열)
    l4Cell.value = authorName || '';

    const targetText = projectId === PROJECT_IDS.MOBILE ? 'PUBG MOBILE' : 'PUBG PC';
    ['C4', 'D4'].forEach(addr => {
      mainSheet.getCell(addr).value = targetText;
    });

    // Mobile 전용: 빈 템플릿에서 비워진 ■ 섹션 제목 복원 (5,8,10,12행 B열)
    if (projectId === PROJECT_IDS.MOBILE) {
      const sectionTitles = [
        [5, '■ 주간 동향 수'],
        [8, '■ 주간 부정 동향 요약'],
        [10, '■ 주간 긍정 동향 요약'],
        [12, '■ 커뮤니티 주요 동향'],
      ];
      sectionTitles.forEach(([row, text]) => {
        try {
          const cell = mainSheet.getCell(row, 2);
          if (!cell.formula) cell.value = text;
        } catch (_) {}
      });
    }
  }

  /**
   * 메인 SUMMARY 시트의 텍스트 블록 채우기 (전반적인 동향, 최고/최악의 동향)
   */
  async fillMainSummaryTextBlocksFromDailyExcel(templateWb, ctx) {
    const { startDate, endDate, voc, issues, mainSheetName, projectId } = ctx;
    const sh = templateWb.getWorksheet(mainSheetName);
    if (!sh) return;

    // 1단계: 데이터 준비
    const negVoc = voc.filter(v => String(v.sentiment || '').includes('부정'));
    const posVoc = voc.filter(v => String(v.sentiment || '').includes('긍정'));

    // MOBILE 전용: 템플릿 내용 참고하여 AI(LLM)가 부정/긍정 요약 본문 작성 (PC 로직과 완전 분리)
    // - 8행: "■ 주간 부정 동향 요약" (헤더) → 9행에 요약 본문
    // - 10행: "■ 주간 긍정 동향 요약" (헤더) → 11행에 요약 본문
    // - 13행: "부정 동향 (N건)" 카운트
    if (projectId === PROJECT_IDS.MOBILE) {
      const { negSummary, posSummary } = await this.summarizeMobileNegPos({
        startDate,
        endDate,
        negVoc,
        posVoc
      });

      // 9행(B9): 주간 부정 동향 요약 본문 (AI 또는 폴백)
      const negCell = sh.getCell(9, 2);
      if (!negCell.formula) {
        negCell.value = String(negSummary);
        negCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        negCell.font = { name: '맑은 고딕', size: 10 };
      }

      // 11행(B11): 주간 긍정 동향 요약 본문 (AI 또는 폴백)
      const posCell = sh.getCell(11, 2);
      if (!posCell.formula) {
        posCell.value = String(posSummary);
        posCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        posCell.font = { name: '맑은 고딕', size: 10 };
      }

      // 13행(B13): 부정 동향 카운트 텍스트
      const negCountCell = sh.getCell(13, 2);
      if (!negCountCell.formula) {
        negCountCell.value = `부정 동향 (${negVoc.length}건)`;
      }

      return;
    }

    // 전반적인 동향: 3~5문장 전문 문어체 요약
    const overall = await this.summarizeWeeklySentiment({
      startDate,
      endDate,
      negVoc,
      posVoc
    });

    // 금주 최고의/최악의 동향: ISSUE 기반 "주요 동향 리스트" 우선 생성
    const { bestLines, worstLines } = this.buildKeyTrendsFromIssuesOrVoc(issues, voc);

    // 여러 줄을 하나의 텍스트 문자열로 합치기 (RichText가 아닌 일반 String으로 강제 변환)
    const bestText = String(bestLines.join('\n'));
    const worstText = String(worstLines.join('\n'));

    // 2단계: 클리어 로직 - 셀의 value와 스타일만 초기화 (병합 설정은 유지)
    // 6행: 전반적인 동향
    this.clearRangeForMerge(sh, 6, 6, 2, 16);
    
    // 8-11행: 최고의 동향 (병합 셀)
    this.clearRangeForMerge(sh, 8, 11, 2, 16);
    
    // 13-23행: 최악의 동향 (병합 셀)
    this.clearRangeForMerge(sh, 13, 23, 2, 16);

    // 3단계: 병합 셀 구조 복구 (데이터 기입 직전)
    this.safelyMergeCells(sh, 'B8:P11'); // 최고의 동향
    this.safelyMergeCells(sh, 'B13:P23'); // 최악의 동향
    // 병합된 전체 범위의 모든 셀에 테두리 스타일 적용 (테두리 누락 방지)
    this.applyBorderToRange(sh, 'B8:P11');
    this.applyBorderToRange(sh, 'B13:P23');

    // 4단계: 전반적인 동향 데이터 기입 (6행)
    const overallCell = sh.getCell(6, 2);
    if (!overallCell.formula) {
      overallCell.value = String(overall);
      overallCell.font = { name: '맑은 고딕', size: 10 };
      overallCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    }

    // 5단계: Master Cell에만 데이터 기입 (B8, B13 — 텍스트 블록, RichText 충돌 방지)
    // cell.value는 반드시 String() 처리, alignment: wrapText + vertical: 'top' 강제
    const bestMasterCell = sh.getCell(8, 2); // B8
    if (!bestMasterCell.formula) {
      bestMasterCell.value = String(bestText);
      bestMasterCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      bestMasterCell.font = { name: '맑은 고딕', size: 10 };
    }

    const worstMasterCell = sh.getCell(13, 2); // B13
    if (!worstMasterCell.formula) {
      worstMasterCell.value = String(worstText);
      worstMasterCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      worstMasterCell.font = { name: '맑은 고딕', size: 10 };
    }
  }

  /**
   * 메인 SUMMARY 시트의 인게임 동향 테이블 채우기
   * - 데이터 수 증감 시 자동 대응: 행 수가 줄면 채운 뒤 나머지 영역 클리어, 늘면 필요 시 행 삽입 후 채움
   */
  async fillMainIngameTrendTableFromDailyExcel(templateWb, ctx) {
    const { startDate, endDate, voc, mainSheetName, projectId } = ctx;
    const sh = templateWb.getWorksheet(mainSheetName);
    if (!sh) return;

    // 템플릿에서 섹션 헤더 행 동적으로 찾기 (■로 시작하는 행)
    const sectionHeaderRows = new Set();
    const headerRows = new Set();
    
    // PC와 Mobile의 시작 행이 다름
    const SEARCH_START_ROW = projectId === PROJECT_IDS.MOBILE ? 10 : 20;
    const TEMPLATE_CLEAR_END_ROW = 500;
    // PC: 동향 리스트는 데이터에 따라 유동 레이아웃 — 이 행 이상은 전부 클리어 후 데이터로만 채움 (고정 섹션 행 미보존)
    const PC_TREND_LIST_START_ROW = 24;
    const DATA_START_ROW = projectId === PROJECT_IDS.MOBILE ? 15 : PC_TREND_LIST_START_ROW; // PC: 24행부터 동향 블록 전체
    const STYLE_SOURCE_ROW = projectId === PROJECT_IDS.MOBILE ? 15 : 26; // 행 삽입 시 스타일 복사 소스

    for (let r = SEARCH_START_ROW; r <= 200; r++) {
      const row = sh.getRow(r);
      const bValue = String(row.getCell(2).value || '').trim();
      // PC: 동향 리스트 구간(24행~)은 보존하지 않음 → 레이아웃을 데이터에 맞춰 유동 생성
      const isInPcTrendArea = projectId === PROJECT_IDS.PC && r >= PC_TREND_LIST_START_ROW;
      if (isInPcTrendArea) continue;

      if (bValue.includes('■')) {
        sectionHeaderRows.add(r);
        const nextRow = sh.getRow(r + 1);
        const nextBValue = String(nextRow.getCell(2).value || '').trim();
        if (nextBValue.includes('분류') || nextBValue.includes('플랫폼') || nextBValue.includes('동향')) {
          headerRows.add(r + 1);
        }
      }
      if (bValue.includes('분류') || bValue.includes('플랫폼') || bValue.includes('주제')) {
        headerRows.add(r);
      }
      if (projectId === PROJECT_IDS.MOBILE && /동향.*\d+건/.test(bValue)) {
        headerRows.add(r);
      }
    }

    const preservedRows = new Set([...sectionHeaderRows, ...headerRows]);
    
    // --- Mobile/PC 공통: 데이터량이 템플릿 고정 영역(기본 200행)을 넘을 때 행 확장 ---
    // 기존 구현은 26~200행을 전제로 하드코딩되어 있어, 데이터가 늘면 일부가 잘릴 수 있음.
    // 안전하게 200행 아래(201행)에 필요한 만큼 행을 삽입하여, 템플릿 아래 영역(다른 섹션/서식)을 보존한다.
    const MAX_ROWS_TO_FILL = 500; // 과도한 확장 방지(필요 시 상향 가능)

    const copyRowStyles = (srcRowNumber, destRowNumber) => {
      const src = sh.getRow(srcRowNumber);
      const dest = sh.getRow(destRowNumber);
      // 높이/스타일(행 단위)
      try {
        if (src.height != null) dest.height = src.height;
      } catch (e) {
        // ignore
      }
      // B~P (2~16) 셀 스타일 복사 (참조 공유 방지 — 스타일 객체 독립화)
      for (let c = 2; c <= 16; c++) {
        const sCell = src.getCell(c);
        const dCell = dest.getCell(c);
        copyCellStyleIndependently(dCell, sCell);
        if (sCell.numFmt) dCell.numFmt = sCell.numFmt;
      }
    };

    // 기존 데이터 클리어 (26행부터, 단 섹션 헤더는 보존)
    // 데이터 수 증감 시 자동 대응: 먼저 영역 클리어 → 필요 시 행 삽입 → 채움 → 채운 행 이후 잔여 영역 클리어
    const plannedFillCount = Math.min(Array.isArray(voc) ? voc.length : 0, MAX_ROWS_TO_FILL);
    // PC: 섹션 제목·헤더 행 + 주제 구분 행(【 주제: ... 】)까지 반영해 행 수 추정
    const extraRowsPc = projectId === PROJECT_IDS.PC
      ? (PC_TREND_SECTION_ORDER.length * 2) + plannedFillCount + 80
      : 20;
    const plannedLastRow = DATA_START_ROW + plannedFillCount + (projectId === PROJECT_IDS.PC ? extraRowsPc : 20);
    if (plannedLastRow > TEMPLATE_CLEAR_END_ROW) {
      const need = plannedLastRow - TEMPLATE_CLEAR_END_ROW;
      for (let i = 0; i < need; i++) {
        sh.insertRow(TEMPLATE_CLEAR_END_ROW + 1, []);
        copyRowStyles(STYLE_SOURCE_ROW, TEMPLATE_CLEAR_END_ROW + 1);
      }
    }

    const clearEndRow = Math.max(TEMPLATE_CLEAR_END_ROW, plannedLastRow);
    const clearCellValue = (cell) => {
      if (!cell || cell.formula) return;
      const target = (cell.isMerged && cell.master) ? cell.master : cell;
      if (target && !target.formula) target.value = null;
    };
    for (let r = DATA_START_ROW; r <= clearEndRow; r++) {
      if (preservedRows.has(r)) continue;
      const row = sh.getRow(r);
      for (let c = 1; c <= 16; c++) clearCellValue(row.getCell(c));
    }
    // 201행~ 구간 추가 클리어 (템플릿 잔여 데이터 절대 방지)
    for (let r = 201; r <= clearEndRow; r++) {
      if (preservedRows.has(r)) continue;
      const row = sh.getRow(r);
      for (let c = 1; c <= 16; c++) clearCellValue(row.getCell(c));
    }

    // 클리어 직후 병합 구조 적용 — 예상 채움 구간만 (과도한 병합으로 파일 손상 방지)
    if (projectId === PROJECT_IDS.PC) {
      const preMergeEnd = Math.min(DATA_START_ROW + 200, clearEndRow);
      for (let r = DATA_START_ROW; r <= preMergeEnd; r++) {
        if (preservedRows.has(r)) continue;
        const dCell = sh.getRow(r).getCell(4);
        const fCell = sh.getRow(r).getCell(6);
        if (!dCell.isMerged) {
          try { sh.mergeCells(r, 4, r, 5); } catch (e) { /* 무시 */ }
        }
        if (!fCell.isMerged) {
          try { sh.mergeCells(r, 6, r, 15); } catch (e) { /* 무시 */ }
        }
      }
    }

    // VoC 데이터 정렬 및 중복 제거
    const uniqueVoc = [];
    const seen = new Set();
    
    (Array.isArray(voc) ? voc : []).forEach(v => {
      const key = `${v.date}|${(v.content || '').substring(0, 80)}|${v.source}|${v.categoryGroup}|${v.category}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueVoc.push(v);
      }
    });
    
    // 템플릿 정렬 기준: 대분류 → 중분류 → 날짜(최신순)
    uniqueVoc.sort((a, b) => {
      const na = normalizeCategoryForTemplate(projectId, a.categoryGroup, a.category);
      const nb = normalizeCategoryForTemplate(projectId, b.categoryGroup, b.category);
      const cg = (na.categoryGroup || '').localeCompare(nb.categoryGroup || '');
      if (cg !== 0) return cg;
      const cat = (na.category || '').localeCompare(nb.category || '');
      if (cat !== 0) return cat;
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB - dateA;
    });
    
    logger.debug(`[WeeklyReport] fillMainIngameTrendTableFromDailyExcel: uniqueVoc count=${uniqueVoc.length}, projectId=${projectId}, DATA_START_ROW=${DATA_START_ROW}, preservedRows=${Array.from(preservedRows).sort((a,b)=>a-b).join(',')}`);
    
    const norm = (s) => (s ? String(s).trim() : '');
    const truncate = (s, max = 200) => {
      if (!s) return '';
      const t = String(s);
      return t.length > max ? `${t.slice(0, max)}…` : t;
    };
    // 주제 필드에 VoC 본문이 잘못 들어온 경우(구분 행/주제 열에 문장이 헤더처럼 노출되는 문제) 방지
    const MAX_CATEGORY_LABEL_LENGTH = 30;
    const sanitizeCategoryLabel = (categoryStr) => {
      const s = norm(categoryStr);
      if (!s) return '-';
      if (s.length > MAX_CATEGORY_LABEL_LENGTH) return '기타';
      return s;
    };

    // PC와 Mobile 템플릿 구조가 다름:
    // - PC: 개별 VoC 항목 나열 (B=분류, C=플랫폼, D=주제, E=주제, F=설명)
    // - Mobile: 집계 형식 (B=대분류+건수, C=중분류+건수)
    let currentRow = DATA_START_ROW; // 분기 전에 초기화 (분기 내부에서 재선언 금지)
    
    if (projectId === PROJECT_IDS.MOBILE) {
      // Mobile: 집계 형식으로 채우기 (템플릿 표준 분류로 정규화)
      // 템플릿 구조: B열=대분류+건수 (예: "게임 플레이 관련 문의 (34건)"), C열=중분류+건수 (예: "클래식 (7건)")
      const groupMap = new Map();
      
      uniqueVoc.forEach(v => {
        const n = normalizeCategoryForTemplate(projectId, v.categoryGroup, v.category);
        const cg = norm(n.categoryGroup) || '기타 동향';
        const c = norm(n.category) || '기타';
        const key = `${cg}|||${c}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            categoryGroup: cg,
            category: c,
            count: 0
          });
        }
        const g = groupMap.get(key);
        g.count += 1;
      });
      
      // count 기준 내림차순 정렬 (상위 그룹 우선)
      const groups = Array.from(groupMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_ROWS_TO_FILL);
      
      // Mobile 데이터 채우기
      // 템플릿 기준: "대분류 | 중분류" 헤더 다음 행부터 데이터가 시작되며,
      // DATA_START_ROW는 위에서 projectId에 따라 계산됨 (Mobile: 15)
      currentRow = DATA_START_ROW;
      groups.forEach(g => {
        // 보존할 행(섹션 헤더, 헤더 행)을 건너뛰기
        while (preservedRows.has(currentRow)) {
          currentRow++;
        }
        
        const row = sh.getRow(currentRow);
        const setCellValue = (col, value) => {
          const cell = row.getCell(col);
          if (cell.formula) {
            // 수식이 있으면 보존
            return;
          }
          cell.value = value != null ? String(value) : '';
        };
        
        // B열: 대분류 + 총 건수
        const baseTitle = g.categoryGroup;
        const hasCountSuffix = /\(\d+건\)/.test(baseTitle);
        const bTitle = hasCountSuffix ? baseTitle : `${baseTitle} (${g.count}건)`;
        setCellValue(2, bTitle);
        
        // C열: 중분류 + 건수
        const cBase = g.category;
        const cHasCount = /\(\d+건\)/.test(cBase);
        const cTitle = cHasCount ? cBase : `${cBase} (${g.count}건)`;
        setCellValue(3, cTitle);
        
        currentRow++;
      });
    } else {
      // PC: 동향 리스트 레이아웃을 데이터에 맞춰 유동 생성 (고정 템플릿 섹션 행 없음)
      // 시작 행부터 모든 섹션을 제목+헤더+데이터 순으로 연속 기록
      const ingameStartRow = PC_TREND_LIST_START_ROW;

      // VoC를 섹션별로 분리 (assignPcTrendSection: 분류·주제 기준)
      const sectionBuckets = {};
      PC_TREND_SECTION_ORDER.forEach(s => { sectionBuckets[s.key] = []; });
      uniqueVoc.forEach(v => {
        const n = normalizeCategoryForTemplate(projectId, v.categoryGroup, v.category);
        const key = assignPcTrendSection(n.categoryGroup, n.category);
        if (sectionBuckets[key]) {
          sectionBuckets[key].push({ ...v, categoryGroup: n.categoryGroup, category: n.category });
        }
      });
      // 섹션 내 정렬: 주제 → 날짜(최신순)
      PC_TREND_SECTION_ORDER.forEach(s => {
        sectionBuckets[s.key].sort((a, b) => {
          const ca = (a.category || '').localeCompare(b.category || '');
          if (ca !== 0) return ca;
          return new Date(b.date) - new Date(a.date);
        });
      });

      currentRow = ingameStartRow;
      let lastWrittenRow = ingameStartRow;
      const updateTracker = (rowNum) => { lastWrittenRow = Math.max(lastWrittenRow, rowNum); };

      // 동향 테이블 스타일: 폰트·정렬만 적용 (배경색 미적용 — 템플릿 fill 복사 시 오류 방지)
      const TREND_STYLE = {
        font: { size: 10, underline: false },
        alignment: { vertical: 'top', wrapText: true }
      };
      const applyTrendStyle = (cell) => {
        if (!cell || cell.formula) return;
        try {
          if (cell.style) {
            if (TREND_STYLE.font) cell.style.font = { ...cell.style.font, ...TREND_STYLE.font };
            if (TREND_STYLE.alignment) cell.style.alignment = { ...cell.style.alignment, ...TREND_STYLE.alignment };
          } else {
            cell.style = { ...TREND_STYLE };
          }
        } catch (e) { /* ignore */ }
      };

      // 전체 동향을 동일한 스타일로: 맨 위 헤더 1행만 두고, 중간에 구분 행(섹션/주제)으로만 구분
      while (preservedRows.has(currentRow)) currentRow++;
      const headerRow = sh.getRow(currentRow);
      [2, 3, 4].forEach(col => {
        const c = headerRow.getCell(col);
        if (!c.formula) { c.value = col === 2 ? '분류' : col === 3 ? '플랫폼' : '주제'; applyTrendStyle(c); }
      });
      currentRow++;

      const writeDataRow = (v) => {
        while (preservedRows.has(currentRow)) currentRow++;
        const row = sh.getRow(currentRow);
        const setCellValue = (col, value) => {
          const cell = row.getCell(col);
          if (cell.formula) return;
          if (cell.isMerged && cell.master && cell.address !== cell.master.address) return;
          cell.value = value != null ? String(value) : '';
          applyTrendStyle(cell);
          updateTracker(currentRow);
        };
        setCellValue(2, norm(v.categoryGroup) || '-');
        setCellValue(3, norm(v.platform) || norm(v.source) || 'Steam');
        const dCell = row.getCell(4);
        const fCell = row.getCell(6);
        if (!dCell.isMerged) { try { sh.mergeCells(currentRow, 4, currentRow, 5); } catch (e) { /* ignore */ } }
        if (!fCell.isMerged) { try { sh.mergeCells(currentRow, 6, currentRow, 15); } catch (e) { /* ignore */ } }
        const dMaster = dCell.isMerged && dCell.master ? dCell.master : dCell;
        if (!dMaster.formula) { dMaster.value = sanitizeCategoryLabel(v.category); applyTrendStyle(dMaster); updateTracker(currentRow); }
        const fMaster = fCell.isMerged && fCell.master ? fCell.master : fCell;
        if (!fMaster.formula) { fMaster.value = truncate(norm(v.content), 200); applyTrendStyle(fMaster); updateTracker(currentRow); }
        const links = Array.isArray(v.postUrls) ? v.postUrls : [];
        if (links.length > 0) {
          const link = links[0];
          const pCell = row.getCell(16);
          if (!pCell.formula && (!pCell.isMerged || (pCell.master && pCell.address === pCell.master.address))) {
            const url = typeof link === 'object' && link !== null && link.url != null ? link.url : String(link);
            pCell.value = { text: '1', hyperlink: url };
            applyTrendStyle(pCell);
            updateTracker(currentRow);
          }
        }
        currentRow++;
      };

      PC_TREND_SECTION_ORDER.forEach((section) => {
        const list = sectionBuckets[section.key] || [];
        if (list.length === 0) return;
        while (preservedRows.has(currentRow)) currentRow++;
        const sepRow = sh.getRow(currentRow);
        const sepB = sepRow.getCell(2);
        if (!sepB.formula) { sepB.value = section.title; applyTrendStyle(sepB); }
        currentRow++;
        list.slice(0, MAX_ROWS_TO_FILL).forEach((v, idx) => {
          const currentTopic = sanitizeCategoryLabel(v.category);
          const prevTopic = idx > 0 ? sanitizeCategoryLabel(list[idx - 1].category) : null;
          const needSep = idx === 0 || (prevTopic != null && currentTopic !== prevTopic);
          if (needSep) {
            while (preservedRows.has(currentRow)) currentRow++;
            const topicSepRow = sh.getRow(currentRow);
            const topicSepB = topicSepRow.getCell(2);
            if (!topicSepB.formula) { topicSepB.value = `【 주제: ${currentTopic} 】`; applyTrendStyle(topicSepB); }
            currentRow++;
          }
          writeDataRow(v);
        });
      });

      // 최종 안전장치: 물리적 전수 스캔으로 동향 섹션 전체 병합 구조 재확인
      const actualRowCount = sh.actualRowCount || sh.rowCount || 0;
      let actualLastDataRow = lastWrittenRow;
      const scanStartRow = Math.max(actualRowCount, actualLastDataRow + 100, 500);
      
      logger.debug(`[Merge] Finding actual last data row: scanStartRow=${scanStartRow}, ingameStartRow=${ingameStartRow}, lastWrittenRow=${lastWrittenRow}`);
      
      for (let r = scanStartRow; r >= ingameStartRow; r--) {
        if (preservedRows.has(r)) continue;
        
        const checkRow = sh.getRow(r);
        // 데이터 정규화: 모든 값에 .toString().trim() 적용
        const bVal = String(checkRow.getCell(2).value || '').toString().trim();
        const cVal = String(checkRow.getCell(3).value || '').toString().trim();
        const dVal = String(checkRow.getCell(4).value || '').toString().trim();
        const fVal = String(checkRow.getCell(6).value || '').toString().trim();
        
        if (bVal || cVal || dVal || fVal) {
          actualLastDataRow = r;
          break;
        }
      }
      
      // 병합은 실제 데이터가 있는 행 근처까지만 적용 (과도한 병합으로 파일 손상 방지)
      const mergeEndRow = Math.min(actualLastDataRow + 15, ingameStartRow + 500);
      let lastProcessedRow = ingameStartRow;
      let mergeCount = 0;

      for (let r = ingameStartRow; r <= mergeEndRow; r++) {
        if (preservedRows.has(r)) continue;
        const rowObj = sh.getRow(r);
        const dCell = rowObj.getCell(4);
        const fCell = rowObj.getCell(6);
        lastProcessedRow = r;
        if (!dCell.isMerged) {
          try {
            sh.mergeCells(r, 4, r, 5);
            mergeCount++;
          } catch (e) {
            // 병합 충돌 시 무시
          }
        }
        if (!fCell.isMerged) {
          try {
            sh.mergeCells(r, 6, r, 15);
            mergeCount++;
          } catch (e) {
            // 병합 충돌 시 무시
          }
        }
      }
    }
    
    // 채운 행 이후의 나머지 행도 확실히 클리어 (템플릿 샘플 데이터 제거)
    
    // 마지막 섹션 이후의 나머지 행도 클리어 (템플릿 잔여 데이터 제거, A열 포함)
    for (let r = currentRow; r <= clearEndRow; r++) {
      if (preservedRows.has(r)) continue;
      const row = sh.getRow(r);
      for (let c = 1; c <= 16; c++) {
        const cell = row.getCell(c);
        if (!cell.formula) cell.value = null;
      }
    }
    // clearEndRow 이후 ~ 확장 구간까지 추가 클리어 (데이터 감소 시 잔여 데이터 제거)
    const safeClearEnd = Math.max(600, clearEndRow);
    for (let r = clearEndRow + 1; r <= safeClearEnd; r++) {
      if (preservedRows.has(r)) continue;
      try {
        const row = sh.getRow(r);
        for (let c = 1; c <= 16; c++) {
          const cell = row.getCell(c);
          if (!cell.formula) cell.value = null;
        }
      } catch (_) {
        break;
      }
    }
  }

  /**
   * 커뮤니티 일반 시트 채우기
   */
  async fillCommunityGeneralSheetFromDailyExcel(templateWb, ctx) {
    const { startDate, endDate, voc, projectId } = ctx;
    // PC: "커뮤니티 일반", Mobile: "VoC" 시트 사용
    const sheetName = projectId === PROJECT_IDS.MOBILE ? 'VoC' : '커뮤니티 일반';
    const sh = templateWb.getWorksheet(sheetName);
    if (!sh) {
      logger.warn(`시트를 찾을 수 없습니다: ${sheetName}`);
      return;
    }

    // Sheet4 수식 손상 방지: 공유 수식 제거 및 수식 보존 강화
    // I열(9번 열)의 수식은 절대 건드리지 않도록 주의
    try {
      // 공유 수식 제거 (수식 손상 방지)
      sh.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          // I열(9번 열)은 수식이 있으므로 완전히 보존
          if (cell.col === 9 && cell.formula) {
            // I열 수식은 건드리지 않음
            return;
          }
          
          if (cell.sharedFormula) {
            // 공유 수식을 일반 수식으로 변환 시도
            try {
              if (cell.formula) {
                // 이미 일반 수식이 있으면 공유 수식만 제거
                cell.sharedFormula = null;
                delete cell.sharedFormula;
              } else {
                // 공유 수식만 있고 일반 수식이 없으면 제거
                cell.sharedFormula = null;
                delete cell.sharedFormula;
                // 값도 null로 설정하여 손상 방지
                if (!cell.value || typeof cell.value === 'object') {
                  cell.value = null;
                }
              }
              
              // 내부 모델에서도 제거
              if (sh.model && sh.model.rows && sh.model.rows[row.number]) {
                const modelRow = sh.model.rows[row.number];
                if (modelRow.cells && modelRow.cells[cell.col]) {
                  const modelCell = modelRow.cells[cell.col];
                  if (modelCell.sharedFormula) {
                    delete modelCell.sharedFormula;
                    modelCell.sharedFormula = null;
                  }
                }
              }
            } catch (e) {
              // 개별 셀 처리 오류는 무시
            }
          }
        });
      });
    } catch (e) {
      logger.warn('커뮤니티 일반 시트 공유 수식 제거 오류:', e.message);
    }

    // 기존 데이터 클리어 (6행부터)
    // I열(중요도)은 수식이 있으므로 보존
    for (let r = 6; r <= 1000; r++) {
      for (let c = 2; c <= 23; c++) {
        const cell = sh.getCell(r, c);
        // 수식이 있는 셀은 완전히 건드리지 않음 (값, 스타일 모두 보존)
        if (cell.formula) {
          continue; // 수식이 있는 셀은 완전히 스킵
        }
        if (c === 9) continue; // I열(중요도)은 수식 보존을 위해 건너뛰기
        // 수식이 없는 셀만 클리어
        cell.value = null;
      }
    }

    // VoC 데이터 필터링 및 정렬 (엄격한 날짜 필터링 + 템플릿 정렬 기준: 대분류 → 중분류 → 날짜 최신순)
    const pid = projectId === undefined ? PROJECT_IDS.PC : projectId;
    const filteredVoc = (voc || [])
      .filter(v => {
        if (!v || !v.date) return false;
        const vDateStr = typeof v.date === 'string'
          ? v.date
          : (v.date instanceof Date ? v.date.toISOString().split('T')[0] : String(v.date));
        return vDateStr >= startDate && vDateStr <= endDate;
      })
      .sort((a, b) => {
        const na = normalizeCategoryForTemplate(pid, a.categoryGroup, a.category);
        const nb = normalizeCategoryForTemplate(pid, b.categoryGroup, b.category);
        const cg = (na.categoryGroup || '').localeCompare(nb.categoryGroup || '');
        if (cg !== 0) return cg;
        const cat = (na.category || '').localeCompare(nb.category || '');
        if (cat !== 0) return cat;
        const dateA = typeof a.date === 'string' ? a.date : (a.date instanceof Date ? a.date.toISOString().split('T')[0] : String(a.date));
        const dateB = typeof b.date === 'string' ? b.date : (b.date instanceof Date ? b.date.toISOString().split('T')[0] : String(b.date));
        return dateB.localeCompare(dateA);
      });

    // 데이터가 기본 영역(6~1000, 최대 995행)을 초과하면 행 추가
    const communityClearEnd = 1000;
    const maxDataRows = communityClearEnd - 6 + 1;
    if (filteredVoc.length > maxDataRows) {
      const needInsert = filteredVoc.length - maxDataRows;
      const styleRow = 6;
      for (let i = 0; i < needInsert; i++) {
        sh.insertRow(communityClearEnd + 1, []);
        const dest = sh.getRow(communityClearEnd + 1);
        const src = sh.getRow(styleRow);
        try {
          if (src.height != null) dest.height = src.height;
        } catch (_) {}
        for (let c = 2; c <= 23; c++) {
          if (c === 9) continue;
          try {
            const sc = src.getCell(c);
            const dc = dest.getCell(c);
            if (!dc.formula) copyCellStyleIndependently(dc, sc);
          } catch (_) {}
        }
      }
    }

    if (voc && voc.length > 0) {
      logger.info(`커뮤니티 일반 시트 필터링: 원본 ${voc.length}개 -> 필터링 후 ${filteredVoc.length}개 (기간: ${startDate} ~ ${endDate})`);
    }

    // 데이터 채우기 (6행부터, 템플릿 표준 라벨로 대/중분류 기입)
    let currentRow = 6;
    filteredVoc.forEach(v => {
      const norm = normalizeCategoryForTemplate(pid, v.categoryGroup, v.category);
      const row = sh.getRow(currentRow);
      const setCellValue = (col, value) => {
        const cell = row.getCell(col);
        if (!cell.formula) {
          cell.value = value || '';
        }
      };

      setCellValue(2, v.date);           // 날짜
      setCellValue(3, v.platform);       // 플랫폼
      setCellValue(4, v.source);         // 출처
      setCellValue(5, norm.categoryGroup);// 대분류 (템플릿 표준)
      setCellValue(6, norm.category);    // 중분류 (템플릿 표준)
      setCellValue(7, v.type);        // 종류
      setCellValue(8, v.sentiment);   // 성향
      // I열(9번, 중요도)은 수식이 있으므로 건드리지 않음 (템플릿 수식 유지)
      setCellValue(10, v.content);    // 내용
      setCellValue(11, v.judgement);  // 판단/확인사항
      setCellValue(12, v.workType);   // 근무
      setCellValue(13, v.note);       // 비고

      // 링크: 템플릿 형식 "1" 표시 + 하이퍼링크
      const toLinkValue = (item) => {
        if (item == null) return null;
        const url = typeof item === 'object' && item.url != null ? item.url : String(item);
        return { text: '1', hyperlink: url };
      };
      const link0 = v.postUrls[0];
      if (link0 != null) {
        const cell14 = row.getCell(14);
        if (!cell14.formula) cell14.value = toLinkValue(link0);
      }
      for (let i = 0; i < Math.min(10, (v.postUrls.length || 0) - 1); i++) {
        const item = v.postUrls[i + 1];
        if (item == null) continue;
        const cell = row.getCell(15 + i);
        if (!cell.formula) cell.value = toLinkValue(item);
      }

      currentRow++;
    });

    // 빈 칸 제거: 데이터 마지막 행 이후 구간 완전 클리어 (템플릿 데이터 절대 잔존 방지)
    const lastDataRow = currentRow - 1;
    for (let r = lastDataRow + 1; r <= Math.max(communityClearEnd, lastDataRow + 100); r++) {
      try {
        for (let c = 2; c <= 23; c++) {
          if (c === 9) continue;
          const cell = sh.getCell(r, c);
          if (!cell.formula) cell.value = null;
        }
      } catch (_) {
        break;
      }
    }
  }

  /**
   * 안티치트_INDEX 시트 채우기
   */
  async fillAntiCheatIndexSheetFromDailyExcel(templateWb, ctx) {
    const { startDate, endDate, voc, dailyWorkbook } = ctx;
    const sh = templateWb.getWorksheet('안티치트_INDEX');
    if (!sh) return;
    
    // 안티치트_INDEX 시트의 공유 수식 제거 (D15 오류 방지)
    // ExcelJS가 공유 수식을 제대로 처리하지 못하므로 모든 공유 수식 제거
    try {
      sh.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (cell.sharedFormula) {
            // 공유 수식 제거 (일반 수식은 유지)
            cell.sharedFormula = null;
          }
        });
      });
    } catch (e) {
      this.logger.warn('안티치트_INDEX 공유 수식 제거 오류:', e.message);
    }

    // 불법 프로그램 관련 VoC 필터링
    const antiVoc = voc.filter(v =>
      String(v.categoryGroup || '').includes('불법')
    );

    // 제보 게시판: 종류에 '제보' 포함 AND 대분류에 '불법' 포함
    const reportVoc = antiVoc.filter(v =>
      String(v.type || '').includes('제보')
    );
    const antiReportSum = reportVoc.length;

    // 커뮤니티 일반: 대분류에 '불법' 포함 AND 종류에 '제보' 미포함
    const communityVoc = antiVoc.filter(v =>
      !String(v.type || '').includes('제보')
    );
    const antiCommunitySum = communityVoc.length;

    // 일일 통계 채우기 (7~13행): 날짜별로 데이터 채우기
    // 템플릿 구조: B열=날짜, C열=제보, D열=커뮤니티
    const start = new Date(startDate + 'T00:00:00.000Z');
    const end = new Date(endDate + 'T23:59:59.999Z');
    const dailyStats = new Map(); // 날짜별 통계
    
    // 날짜별로 그룹화
    antiVoc.forEach(v => {
      if (!v.date) return; // 날짜가 없으면 스킵
      let vDate;
      try {
        vDate = v.date instanceof Date ? v.date : new Date(v.date);
        if (isNaN(vDate.getTime())) return; // 유효하지 않은 날짜면 스킵
      } catch (e) {
        return; // 날짜 파싱 실패 시 스킵
      }
      
      if (vDate >= start && vDate <= end) {
        const dateKey = vDate.toISOString().split('T')[0]; // YYYY-MM-DD
        if (!dailyStats.has(dateKey)) {
          dailyStats.set(dateKey, { report: 0, community: 0 });
        }
        const stats = dailyStats.get(dateKey);
        if (String(v.type || '').includes('제보')) {
          stats.report++;
        } else {
          stats.community++;
        }
      }
    });
    
    // 날짜 순서대로 정렬하여 채우기 (7행부터)
    const sortedDates = Array.from(dailyStats.keys()).sort();
    let dailyRow = 7;
    sortedDates.forEach(dateKey => {
      const stats = dailyStats.get(dateKey);
      const dateObj = new Date(dateKey + 'T00:00:00.000Z');
      sh.getCell(dailyRow, 2).value = dateObj; // B열: 날짜
      sh.getCell(dailyRow, 3).value = stats.report; // C열: 제보
      sh.getCell(dailyRow, 4).value = stats.community; // D열: 커뮤니티
      dailyRow++;
    });
    
    // 나머지 행 클리어 (데이터가 없는 날짜)
    // 주의: R14, R15는 수식이 있으므로 건드리지 않음
    for (let r = dailyRow; r <= 13; r++) {
      const cellB = sh.getCell(r, 2);
      const cellC = sh.getCell(r, 3);
      const cellD = sh.getCell(r, 4);
      // 수식이 있는 셀은 건드리지 않음
      if (!cellB.formula) cellB.value = null;
      if (!cellC.formula) cellC.value = null;
      if (!cellD.formula) cellD.value = null;
    }

    // 최근 5주 통계 계산
    // 주의: dailyWorkbook에서 과거 주차 데이터를 파싱하는 것은 시간이 오래 걸릴 수 있으므로
    // 현재는 현재 주차 데이터만 사용하고, 나머지는 0으로 채움
    const weeks = this.getLastNWeeksByMonday(endDate, 5);
    const weeklyCounts = [];

    for (const w of weeks) {
      const isCurrentWeek = w.start === startDate && w.end === endDate;
      
      if (isCurrentWeek) {
        // 현재 주차는 이미 파싱된 antiVoc 사용
        const weekReport = antiVoc.filter(v =>
          String(v.type || '').includes('제보')
        ).length;
        const weekCommunity = antiVoc.filter(v =>
          !String(v.type || '').includes('제보')
        ).length;

        weeklyCounts.push({
          label: this.formatKoreanWeekLabelByMonday(w.start),
          report: weekReport,
          community: weekCommunity
        });
      } else {
        // 다른 주차는 0으로 채움 (성능상 이유로 과거 데이터 파싱 생략)
        weeklyCounts.push({
          label: this.formatKoreanWeekLabelByMonday(w.start),
          report: 0,
          community: 0
        });
      }
    }

    // 최근 5주 통계 채우기 (15~20행): 템플릿 구조에 맞춰 A열=주차, B열=제보, C열=커뮤니티
    weeklyCounts.forEach((w, idx) => {
      const row = 15 + idx; // R15-20
      sh.getCell(row, 1).value = w.label; // A열: 주차
      sh.getCell(row, 2).value = w.report; // B열: 제보
      sh.getCell(row, 3).value = w.community; // C열: 커뮤니티
    });
    
    // 나머지 행 클리어
    for (let r = 15 + weeklyCounts.length; r <= 20; r++) {
      sh.getCell(r, 1).value = null;
      sh.getCell(r, 2).value = null;
      sh.getCell(r, 3).value = null;
    }
    
    // 수식 직접 주입 (Post-Process): 데이터를 모두 채운 후 D15 셀에 수식을 명시적으로 할당 (공유 수식 미사용)
    // D15: SUM(D8:D14)
    try {
      const d15Cell = sh.getCell(15, 4); // D15
      d15Cell.value = null;
      if (d15Cell.sharedFormula) {
        delete d15Cell.sharedFormula;
        d15Cell.sharedFormula = null;
      }
      d15Cell.value = {
        formula: 'SUM(D8:D14)',
        result: 0
      };
      
      // C14도 수식 직접 주입 (AVERAGE)
      const c14Cell = sh.getCell(14, 3); // C14
      c14Cell.value = null;
      if (c14Cell.sharedFormula) {
        delete c14Cell.sharedFormula;
        c14Cell.sharedFormula = null;
      }
      c14Cell.value = {
        formula: 'AVERAGE(C7:C13)',
        result: 0
      };
      
      // D14도 수식 직접 주입 (AVERAGE)
      const d14Cell = sh.getCell(14, 4); // D14
      d14Cell.value = null;
      if (d14Cell.sharedFormula) {
        delete d14Cell.sharedFormula;
        d14Cell.sharedFormula = null;
      }
      d14Cell.value = {
        formula: 'AVERAGE(D7:D13)',
        result: 0
      };
      
      // C15도 수식 직접 주입 (SUM)
      const c15Cell = sh.getCell(15, 3); // C15
      c15Cell.value = null;
      if (c15Cell.sharedFormula) {
        delete c15Cell.sharedFormula;
        c15Cell.sharedFormula = null;
      }
      c15Cell.value = {
        formula: 'SUM(C7:C13)',
        result: 0
      };
    } catch (e) {
      this.logger.warn('안티치트_INDEX 수식 직접 주입 오류:', e.message);
    }
  }

  /**
   * 제보게시판 시트 채우기
   */
  async fillReportBoardSheetFromDailyExcel(templateWb, ctx) {
    const { startDate, endDate, voc } = ctx;
    const sh = templateWb.getWorksheet('제보게시판');
    if (!sh) return;

    // 기존 데이터 클리어
    for (let r = 6; r <= 1000; r++) {
      for (let c = 2; c <= 12; c++) {
        const cell = sh.getCell(r, c);
        cell.value = null;
      }
    }

    // 제보 필터링: 대분류에 '불법' 포함
    // 제보게시판은 '제보'라는 type이 아니라 불법 프로그램 관련 VoC 중에서
    // 내용이나 다른 필드로 제보를 식별해야 할 수 있음
    // 일단 불법 프로그램 관련 VoC를 모두 제보로 간주 (템플릿 구조 확인 필요)
    const reports = voc.filter(v =>
      String(v.categoryGroup || '').includes('불법')
    );

    // 데이터 채우기 (6행부터)
    let currentRow = 6;
    reports.forEach(v => {
      const row = sh.getRow(currentRow);
      row.getCell(2).value = this.normalizeReportSourceLabel(v.source || ''); // 출처
      row.getCell(3).value = this.formatKoreanDotDate(v.date); // 날짜
      row.getCell(4).value = this.inferReportReason(v); // 제보 사유
      // 링크: 템플릿 형식 "1" 표시 + 하이퍼링크
      const link0 = v.postUrls[0];
      if (link0 != null) {
        const url = typeof link0 === 'object' && link0.url != null ? link0.url : String(link0);
        row.getCell(5).value = { text: '1', hyperlink: url };
      } else {
        row.getCell(5).value = '';
      }
      row.getCell(6).value = this.extractIgn(v); // IGN
      row.getCell(7).value = v.content || ''; // 내용
      row.getCell(8).value = v.judgement || ''; // 판단/확인사항
      row.getCell(9).value = v.workType || ''; // 근무
      row.getCell(10).value = v.note || ''; // 비고
      currentRow++;
    });
  }

  /**
   * 헬퍼: 반복 행 범위 채우기 (병합 셀용)
   */
  /**
   * 셀을 완전히 초기화하는 Hard Reset 함수
   * RichText 객체를 제거하고 값만 초기화 (병합 상태는 유지)
   */
  hardResetCell(cell) {
    // 수식이 있는 경우는 보존
    if (cell.formula) {
      return;
    }
    
    // RichText 객체가 value에 있는 경우 처리
    if (cell.value && typeof cell.value === 'object' && cell.value.richText) {
      cell.value = undefined;
    }
    
    // RichText 관련 속성 제거
    if (cell.richText) {
      cell.richText = null;
    }
    
    // 값 제거 (병합 상태는 유지)
    cell.value = undefined;
  }

  /**
   * 병합 유지형 클리어 및 준비 함수
   * 병합 상태를 유지하면서 셀을 클리어하고 준비
   */
  clearAndPrepareCell(cell, sheet, row, col) {
    // 수식이 있는 경우는 보존
    if (cell.formula) {
      return;
    }
    
    // RichText 객체 제거
    if (cell.value && typeof cell.value === 'object' && cell.value.richText) {
      cell.value = undefined;
    }
    if (cell.richText) {
      cell.richText = null;
    }
    
    // 값 제거 (병합 상태는 유지)
    cell.value = undefined;
  }

  /**
   * 특정 범위의 셀들을 완전히 클리어하는 함수
   * RichText 객체와 모든 스타일 정보를 제거
   */
  clearRange(sheet, rowStart, rowEnd, colStart, colEnd, preserveFormulas = true) {
    for (let r = rowStart; r <= rowEnd; r++) {
      const row = sheet.getRow(r);
      for (let c = colStart; c <= colEnd; c++) {
        const cell = row.getCell(c);
        // 수식이 있는 경우 보존 여부 확인
        if (preserveFormulas && cell.formula) {
          continue;
        }
        // Hard Reset 적용
        this.hardResetCell(cell);
      }
    }
  }

  /**
   * 안전한 병합 함수: 기존 병합을 해제하고 다시 병합
   * @param {ExcelJS.Worksheet} sheet - 시트 객체
   * @param {string} range - 병합할 범위 (예: 'B8:P11')
   */
  safelyMergeCells(sheet, range) {
    try {
      // 범위 파싱 (예: 'B8:P11' -> start='B8', end='P11')
      const [startAddr, endAddr] = range.split(':');
      const startCell = sheet.getCell(startAddr);
      const endCell = sheet.getCell(endAddr);
      
      // 범위 내의 모든 셀 확인하여 병합 해제
      const startRow = startCell.row;
      const startCol = startCell.col;
      const endRow = endCell.row;
      const endCol = endCell.col;
      
      // 기존 병합 해제 시도
      try {
        sheet.unmergeCells(range);
      } catch (e) {
        // 병합이 없거나 다른 오류인 경우 무시
      }
      
      // 범위 내의 모든 셀을 확인하여 개별 병합 해제
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          try {
            const cell = sheet.getCell(r, c);
            // ExcelJS의 isMerged 속성 확인
            if (cell.isMerged) {
              try {
                // 개별 셀 주소로 병합 해제 시도
                const cellAddr = cell.address;
                sheet.unmergeCells(cellAddr);
              } catch (e) {
                // 해제 실패는 무시
              }
            }
          } catch (e) {
            // 개별 셀 처리 오류는 무시
          }
        }
      }
      
      // 최종적으로 병합 실행
      try {
        sheet.mergeCells(range);
      } catch (e) {
        // 이미 병합되어 있거나 다른 오류인 경우
        if (!e.message || !e.message.includes('already merged')) {
          this.logger.warn(`병합 셀 오류 (${range}):`, e.message || e);
        }
      }
    } catch (e) {
      this.logger.warn(`안전한 병합 처리 오류 (${range}):`, e.message || e);
    }
  }

  /**
   * 범위 내 모든 셀에 테두리 스타일 적용 (병합 영역 테두리 누락 방지)
   * @param {ExcelJS.Worksheet} sheet - 시트
   * @param {string} range - 범위 (예: 'B8:P11')
   */
  applyBorderToRange(sheet, range) {
    try {
      const [startAddr, endAddr] = range.split(':');
      const startCell = sheet.getCell(startAddr);
      const endCell = sheet.getCell(endAddr);
      const startRow = startCell.row;
      const startCol = startCell.col;
      const endRow = endCell.row;
      const endCol = endCell.col;
      const thin = { style: 'thin', color: { argb: 'FF000000' } };
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const cell = sheet.getCell(r, c);
          cell.border = { top: thin, left: thin, bottom: thin, right: thin };
        }
      }
    } catch (e) {
      this.logger.warn(`applyBorderToRange 오류 (${range}):`, e.message || e);
    }
  }

  /**
   * 병합 셀을 위한 클리어 함수: 셀의 value와 스타일만 초기화 (병합 설정 유지)
   */
  clearRangeForMerge(sheet, rowStart, rowEnd, colStart, colEnd) {
    for (let r = rowStart; r <= rowEnd; r++) {
      const row = sheet.getRow(r);
      for (let c = colStart; c <= colEnd; c++) {
        const cell = row.getCell(c);
        // 수식이 있는 경우 보존
        if (cell.formula) {
          continue;
        }
        // value만 초기화 (병합 상태/서식은 유지)
        // NOTE:
        // - PC 템플릿은 서식(특히 배경색)이 요구사항이므로 fill/font를 건드리면 안 됨
        // - 빈 객체(cell.fill = {})를 넣으면 Excel이 "solid + theme:undefined"처럼 해석해
        //   배경색이 바뀐 것으로 비교될 수 있음
        if (cell.value && typeof cell.value === 'object' && cell.value.richText) {
          cell.value = undefined;
        }
        if (cell.richText) {
          cell.richText = null;
        }
        cell.value = undefined;
      }
    }
  }

  fillRepeatingRowRange(sheet, rowStart, rowEnd, colStart, colEnd, value) {
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        const cell = sheet.getCell(r, c);
        // 수식이 있는 셀은 건드리지 않음
        if (!cell.formula) {
          // Hard Reset 적용
          this.hardResetCell(cell);
          // 새 값 설정
          cell.value = value;
        }
      }
    }
  }

  /**
   * 헬퍼: 시트 복제 (스타일 포함)
   */
  cloneWorksheet(workbook, sourceSheet, newName) {
    const newSheet = workbook.addWorksheet(newName);

    // 속성 복사
    newSheet.properties = JSON.parse(JSON.stringify(sourceSheet.properties || {}));

    // 페이지 설정 복사
    if (sourceSheet.pageSetup) {
      Object.assign(newSheet.pageSetup, sourceSheet.pageSetup);
    }

    // 컬럼 너비 및 스타일 복사
    sourceSheet.columns.forEach((col, idx) => {
      if (col.width) {
        newSheet.getColumn(idx + 1).width = col.width;
      }
      if (col.style) {
        newSheet.getColumn(idx + 1).style = JSON.parse(JSON.stringify(col.style));
      }
    });

    // 행 높이 및 셀 값/스타일 복사
    sourceSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const newRow = newSheet.getRow(rowNumber);
      if (row.height) {
        newRow.height = row.height;
      }

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const newCell = newRow.getCell(colNumber);
        // 공유 수식이 있으면 제거 (일반 수식만 복사)
        if (cell.sharedFormula && !cell.formula) {
          // 공유 수식만 있고 일반 수식이 없으면 건너뛰기
          return;
        }
        // 수식이 있으면 수식을 복사, 없으면 값 복사
        // ExcelJS에서 formula는 읽기 전용 속성일 수 있으므로 안전하게 처리
        if (cell.formula) {
          try {
            const formulaValue = cell.formula;
            if (formulaValue && typeof formulaValue === 'string') {
              newCell.formula = formulaValue;
            }
          } catch (e) {
            // formula 복사 실패 시 값만 복사
            newCell.value = cell.value;
          }
        } else {
          newCell.value = cell.value;
        }
        copyCellStyleIndependently(newCell, cell);
        if (cell.numFmt) {
          newCell.numFmt = cell.numFmt;
        }
      });
    });

    // 병합 셀 복사 (안전하게 처리)
    if (sourceSheet.model && sourceSheet.model.merges) {
      sourceSheet.model.merges.forEach(merge => {
        try {
          // 병합 범위를 문자열로 변환
          let mergeRange;
          if (typeof merge === 'string') {
            mergeRange = merge;
          } else if (merge.top !== undefined) {
            // ExcelJS 내부 형식: {top, left, bottom, right}
            const colStart = ExcelJS.utils.getExcelAlpha(merge.left);
            const colEnd = ExcelJS.utils.getExcelAlpha(merge.right);
            mergeRange = `${colStart}${merge.top + 1}:${colEnd}${merge.bottom + 1}`;
          } else {
            return; // 알 수 없는 형식은 스킵
          }
          
          // 병합 시도 (이미 병합되어 있으면 무시)
          try {
            newSheet.mergeCells(mergeRange);
          } catch (e) {
            // 이미 병합되어 있으면 무시
            if (!e.message.includes('already merged')) {
              this.logger.warn(`병합 셀 복사 오류 (${mergeRange}):`, e.message);
            }
          }
        } catch (e) {
          // 병합 처리 실패는 무시
          this.logger.warn('병합 셀 복사 중 오류:', e.message);
        }
      });
    }

    return newSheet;
  }

  /**
   * 헬퍼: 메인 주차 시트 이름 포맷팅 (예: "1월 4주차")
   */
  formatMainWeekSheetName(startDate) {
    const date = new Date(startDate + 'T00:00:00.000Z');
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    
    // 월요일 기준 주차 계산
    const dayOfWeek = date.getUTCDay();
    const offsetFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const week = Math.floor((day - 1 + offsetFromMon) / 7) + 1;
    
    return `${month}월 ${week}주차`;
  }

  /**
   * 헬퍼: 최근 N주 월요일 기준 주차 범위 계산
   */
  getLastNWeeksByMonday(endDate, n) {
    const end = new Date(endDate + 'T00:00:00.000Z');
    const weeks = [];

    for (let i = 0; i < n; i++) {
      const weekEnd = new Date(end);
      weekEnd.setUTCDate(weekEnd.getUTCDate() - (i * 7));
      
      const dayOfWeek = weekEnd.getUTCDay();
      const offsetFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      
      const weekStart = new Date(weekEnd);
      weekStart.setUTCDate(weekStart.getUTCDate() - 6 - offsetFromMon);
      
      weeks.unshift({
        start: weekStart.toISOString().split('T')[0],
        end: weekEnd.toISOString().split('T')[0]
      });
    }

    return weeks;
  }

  /**
   * 헬퍼: 한국어 주차 레이블 포맷팅 (예: "25년 1월 4주차")
   */
  formatKoreanWeekLabelByMonday(weekStartDate) {
    const date = new Date(weekStartDate + 'T00:00:00.000Z');
    const year = date.getUTCFullYear() % 100;
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    
    const dayOfWeek = date.getUTCDay();
    const offsetFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const week = Math.floor((day - 1 + offsetFromMon) / 7) + 1;
    
    return `${year}년 ${month}월 ${week}주차`;
  }

  /**
   * 헬퍼: 제보 출처 레이블 정규화
   */
  normalizeReportSourceLabel(source) {
    const s = String(source || '').trim().toLowerCase();
    if (s.includes('naver') || s.includes('네이버')) return '네이버 카페';
    if (s.includes('discord') || s.includes('디스코드')) return '디스코드';
    if (s.includes('reddit')) return 'Reddit';
    if (s.includes('steam')) return 'Steam';
    return source || '';
  }

  /**
   * 헬퍼: 한국어 점 구분 날짜 포맷팅 (예: "2025. 1. 27")
   */
  formatKoreanDotDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00.000Z');
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return `${year}. ${month}. ${day}`;
  }

  /**
   * 헬퍼: 제보 사유 추론
   */
  inferReportReason(voc) {
    if (String(voc.categoryGroup || '').includes('불법')) {
      return '불법 프로그램';
    }
    return voc.categoryGroup || '기타';
  }

  /**
   * 헬퍼: IGN 추출
   */
  extractIgn(voc) {
    const text = [
      voc.content || '',
      voc.judgement || '',
      voc.note || ''
    ].join(' ');

    // IGN 패턴 매칭 (예: "IGN: xxx", "아이디: xxx" 등)
    const patterns = [
      /IGN[:\s]+([^\s\n]+)/i,
      /아이디[:\s]+([^\s\n]+)/i,
      /닉네임[:\s]+([^\s\n]+)/i,
      /\[([^\]]+)\]/g
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return '';
  }
}

module.exports = new WeeklyReportService();
