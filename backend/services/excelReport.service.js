// Excel 일일 보고서 생성 서비스

const ExcelJS = require('exceljs');
const { query, queryOne } = require('../libs/db');
const logger = require('../utils/logger');

// DB 연결 확인
const { db } = require('../libs/db');
if (!db) {
  throw new Error('Database connection is not initialized. Check libs/db.js export.');
}

class ExcelReportService {
  /**
   * 일일 보고서 엑셀 파일 생성
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD 형식)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD 형식)
   * @param {number} projectId - 프로젝트 ID (선택)
   * @returns {Promise<Buffer>} 엑셀 파일 버퍼
   */
  async generateDailyReport(startDate, endDate, projectId = null) {
    try {
      // 디버깅: Prisma 모델 확인
      // 프로젝트 정보 로드 (reportConfig 포함)
      let project = null;
      let reportConfig = null;
      if (projectId) {
        try {
          project = queryOne(
            'SELECT id, name, reportConfig FROM Project WHERE id = ?',
            [projectId]
          );
          if (project && project.reportConfig) {
            try {
              reportConfig = typeof project.reportConfig === 'string' 
                ? JSON.parse(project.reportConfig) 
                : project.reportConfig;
            } catch (e) {
              logger.warn('[ExcelReportService] Failed to parse reportConfig', { error: e.message });
            }
          }
        } catch (error) {
          logger.warn('[ExcelReportService] Failed to load project', { projectId, error: error.message });
        }
      }

      // 통계 데이터 집계
      const summaryStats = await this.getSummaryStats(startDate, endDate, projectId);
      
      // 워크북 생성
      const workbook = new ExcelJS.Workbook();
      
      // 워크북 속성 설정
      workbook.creator = 'AIMGLOBAL';
      workbook.created = new Date();
      workbook.modified = new Date();
      
      // SUMMARY 시트 추가
      const summarySheet = workbook.addWorksheet('SUMMARY');
      
      // SUMMARY 시트 데이터 채우기
      this.setupSummarySheet(summarySheet, startDate, endDate, summaryStats, reportConfig);
      
      // VoC 시트 생성
      await this.createVoCSheet(workbook, startDate, endDate, projectId, reportConfig);
      
      // ISSUE 시트 생성
      await this.createIssueSheet(workbook, startDate, endDate, projectId, reportConfig);
      
      // Data 시트 생성
      await this.createDataSheet(workbook, startDate, endDate, projectId, reportConfig);
      
      // INDEX 시트 생성
      await this.createIndexSheet(workbook, startDate, endDate, projectId, reportConfig);
      
      // 게시물량 시트 생성
      await this.createVolumeSheet(workbook, startDate, endDate, projectId, reportConfig);
      
      // const issueData = await this.collectIssueData(startDate, endDate);
      // this.createIssueSheet(workbook, issueData);
      
      // const rawData = await this.collectRawData(startDate, endDate);
      // this.createDataSheet(workbook, rawData);
      
      // this.createIndexSheet(workbook);
      
      // const volumeData = await this.collectVolumeData(startDate, endDate);
      // this.createVolumeSheet(workbook, volumeData);
      
      // 엑셀 파일을 버퍼로 변환
      const buffer = await workbook.xlsx.writeBuffer();
      
      logger.info('Daily report Excel file generated', { startDate, endDate, bufferSize: buffer.length });
      
      return buffer;
    } catch (error) {
      logger.error('Failed to generate daily report Excel file', {
        error: error.message,
        stack: error.stack,
        startDate,
        endDate
      });
      throw error;
    }
  }

  /**
   * 통계 데이터 집계 (비공개 메서드)
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   * @param {number} projectId - 프로젝트 ID (선택)
   * @returns {Promise<Object>} 집계된 통계 데이터
   */
  async getSummaryStats(startDate, endDate, projectId = null) {
    try {
      // 날짜 범위 필터 (date 필드 사용 - 게시글 작성 날짜 기준)
      // date 필드는 YYYY-MM-DD 문자열이므로 문자열 비교 사용
      
      // 기간 내의 모든 이슈 조회 (카테고리 그룹, 카테고리, 날짜 정보 포함)
      // 보고서 제외된 이슈는 제외
      let sql = `SELECT i.*, cg.id as categoryGroup_id, cg.name as categoryGroup_name, cg.code as categoryGroup_code, cg.color as categoryGroup_color,
                 c.id as category_id, c.name as category_name
                 FROM ReportItemIssue i
                 LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
                 LEFT JOIN Category c ON i.categoryId = c.id
                 WHERE (i.excludedFromReport = 0 OR i.excludedFromReport IS NULL)`;
      const params = [];
      
      sql += ' AND i.date >= ?';
      params.push(startDate);
      sql += ' AND i.date <= ?';
      params.push(endDate);
      
      if (projectId) {
        sql += ' AND (i.projectId = ? OR i.projectId IS NULL)';
        params.push(projectId);
      }
      
      sql += ' ORDER BY i.date ASC';
      
      const issues = query(sql, params).map(issue => ({
        ...issue,
        categoryGroup: issue.categoryGroup_id ? {
          id: issue.categoryGroup_id,
          name: issue.categoryGroup_name,
          code: issue.categoryGroup_code,
          color: issue.categoryGroup_color
        } : null,
        category: issue.category_id ? {
          id: issue.category_id,
          name: issue.category_name
        } : null
      }));
      
      // 날짜별로 그룹화
      const dateGroups = {};
      
      issues.forEach(issue => {
        const date = issue.date || issue.createdAt.toISOString().split('T')[0];
        if (!dateGroups[date]) {
          dateGroups[date] = [];
        }
        dateGroups[date].push(issue);
      });
      
      // 날짜별 통계 계산
      const statsByDate = {};
      
      for (const [date, dateIssues] of Object.entries(dateGroups)) {
        // 총 취합량
        const totalCollection = dateIssues.length;
        
        // 대분류별 -> 유형별 카운트
        const categoryStats = {};
        
        // 성향별 -> 중요도별 카운트
        const sentimentStats = {
          '긍정': { '상': 0, '중': 0, '하': 0, '합계': 0 },
          '부정': { '상': 0, '중': 0, '하': 0, '합계': 0 },
          '중립': { '상': 0, '중': 0, '하': 0, '합계': 0 }
        };
        
        // 주요 동향 텍스트 (카테고리별로 severity가 높은 이슈의 summary)
        const majorTrends = {};
        
        dateIssues.forEach(issue => {
          // 대분류별 통계
          const categoryGroupName = issue.categoryGroup?.name || '미분류';
          if (!categoryStats[categoryGroupName]) {
            categoryStats[categoryGroupName] = {
              '의견': 0,
              '건의': 0,
              '문의': 0,
              '제보': 0
            };
          }
          
          // 유형 분류 (trend 필드 또는 category name 기반)
          // trend 필드가 있으면 사용, 없으면 category name의 키워드로 판단
          let issueType = '의견'; // 기본값
          if (issue.trend) {
            const trendLower = issue.trend.toLowerCase();
            if (trendLower.includes('건의') || trendLower.includes('제안')) {
              issueType = '건의';
            } else if (trendLower.includes('문의') || trendLower.includes('질문')) {
              issueType = '문의';
            } else if (trendLower.includes('제보') || trendLower.includes('신고')) {
              issueType = '제보';
            }
          } else if (issue.category?.name) {
            const categoryName = issue.category.name.toLowerCase();
            if (categoryName.includes('건의') || categoryName.includes('제안')) {
              issueType = '건의';
            } else if (categoryName.includes('문의') || categoryName.includes('질문')) {
              issueType = '문의';
            } else if (categoryName.includes('제보') || categoryName.includes('신고')) {
              issueType = '제보';
            }
          }
          
          categoryStats[categoryGroupName][issueType]++;
          
          // 성향별 통계
          const sentimentMap = {
            'pos': '긍정',
            'neg': '부정',
            'neu': '중립'
          };
          const sentiment = sentimentMap[issue.sentiment?.toLowerCase()] || '중립';
          
          // 중요도 매핑 (severity: 1=상, 2=중, 3=하)
          const severityMap = {
            1: '상',
            2: '중',
            3: '하'
          };
          const severity = severityMap[issue.severity] || '하';
          
          sentimentStats[sentiment][severity]++;
          sentimentStats[sentiment]['합계']++;
          
          // 주요 동향 텍스트 수집 (severity가 1 또는 2인 경우)
          if (issue.severity && issue.severity <= 2 && issue.summary) {
            if (!majorTrends[categoryGroupName]) {
              majorTrends[categoryGroupName] = [];
            }
            majorTrends[categoryGroupName].push({
              summary: issue.summary,
              severity: issue.severity,
              sentiment: sentiment
            });
          }
        });
        
        // 주요 동향 텍스트 정리 (각 카테고리별로 상위 severity만 유지, 최대 5개)
        const cleanedTrends = {};
        for (const [category, trends] of Object.entries(majorTrends)) {
          // severity 순으로 정렬 (낮을수록 높은 중요도)
          trends.sort((a, b) => a.severity - b.severity);
          cleanedTrends[category] = trends.slice(0, 5).map(t => t.summary).filter(Boolean);
        }
        
        statsByDate[date] = {
          totalCollection,
          categoryStats,
          sentimentStats,
          majorTrends: cleanedTrends
        };
      }
      
      return statsByDate;
    } catch (error) {
      logger.error('Failed to get summary stats', {
        error: error.message,
        stack: error.stack,
        startDate,
        endDate
      });
      throw error;
    }
  }

  /**
   * SUMMARY 시트 설정
   * @param {ExcelJS.Worksheet} sheet - 워크시트 객체
   * @param {string} startDate - 시작 날짜
   * @param {string} endDate - 종료 날짜
   * @param {Object} summaryStats - 집계된 통계 데이터
   */
  setupSummarySheet(sheet, startDate, endDate, summaryStats, reportConfig = null) {
    // 시트 기본 설정
    sheet.properties.defaultRowHeight = 20;
    
    // 날짜 목록 추출 및 정렬
    const dates = Object.keys(summaryStats).sort();
    
    if (dates.length === 0) {
      sheet.addRow(['데이터가 없습니다.']);
      return;
    }
    
    // 날짜별 컬럼 수 (의견, 건의, 문의, 제보 또는 상, 중, 하, 합계 = 4개)
    const columnsPerDate = 4;
    const totalDataColumns = dates.length * columnsPerDate;
    
    // 기본 스타일 정의
    const borderStyle = {
      style: 'thin',
      color: { argb: 'FF000000' }
    };
    
    const headerFill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    
    let currentRow = 1;
    
    // 1. 텍스트 요약 섹션 (표 위쪽)
    const summaryTexts = this.generateSummaryTexts(summaryStats, dates);
    if (summaryTexts.community.length > 0 || summaryTexts.negative.length > 0) {
      sheet.getCell(currentRow, 1).value = '커뮤니티 주요 동향';
      sheet.getCell(currentRow, 1).font = { bold: true };
      currentRow++;
      
      summaryTexts.community.forEach(text => {
        sheet.getCell(currentRow, 1).value = `- ${text}`;
        currentRow++;
      });
      
      if (summaryTexts.negative.length > 0) {
        currentRow++;
        sheet.getCell(currentRow, 1).value = '대분류별 부정 동향';
        sheet.getCell(currentRow, 1).font = { bold: true };
        currentRow++;
        
        summaryTexts.negative.forEach(text => {
          sheet.getCell(currentRow, 1).value = `- ${text}`;
          currentRow++;
        });
      }
      
      currentRow += 2; // 빈 행 2개
    }
    
    // 2. 표 제목
    sheet.getCell(currentRow, 1).value = '■구분별 업무 데이터';
    sheet.getCell(currentRow, 1).font = { bold: true, size: 14 };
    sheet.getCell(currentRow, 1).alignment = { horizontal: 'left', vertical: 'middle' };
    currentRow++;
    
    // 3. 기본 통계 행 (총게시물량, 댓글량, 취합량)
    // 헤더 행
    const basicHeaderRow = sheet.getRow(currentRow);
    basicHeaderRow.getCell(1).value = '';
    basicHeaderRow.getCell(1).fill = headerFill;
    basicHeaderRow.getCell(1).border = {
      top: borderStyle,
      left: borderStyle,
      bottom: borderStyle,
      right: borderStyle
    };
    basicHeaderRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    
    // 날짜별 헤더 병합 및 설정
    dates.forEach((date, dateIdx) => {
      const startCol = 2 + (dateIdx * columnsPerDate);
      const endCol = startCol + columnsPerDate - 1;
      
      // 날짜 헤더 병합
      sheet.mergeCells(currentRow, startCol, currentRow, endCol);
      const dateCell = sheet.getCell(currentRow, startCol);
      dateCell.value = date;
      dateCell.fill = headerFill;
      dateCell.border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      dateCell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    currentRow++;
    
    // 총게시물량, 댓글량, 취합량 행
    const basicStats = [
      { label: '총게시물량', getValue: () => 0 },
      { label: '댓글량', getValue: () => 0 },
      { label: '취합량', getValue: (date) => summaryStats[date].totalCollection }
    ];
    
    basicStats.forEach(stat => {
      const row = sheet.getRow(currentRow);
      row.getCell(1).value = stat.label;
      row.getCell(1).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      
      dates.forEach((date, dateIdx) => {
        const startCol = 2 + (dateIdx * columnsPerDate);
        const endCol = startCol + columnsPerDate - 1;
        const value = stat.getValue(date);
        
        // 값이 있는 첫 번째 셀에만 값을 넣고 나머지는 병합
        sheet.mergeCells(currentRow, startCol, currentRow, endCol);
        const cell = sheet.getCell(currentRow, startCol);
        cell.value = value;
        cell.numFmt = '#,##0';
        cell.border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      currentRow++;
    });
    
    currentRow++; // 빈 행
    
    // 4. 대분류별 섹션
    const categoryHeaderRow = sheet.getRow(currentRow);
    categoryHeaderRow.getCell(1).value = '대분류별';
    categoryHeaderRow.getCell(1).font = { bold: true };
    categoryHeaderRow.getCell(1).fill = headerFill;
    categoryHeaderRow.getCell(1).border = {
      top: borderStyle,
      left: borderStyle,
      bottom: borderStyle,
      right: borderStyle
    };
    categoryHeaderRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    
    // 대분류별 헤더 (의견, 건의, 문의, 제보)
    const typeLabels = ['의견', '건의', '문의', '제보'];
    dates.forEach((date, dateIdx) => {
      const startCol = 2 + (dateIdx * columnsPerDate);
      typeLabels.forEach((label, labelIdx) => {
        const col = startCol + labelIdx;
        const cell = categoryHeaderRow.getCell(col);
        cell.value = label;
        cell.fill = headerFill;
        cell.border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    });
    currentRow++;
    
    // 대분류별 데이터 행
    const categoryOrder = ['서버', '퍼포먼스', '불법프로그램', '컨텐츠', '버그', '이스포츠', '커뮤니티', '타게임'];
    const allCategories = new Set();
    dates.forEach(date => {
      Object.keys(summaryStats[date].categoryStats || {}).forEach(cat => allCategories.add(cat));
    });
    
    // 카테고리 순서대로 정렬 (정의된 순서 우선, 나머지는 알파벳 순)
    const sortedCategories = categoryOrder.filter(cat => allCategories.has(cat))
      .concat(Array.from(allCategories).filter(cat => !categoryOrder.includes(cat)).sort());
    
    sortedCategories.forEach(category => {
      const row = sheet.getRow(currentRow);
      row.getCell(1).value = category;
      row.getCell(1).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      
      dates.forEach((date, dateIdx) => {
        const stats = summaryStats[date];
        const catStats = stats.categoryStats[category] || { '의견': 0, '건의': 0, '문의': 0, '제보': 0 };
        const startCol = 2 + (dateIdx * columnsPerDate);
        
        typeLabels.forEach((label, labelIdx) => {
          const col = startCol + labelIdx;
          const cell = row.getCell(col);
          cell.value = catStats[label] || 0;
          cell.numFmt = '#,##0';
          cell.border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
      });
      currentRow++;
    });
    
    currentRow++; // 빈 행
    
    // 5. 성향별 섹션
    const sentimentHeaderRow = sheet.getRow(currentRow);
    sentimentHeaderRow.getCell(1).value = '성향별';
    sentimentHeaderRow.getCell(1).font = { bold: true };
    sentimentHeaderRow.getCell(1).fill = headerFill;
    sentimentHeaderRow.getCell(1).border = {
      top: borderStyle,
      left: borderStyle,
      bottom: borderStyle,
      right: borderStyle
    };
    sentimentHeaderRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    
    // 성향별 헤더 (상, 중, 하, 합계)
    const severityLabels = ['상', '중', '하', '합계'];
    dates.forEach((date, dateIdx) => {
      const startCol = 2 + (dateIdx * columnsPerDate);
      severityLabels.forEach((label, labelIdx) => {
        const col = startCol + labelIdx;
        const cell = sentimentHeaderRow.getCell(col);
        cell.value = label;
        cell.fill = headerFill;
        cell.border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    });
    currentRow++;
    
    // 성향별 데이터 행
    ['긍정', '부정', '중립'].forEach(sentiment => {
      const row = sheet.getRow(currentRow);
      row.getCell(1).value = sentiment;
      row.getCell(1).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      
      dates.forEach((date, dateIdx) => {
        const stats = summaryStats[date];
        const sentStats = stats.sentimentStats[sentiment] || { '상': 0, '중': 0, '하': 0, '합계': 0 };
        const startCol = 2 + (dateIdx * columnsPerDate);
        
        severityLabels.forEach((label, labelIdx) => {
          const col = startCol + labelIdx;
          const cell = row.getCell(col);
          cell.value = sentStats[label] || 0;
          cell.numFmt = '#,##0';
          cell.border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
      });
      currentRow++;
    });
    
    // 열 너비 설정
    sheet.getColumn(1).width = 20; // 라벨 열
    for (let i = 2; i <= 1 + totalDataColumns; i++) {
      sheet.getColumn(i).width = 12; // 데이터 열
    }
  }

  /**
   * 텍스트 요약 생성
   * @param {Object} summaryStats - 집계된 통계 데이터
   * @param {Array<string>} dates - 날짜 목록
   * @returns {Object} 커뮤니티 및 부정 동향 텍스트 배열
   */
  generateSummaryTexts(summaryStats, dates) {
    const communityTrends = [];
    const negativeTrends = [];
    
    dates.forEach(date => {
      const stats = summaryStats[date];
      
      // 커뮤니티 주요 동향
      if (stats.majorTrends && stats.majorTrends['커뮤니티']) {
        const trends = stats.majorTrends['커뮤니티'].slice(0, 3);
        if (trends.length > 0) {
          communityTrends.push(`${date}: ${trends.join(', ')}`);
        }
      }
      
      // 대분류별 부정 동향
      if (stats.sentimentStats && stats.sentimentStats['부정']) {
        const negativeTotal = stats.sentimentStats['부정']['합계'] || 0;
        if (negativeTotal > 0) {
          const categoryStats = stats.categoryStats || {};
          const negativeByCategory = Object.entries(categoryStats)
            .filter(([cat, stats]) => {
              const total = (stats['의견'] || 0) + (stats['건의'] || 0) + (stats['문의'] || 0) + (stats['제보'] || 0);
              return total > 0;
            })
            .map(([cat, stats]) => {
              const total = (stats['의견'] || 0) + (stats['건의'] || 0) + (stats['문의'] || 0) + (stats['제보'] || 0);
              return `${cat} ${total}건`;
            })
            .slice(0, 5);
          
          if (negativeByCategory.length > 0) {
            negativeTrends.push(`${date}: ${negativeByCategory.join(', ')}`);
          }
        }
      }
    });
    
    return {
      community: communityTrends,
      negative: negativeTrends
    };
  }

  /**
   * VoC 시트 생성
   * @param {ExcelJS.Workbook} workbook - 워크북 객체
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   */
  async createVoCSheet(workbook, startDate, endDate, projectId = null, reportConfig = null) {
    try {
      // 날짜 범위 필터 (date 필드 사용 - 게시글 작성 날짜 기준)
      const dateFilter = {
        date: {
          gte: startDate,
          lte: endDate
        }
      };
      
      // 프로젝트 필터 조건
      // 특정 프로젝트 선택 시: 해당 프로젝트 이슈 + 크롤링 이슈(projectId: null) 모두 포함
      const projectFilter = projectId 
        ? {
            OR: [
              { projectId: projectId },
              { projectId: null }  // 크롤링 이슈도 포함
            ]
          }
        : {};
      
      // 기간 내의 모든 이슈 조회 (trend 필드 포함)
      // 보고서 제외된 이슈는 제외
      let sql = `SELECT i.*, cg.id as categoryGroup_id, cg.name as categoryGroup_name, cg.code as categoryGroup_code, cg.color as categoryGroup_color,
                 c.id as category_id, c.name as category_name
                 FROM ReportItemIssue i
                 LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
                 LEFT JOIN Category c ON i.categoryId = c.id
                 WHERE (i.excludedFromReport = 0 OR i.excludedFromReport IS NULL)`;
      const params = [];
      
      sql += ' AND i.date >= ?';
      params.push(startDate);
      sql += ' AND i.date <= ?';
      params.push(endDate);
      
      if (projectId) {
        // 주간보고서에서는 특정 프로젝트만 필터링 (projectId IS NULL 제외)
        sql += ' AND i.projectId = ?';
        params.push(projectId);
      }
      
      sql += ' ORDER BY i.date ASC';
      
      const issues = query(sql, params).map(issue => ({
        ...issue,
        categoryGroup: issue.categoryGroup_id ? {
          id: issue.categoryGroup_id,
          name: issue.categoryGroup_name,
          code: issue.categoryGroup_code,
          color: issue.categoryGroup_color
        } : null,
        category: issue.category_id ? {
          id: issue.category_id,
          name: issue.category_name
        } : null
      }));
      
      if (issues.length === 0) {
        const vocSheet = workbook.addWorksheet('VoC');
        vocSheet.getCell(1, 1).value = '데이터가 없습니다.';
        return;
      }
      
      // 데이터 그룹화
      const groupedData = this.groupVoCIssues(issues);
      
      // 최대 링크 개수 계산 (최소 10개)
      const maxLinks = Math.max(...groupedData.map(group => group.links.length), 10);
      
      // 시트 생성
      const vocSheet = workbook.addWorksheet('VoC');
      
      // 스타일 정의
      const borderStyle = {
        style: 'thin',
        color: { argb: 'FF000000' }
      };
      
      const headerFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
      
      let currentRow = 1;
      
      // Row 1: "이용자 동향" 헤더
      const fixedColumns = 12; // 날짜, 플랫폼, 출처, 대분류, 중분류, 종류, 성향, 중요도, 내용, 판단/확인사항, 근무타입, 비고
      const totalColumns = fixedColumns + maxLinks + 1; // +1은 합계 컬럼
      vocSheet.mergeCells(currentRow, 1, currentRow, totalColumns);
      const titleCell = vocSheet.getCell(currentRow, 1);
      titleCell.value = '이용자 동향';
      titleCell.font = { bold: true, size: 14 };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = headerFill;
      currentRow += 3; // Row 2, 3은 빈 행
      
      // Row 4: 메인 헤더
      const headerRow = vocSheet.getRow(currentRow);
      const headerLabels = [
        '날짜', '플랫폼', '출처', '대분류', '중분류', '종류', '성향', '중요도', 
        '내용', '판단 / 확인 사항', '근무 타입', '비고'
      ];
      
      // 고정 헤더 설정
      headerLabels.forEach((label, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = label;
        cell.font = { bold: true };
        cell.fill = headerFill;
        cell.border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      
      // 동적 헤더 (링크 컬럼)
      for (let i = 1; i <= maxLinks; i++) {
        const cell = headerRow.getCell(fixedColumns + i);
        cell.value = i.toString();
        cell.font = { bold: true };
        cell.fill = headerFill;
        cell.border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      
      // 합계 헤더
      const totalHeaderCell = headerRow.getCell(fixedColumns + maxLinks + 1);
      totalHeaderCell.value = '합계';
      totalHeaderCell.font = { bold: true };
      totalHeaderCell.fill = headerFill;
      totalHeaderCell.border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      totalHeaderCell.alignment = { horizontal: 'center', vertical: 'middle' };
      
      currentRow++;
      
      // 데이터 행 작성
      groupedData.forEach(group => {
        const dataRow = vocSheet.getRow(currentRow);
        
        // 날짜
        dataRow.getCell(1).value = group.date;
        dataRow.getCell(1).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 플랫폼
        dataRow.getCell(2).value = group.platform;
        dataRow.getCell(2).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 출처
        dataRow.getCell(3).value = group.source;
        dataRow.getCell(3).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 대분류
        dataRow.getCell(4).value = group.categoryGroup || '';
        dataRow.getCell(4).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 중분류
        dataRow.getCell(5).value = group.category || '';
        dataRow.getCell(5).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 종류
        dataRow.getCell(6).value = group.type || '';
        dataRow.getCell(6).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(6).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 성향
        const sentimentMap = {
          'pos': '긍정',
          'neg': '부정',
          'neu': '중립'
        };
        dataRow.getCell(7).value = sentimentMap[group.sentiment?.toLowerCase()] || '중립';
        dataRow.getCell(7).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 중요도
        const importanceMap = {
          'HIGH': '상',
          'MEDIUM': '중',
          'LOW': '하'
        };
        dataRow.getCell(8).value = importanceMap[group.importance] || '중';
        dataRow.getCell(8).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 내용 (줄바꿈 적용) - AI가 요약한 summary 필드 사용 (summary가 있으면 항상 사용)
        // summary는 게시글 제목이므로 항상 우선 사용
        const contentValue = (group.summary && group.summary.trim()) ? group.summary : (group.detail && group.detail.trim() ? group.detail : '');
        dataRow.getCell(9).value = contentValue;
        dataRow.getCell(9).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(9).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        
        // 판단 / 확인 사항 (비어있음)
        dataRow.getCell(10).value = '';
        dataRow.getCell(10).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(10).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 근무 타입
        dataRow.getCell(11).value = group.shift || '';
        dataRow.getCell(11).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(11).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 비고 (비어있음)
        dataRow.getCell(12).value = '';
        dataRow.getCell(12).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(12).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 링크 컬럼 (하이퍼링크)
        group.links.forEach((link, linkIdx) => {
          const linkCol = fixedColumns + linkIdx + 1;
          const linkCell = dataRow.getCell(linkCol);
          
          // 하이퍼링크 설정
          if (link) {
            linkCell.value = { text: '1', hyperlink: link };
            linkCell.font = { color: { argb: 'FF0000FF' }, underline: true };
          } else {
            linkCell.value = '1';
            linkCell.font = { color: { argb: 'FF000000' } };
          }
          
          linkCell.border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          linkCell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        // 링크 컬럼 테두리 강제 적용 (빈 셀 포함)
        for (let linkIdx = 0; linkIdx < maxLinks; linkIdx++) {
          const linkCol = fixedColumns + linkIdx + 1;
          const linkCell = dataRow.getCell(linkCol);

          if (linkCell.value === undefined || linkCell.value === null) {
            linkCell.value = '';
          }

          linkCell.border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          linkCell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
        
        // 합계
        const totalCell = dataRow.getCell(fixedColumns + maxLinks + 1);
        totalCell.value = group.count;
        totalCell.numFmt = '#,##0';
        totalCell.border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
        
        currentRow++;
      });
      
      // 열 너비 설정
      vocSheet.getColumn(1).width = 12; // 날짜
      vocSheet.getColumn(2).width = 10; // 플랫폼
      vocSheet.getColumn(3).width = 12; // 출처
      vocSheet.getColumn(4).width = 15; // 대분류
      vocSheet.getColumn(5).width = 15; // 중분류
      vocSheet.getColumn(6).width = 8; // 종류
      vocSheet.getColumn(7).width = 8; // 성향
      vocSheet.getColumn(8).width = 8; // 중요도
      vocSheet.getColumn(9).width = 50; // 내용 (넓게)
      vocSheet.getColumn(10).width = 20; // 판단/확인사항
      vocSheet.getColumn(11).width = 10; // 근무 타입
      vocSheet.getColumn(12).width = 8; // 비고
      
      // 링크 컬럼 너비
      for (let i = 1; i <= maxLinks; i++) {
        vocSheet.getColumn(fixedColumns + i).width = 6;
      }
      
      // 합계 컬럼 너비
      vocSheet.getColumn(fixedColumns + maxLinks + 1).width = 10;
      
      logger.info('VoC sheet created', { rowCount: groupedData.length, maxLinks });
    } catch (error) {
      logger.error('Failed to create VoC sheet', {
        error: error.message,
        stack: error.stack,
        startDate,
        endDate
      });
      throw error;
    }
  }

  /**
   * VoC 이슈 그룹화
   * @param {Array} issues - 이슈 배열
   * @returns {Array} 그룹화된 데이터 배열
   */
  groupVoCIssues(issues) {
    const groupMap = new Map();
    
    issues.forEach(issue => {
      // 그룹 키 생성 (date, platform, source, categoryGroup, category, type, sentiment, severity, summary)
      const platform = this.inferPlatform(issue);
      const source = this.inferSource(issue);
      const categoryGroup = issue.categoryGroup?.name || '';
      const category = issue.category?.name || '';
      const type = this.inferType(issue);
      const sentiment = issue.sentiment || 'neu';
      const severity = issue.severity || 3;
      // AI 분류 이유 → 제목 → 상세 순으로 내용 선택
      let finalContent = '';
      if (issue.aiClassificationReason && issue.aiClassificationReason.trim()) {
        finalContent = issue.aiClassificationReason.trim();
      } else if (issue.summary && issue.summary.trim()) {
        finalContent = `(제목) ${issue.summary.trim()}`;
      } else if (issue.detail && issue.detail.trim()) {
        finalContent = issue.detail.substring(0, 100);
      } else {
        finalContent = '';
      }
      
      const groupKey = `${issue.date}|${platform}|${source}|${categoryGroup}|${category}|${type}|${sentiment}|${severity}|${finalContent}`;
      
      if (!groupMap.has(groupKey)) {
        // 근무 타입 판별 (createdAt 시간 기준)
        const createdAt = new Date(issue.createdAt);
        const hour = createdAt.getHours();
        const shift = (hour >= 9 && hour < 18) ? '주' : '야';
        
        groupMap.set(groupKey, {
          date: issue.date,
          platform: platform,
          source: source,
          categoryGroup: categoryGroup,
          category: category,
          type: type,
          sentiment: sentiment,
          severity: severity,
          // importance 우선, 없으면 severity에서 변환 (이슈 상세 창 수정 내용 반영)
          importance: issue.importance || 
            (issue.severity === 1 ? 'HIGH' : 
             issue.severity === 2 ? 'MEDIUM' : 
             issue.severity === 3 ? 'LOW' : 'MEDIUM'),
          summary: finalContent, // 내용 컬럼에 표시될 최종 문자열
          detail: issue.detail || '', // 상세 내용
          shift: shift,
          links: [],
          count: 0
        });
      }
      
      const group = groupMap.get(groupKey);
      
      // 링크 수집 (sourceUrl 또는 link)
      const link = issue.sourceUrl || issue.link;
      if (link && !group.links.includes(link)) {
        group.links.push(link);
      }
      
      group.count++;
    });
    
    // 배열로 변환 및 정렬
    return Array.from(groupMap.values()).sort((a, b) => {
      // 날짜 순, 그 다음 대분류 순
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }
      return (a.categoryGroup || '').localeCompare(b.categoryGroup || '');
    });
  }

  /**
   * 플랫폼 추론
   * @param {Object} issue - 이슈 객체
   * @returns {string} 플랫폼 이름
   */
  inferPlatform(issue) {
    // projectId를 우선 확인 (더 정확함)
    if (issue.projectId === 1) {
      return 'Steam'; // PUBG PC
    } else if (issue.projectId === 2) {
      return 'Mobile'; // PUBG MOBILE
    }
    
    // projectId가 없으면 externalSource로 추론
    if (issue.externalSource) {
      if (issue.externalSource.includes('PUBG_PC')) {
        return 'Steam';
      } else if (issue.externalSource.includes('PUBG_MOBILE')) {
        return 'Mobile';
      }
    }
    
    // 기본값
    return 'Steam';
  }

  /**
   * 출처 추론
   * @param {Object} issue - 이슈 객체
   * @returns {string} 출처 이름
   */
  inferSource(issue) {
    if (issue.externalSource) {
      if (issue.externalSource.includes('NAVER_CAFE')) {
        return 'Naver Café';
      } else if (issue.externalSource.includes('DISCORD')) {
        return 'Discord';
      }
    }
    if (issue.source && issue.source !== 'system') {
      return issue.source;
    }
    // 기본값
    return 'Naver Café';
  }

  /**
   * 종류(유형) 추론
   * @param {Object} issue - 이슈 객체
   * @returns {string} 종류 (의견, 건의, 문의, 제보)
   */
  inferType(issue) {
    // 1. trend 필드 우선 사용 (이슈 상세 창에서 사용자가 직접 수정한 값)
    if (issue.trend) {
      const trendLower = issue.trend.toLowerCase();
      if (trendLower.includes('건의') || trendLower.includes('제안')) {
        return '건의';
      } else if (trendLower.includes('문의') || trendLower.includes('질문')) {
        return '문의';
      } else if (trendLower.includes('제보') || trendLower.includes('신고')) {
        return '제보';
      } else if (trendLower.includes('의견')) {
        return '의견';
      }
    }
    
    // 2. category.name에서 추론
    if (issue.category?.name) {
      const categoryName = issue.category.name.toLowerCase();
      if (categoryName.includes('건의') || categoryName.includes('제안')) {
        return '건의';
      } else if (categoryName.includes('문의') || categoryName.includes('질문')) {
        return '문의';
      } else if (categoryName.includes('제보') || categoryName.includes('신고')) {
        return '제보';
      }
    }
    
    // 3. 기본값
    return '의견';
  }

  /**
   * ISSUE 시트 생성
   * @param {ExcelJS.Workbook} workbook - 워크북 객체
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   */
  async createIssueSheet(workbook, startDate, endDate, projectId = null, reportConfig = null) {
    try {
      // 날짜 범위 필터 (date 필드 사용 - 게시글 작성 날짜 기준)
      const dateFilter = {
        date: {
          gte: startDate,
          lte: endDate
        }
      };
      
      // 슬랙 공유 날짜 필터 (DateTime 필요)
      const startDateTime = new Date(`${startDate}T00:00:00.000Z`);
      const endDateTime = new Date(`${endDate}T23:59:59.999Z`);
      
      // 프로젝트 필터 조건
      // 특정 프로젝트 선택 시: 해당 프로젝트 이슈 + 크롤링 이슈(projectId: null) 모두 포함
      const projectFilter = projectId 
        ? {
            OR: [
              { projectId: projectId },
              { projectId: null }  // 크롤링 이슈도 포함
            ]
          }
        : {};
      
      // 기간 내의 중요 이슈만 조회 (severity=1 또는 importance='HIGH')
      // 슬랙으로 공유된 이슈도 포함 (IssueShareLog가 있는 경우)
      // 보고서 제외된 이슈는 제외
      // 먼저 공유된 이슈 ID 목록 조회
      const sharedIssueIds = query(
        `SELECT DISTINCT issueId FROM IssueShareLog 
         WHERE status = 'SUCCESS' 
         AND sentAt >= ? AND sentAt <= ?`,
        [startDateTime.toISOString(), endDateTime.toISOString()]
      ).map(row => row.issueId);
      
      let sql = `SELECT i.*, 
                 cg.id as categoryGroup_id, cg.name as categoryGroup_name, cg.code as categoryGroup_code, cg.color as categoryGroup_color,
                 c.id as category_id, c.name as category_name,
                 a.id as assignedAgent_id, a.name as assignedAgent_name
                 FROM ReportItemIssue i
                 LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
                 LEFT JOIN Category c ON i.categoryId = c.id
                 LEFT JOIN Agent a ON i.assignedAgentId = a.id
                 WHERE (i.excludedFromReport = 0 OR i.excludedFromReport IS NULL)`;
      const params = [];
      
      // 프로젝트 필터
      if (projectId) {
        sql += ' AND (i.projectId = ? OR i.projectId IS NULL)';
        params.push(projectId);
      }
      
      // 중요 이슈 필터 (severity=1 또는 importance='HIGH' 또는 공유된 이슈)
      const issueIdPlaceholders = sharedIssueIds.length > 0 
        ? sharedIssueIds.map(() => '?').join(',')
        : '';
      sql += ` AND (i.severity = 1 OR i.importance = 'HIGH'${issueIdPlaceholders ? ` OR i.id IN (${issueIdPlaceholders})` : ''})`;
      if (sharedIssueIds.length > 0) {
        params.push(...sharedIssueIds);
      }
      
      // 날짜 필터 또는 공유된 이슈
      sql += ` AND (i.date >= ? AND i.date <= ?${issueIdPlaceholders ? ` OR i.id IN (${issueIdPlaceholders})` : ''})`;
      params.push(startDate, endDate);
      if (sharedIssueIds.length > 0) {
        params.push(...sharedIssueIds);
      }
      
      sql += ' ORDER BY i.createdAt ASC';
      
      const issues = query(sql, params).map(issue => {
        const issueId = issue.id;
        // 각 이슈의 최근 공유 로그 조회
        const latestShareLog = queryOne(
          `SELECT sl.*, a.id as agent_id, a.name as agent_name
           FROM IssueShareLog sl
           LEFT JOIN Agent a ON sl.agentId = a.id
           WHERE sl.issueId = ? AND sl.status = 'SUCCESS'
           ORDER BY sl.sentAt DESC
           LIMIT 1`,
          [issueId]
        );
        
        return {
          ...issue,
          categoryGroup: issue.categoryGroup_id ? {
            id: issue.categoryGroup_id,
            name: issue.categoryGroup_name,
            code: issue.categoryGroup_code,
            color: issue.categoryGroup_color
          } : null,
          category: issue.category_id ? {
            id: issue.category_id,
            name: issue.category_name
          } : null,
          assignedAgent: issue.assignedAgent_id ? {
            id: issue.assignedAgent_id,
            name: issue.assignedAgent_name
          } : null,
          shareLogs: latestShareLog ? [{
            ...latestShareLog,
            agent: latestShareLog.agent_id ? {
              id: latestShareLog.agent_id,
              name: latestShareLog.agent_name
            } : null
          }] : []
        };
      });
      
      if (issues.length === 0) {
        const issueSheet = workbook.addWorksheet('ISSUE');
        issueSheet.getCell(1, 1).value = '데이터가 없습니다.';
        return;
      }

      // 동일 출처(externalPostId) 그룹화: 같은 게시글은 한 행으로, 해당 이슈들의 링크만 추가
      const byExternalPostId = new Map();
      for (const issue of issues) {
        const key = issue.externalPostId ? String(issue.externalPostId).trim() : null;
        if (!key) continue;
        if (!byExternalPostId.has(key)) byExternalPostId.set(key, []);
        byExternalPostId.get(key).push(issue);
      }
      const consumedIds = new Set();
      const reportRows = [];
      for (const [, list] of byExternalPostId.entries()) {
        if (list.length >= 2) {
          list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          const representative = list[0];
          const sameIssueLinks = list.slice(1);
          consumedIds.add(representative.id);
          sameIssueLinks.forEach((i) => consumedIds.add(i.id));
          reportRows.push({ issue: representative, sameIssueLinks });
        }
      }
      for (const issue of issues) {
        if (consumedIds.has(issue.id)) continue;
        reportRows.push({ issue, sameIssueLinks: [] });
      }
      reportRows.sort((a, b) => new Date(a.issue.createdAt) - new Date(b.issue.createdAt));
      
      // 시트 생성
      const issueSheet = workbook.addWorksheet('ISSUE');
      
      // 스타일 정의
      const borderStyle = {
        style: 'thin',
        color: { argb: 'FF000000' }
      };
      
      const headerFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
      
      let currentRow = 1;
      
      // Row 1-2: "이슈" 헤더 (A1:L2 병합)
      issueSheet.mergeCells(1, 1, 2, 12);
      const titleCell = issueSheet.getCell(1, 1);
      titleCell.value = '이슈';
      titleCell.font = { bold: true, size: 14 };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = headerFill;
      currentRow = 3; // Row 3은 빈 행
      
      // Row 4: 메인 헤더
      currentRow++;
      const headerRow = issueSheet.getRow(currentRow);
      const headerLabels = [
        'No', '날짜', '분류', '요약', '세부 내용', '최초게시물', 
        '이슈확인시간', '공유 시간', '공유 방식', '수신자', '결과값', '비고'
      ];
      
      headerLabels.forEach((label, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = label;
        cell.font = { bold: true };
        cell.fill = headerFill;
        cell.border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      
      currentRow++;
      
      // 데이터 행 작성 (동일 이슈는 대표 1행 + 비고에 추가 링크)
      reportRows.forEach(({ issue, sameIssueLinks }, index) => {
        const dataRow = issueSheet.getRow(currentRow);
        
        // No (순번)
        dataRow.getCell(1).value = index + 1;
        dataRow.getCell(1).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 날짜 (createdAt을 YYYY-MM-DD 형식으로)
        const issueDate = new Date(issue.createdAt);
        const dateStr = issueDate.toISOString().split('T')[0];
        dataRow.getCell(2).value = dateStr;
        dataRow.getCell(2).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 분류 (category.name 또는 기본값)
        const categoryName = issue.category?.name || issue.categoryGroup?.name || '버그';
        dataRow.getCell(3).value = categoryName;
        dataRow.getCell(3).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 요약 (summary)
        dataRow.getCell(4).value = issue.summary || issue.detail || '';
        dataRow.getCell(4).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(4).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        
        // 세부 내용 (두 줄: detail + 공유 로그)
        const detail = issue.detail || issue.summary || '';
        let shareLog = '';
        
        // 공유 로그 생성 (IssueShareLog.status === 'SUCCESS'인 경우만)
        const latestShareLog = issue.shareLogs && issue.shareLogs.length > 0 ? issue.shareLogs[0] : null;
        if (latestShareLog && latestShareLog.status === 'SUCCESS' && latestShareLog.sentAt) {
          const sharedDate = new Date(latestShareLog.sentAt);
          const month = String(sharedDate.getMonth() + 1).padStart(2, '0');
          const day = String(sharedDate.getDate()).padStart(2, '0');
          const hours = String(sharedDate.getHours()).padStart(2, '0');
          const minutes = String(sharedDate.getMinutes()).padStart(2, '0');
          const agentName = latestShareLog.agent?.name || issue.assignedAgent?.name || '담당자';
          const targetName = latestShareLog.target === 'Client_Channel' ? '고객사' : 
                           latestShareLog.target === 'Internal_Channel' ? '내부' : '슬랙';
          shareLog = `> ${month}/${day} ${hours}:${minutes} ${agentName} ${targetName} 공유`;
        }
        // processedAt이나 checkedAt은 실제 공유를 의미하지 않으므로 사용하지 않음
        
        const detailText = shareLog ? `${detail}\n${shareLog}` : detail;
        dataRow.getCell(5).value = detailText;
        dataRow.getCell(5).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(5).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        
        // 최초게시물 (하이퍼링크). 동일 이슈 그룹이면 대표 링크 1개 + 비고에 나머지 링크
        const originalUrl = issue.sourceUrl || issue.link;
        if (originalUrl) {
          dataRow.getCell(6).value = { text: sameIssueLinks.length > 0 ? '링크(1)' : '링크', hyperlink: originalUrl };
          dataRow.getCell(6).font = { color: { argb: 'FF0000FF' }, underline: true };
        } else {
          dataRow.getCell(6).value = '';
        }
        dataRow.getCell(6).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(6).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 이슈확인시간 (checkedAt을 HH:mm 형식으로)
        let checkedTime = '';
        if (issue.checkedAt) {
          const checkedDate = new Date(issue.checkedAt);
          const hours = String(checkedDate.getHours()).padStart(2, '0');
          const minutes = String(checkedDate.getMinutes()).padStart(2, '0');
          checkedTime = `${hours}:${minutes}`;
        }
        dataRow.getCell(7).value = checkedTime;
        dataRow.getCell(7).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 공유 시간 (IssueShareLog.status === 'SUCCESS'인 경우만 표시)
        let sharedTime = '';
        if (latestShareLog && latestShareLog.status === 'SUCCESS' && latestShareLog.sentAt) {
          const sharedDate = new Date(latestShareLog.sentAt);
          const hours = String(sharedDate.getHours()).padStart(2, '0');
          const minutes = String(sharedDate.getMinutes()).padStart(2, '0');
          sharedTime = `${hours}:${minutes}`;
        }
        // processedAt은 실제 공유 시간이 아니므로 사용하지 않음
        dataRow.getCell(8).value = sharedTime;
        dataRow.getCell(8).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 공유 방식 (IssueShareLog.status === 'SUCCESS'인 경우만 표시)
        const shareMethod = (latestShareLog && latestShareLog.status === 'SUCCESS') ? '슬랙' : '';
        dataRow.getCell(9).value = shareMethod;
        dataRow.getCell(9).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 수신자 (IssueShareLog.status === 'SUCCESS'인 경우만 표시)
        let receiver = '';
        if (latestShareLog && latestShareLog.status === 'SUCCESS') {
          if (latestShareLog.target === 'Client_Channel') {
            receiver = '고객사 담당자';
          } else if (latestShareLog.target === 'Internal_Channel') {
            receiver = '내부 담당자';
          } else {
            receiver = latestShareLog.target || '고객사 담당자';
          }
        }
        // 공유 로그가 없거나 실패한 경우 빈 값
        dataRow.getCell(10).value = receiver;
        dataRow.getCell(10).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(10).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 결과값 ("공유 완료" - IssueShareLog.status === 'SUCCESS'인 경우만)
        // processedAt이나 status는 실제 공유를 의미하지 않으므로 사용하지 않음
        const resultValue = (latestShareLog && latestShareLog.status === 'SUCCESS') 
          ? '공유 완료' 
          : '';
        dataRow.getCell(11).value = resultValue;
        dataRow.getCell(11).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(11).alignment = { horizontal: 'center', vertical: 'middle' };
        
        // 비고 (동일 이슈일 때 추가 링크만 기입)
        let noteValue = '';
        if (sameIssueLinks.length > 0) {
          const extraUrls = sameIssueLinks
            .map((i, idx) => (i.sourceUrl || i.link || '').trim())
            .filter(Boolean);
          if (extraUrls.length > 0) {
            noteValue = `동일이슈(${sameIssueLinks.length}건): ${extraUrls.join(', ')}`;
          }
        }
        dataRow.getCell(12).value = noteValue;
        dataRow.getCell(12).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(12).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        
        // 행 높이 자동 조절 (세부 내용이 길 수 있으므로)
        dataRow.height = undefined; // 자동 높이
        
        currentRow++;
      });
      
      // 열 너비 설정
      issueSheet.getColumn(1).width = 6; // No
      issueSheet.getColumn(2).width = 12; // 날짜
      issueSheet.getColumn(3).width = 12; // 분류
      issueSheet.getColumn(4).width = 40; // 요약 (wrapText)
      issueSheet.getColumn(5).width = 60; // 세부 내용 (넓게)
      issueSheet.getColumn(6).width = 12; // 최초게시물
      issueSheet.getColumn(7).width = 14; // 이슈확인시간
      issueSheet.getColumn(8).width = 12; // 공유 시간
      issueSheet.getColumn(9).width = 12; // 공유 방식
      issueSheet.getColumn(10).width = 15; // 수신자
      issueSheet.getColumn(11).width = 12; // 결과값
      issueSheet.getColumn(12).width = 10; // 비고
      
      logger.info('ISSUE sheet created', { issueCount: issues.length, rowCount: reportRows.length });
    } catch (error) {
      logger.error('Failed to create ISSUE sheet', {
        error: error.message,
        stack: error.stack,
        startDate,
        endDate
      });
      throw error;
    }
  }

  /**
   * Data 시트 생성 (Raw Data)
   * @param {ExcelJS.Workbook} workbook - 워크북 객체
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   */
  async createDataSheet(workbook, startDate, endDate, projectId = null, reportConfig = null) {
    try {
      // 날짜 범위 필터 (date 필드 사용 - 게시글 작성 날짜 기준)
      const dateFilter = {
        date: {
          gte: startDate,
          lte: endDate
        }
      };

      // 프로젝트 필터 조건
      // 특정 프로젝트 선택 시: 해당 프로젝트 이슈 + 크롤링 이슈(projectId: null) 모두 포함
      const projectFilter = projectId 
        ? {
            OR: [
              { projectId: projectId },
              { projectId: null }  // 크롤링 이슈도 포함
            ]
          }
        : {};
      
      // 기간 내의 모든 이슈 조회
      let sql = `SELECT i.*, 
                 cg.id as categoryGroup_id, cg.name as categoryGroup_name, cg.code as categoryGroup_code, cg.color as categoryGroup_color,
                 c.id as category_id, c.name as category_name,
                 a.id as assignedAgent_id, a.name as assignedAgent_name
                 FROM ReportItemIssue i
                 LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
                 LEFT JOIN Category c ON i.categoryId = c.id
                 LEFT JOIN Agent a ON i.assignedAgentId = a.id
                 WHERE (i.excludedFromReport = 0 OR i.excludedFromReport IS NULL)`;
      const params = [];
      
      sql += ' AND i.date >= ?';
      params.push(startDate);
      sql += ' AND i.date <= ?';
      params.push(endDate);
      
      if (projectId) {
        sql += ' AND (i.projectId = ? OR i.projectId IS NULL)';
        params.push(projectId);
      }
      
      sql += ' ORDER BY i.date ASC';
      
      const issues = query(sql, params).map(issue => ({
        ...issue,
        categoryGroup: issue.categoryGroup_id ? {
          id: issue.categoryGroup_id,
          name: issue.categoryGroup_name,
          code: issue.categoryGroup_code,
          color: issue.categoryGroup_color
        } : null,
        category: issue.category_id ? {
          id: issue.category_id,
          name: issue.category_name
        } : null,
        assignedAgent: issue.assignedAgent_id ? {
          id: issue.assignedAgent_id,
          name: issue.assignedAgent_name
        } : null
      }));
      
      // 기간 내의 모든 Data 아이템 조회
      const dataItems = query(
        'SELECT * FROM ReportItemData WHERE date >= ? AND date <= ? ORDER BY date ASC',
        [startDate, endDate]
      );
      
      // 날짜별로 그룹화 및 분류
      const dateGroups = this.groupDataByDate(issues, dataItems);
      
      if (Object.keys(dateGroups).length === 0) {
        const dataSheet = workbook.addWorksheet('Data');
        dataSheet.getCell(1, 1).value = '데이터가 없습니다.';
        return;
      }
      
      // 시트 생성
      const dataSheet = workbook.addWorksheet('Data');
      
      // 스타일 정의
      const borderStyle = {
        style: 'thin',
        color: { argb: 'FF000000' }
      };
      
      const headerFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
      
      let currentRow = 1;
      
      // Row 1: "SUMMARY DATA" 헤더 (A1:F1 병합)
      dataSheet.mergeCells(currentRow, 1, currentRow, 6);
      const titleCell = dataSheet.getCell(currentRow, 1);
      titleCell.value = 'SUMMARY DATA';
      titleCell.font = { bold: true, size: 14 };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = headerFill;
      currentRow++;
      
      // Row 2: 데이터 포맷 가이드
      const guideCell = dataSheet.getCell(currentRow, 1);
      guideCell.value = '함수 / YYYY-MM-DD / 이름 / - 이슈 내용 - 00:00 / 이름 / 요청 내용 - 00:00 / 이름 / 비고';
      guideCell.font = { size: 9, italic: true };
      guideCell.alignment = { horizontal: 'left', vertical: 'middle' };
      currentRow++;
      
      // Row 3: 메인 헤더
      const headerRow = dataSheet.getRow(currentRow);
      const headerLabels = ['구분', '날짜', '작성자', '공유', '요청', '비고'];
      
      headerLabels.forEach((label, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = label;
        cell.font = { bold: true };
        cell.fill = headerFill;
        cell.border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      currentRow++;
      
      // 데이터 행 작성
      const sortedDates = Object.keys(dateGroups).sort();
      
      sortedDates.forEach(date => {
        const group = dateGroups[date];
        const dataRow = dataSheet.getRow(currentRow);
        
        // 구분 (주차)
        const weekLabel = this.getWeekLabel(date);
        dataRow.getCell(1).value = weekLabel;
        dataRow.getCell(1).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
        
        // 날짜 (YYYY-MM-DD)
        dataRow.getCell(2).value = date;
        dataRow.getCell(2).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(2).alignment = { horizontal: 'center', vertical: 'top' };
        
        // 작성자 (주 담당자 이름)
        dataRow.getCell(3).value = group.author || '';
        dataRow.getCell(3).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(3).alignment = { horizontal: 'center', vertical: 'top' };
        
        // 공유 (Issues) - 멀티라인
        const shareText = group.shares.join('\n');
        dataRow.getCell(4).value = shareText || '';
        dataRow.getCell(4).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(4).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        
        // 요청 (Requests) - 멀티라인
        const requestText = group.requests.join('\n');
        dataRow.getCell(5).value = requestText || '';
        dataRow.getCell(5).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(5).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        
        // 비고 (Notices) - 멀티라인
        const remarksText = group.remarks.join('\n');
        dataRow.getCell(6).value = remarksText || '';
        dataRow.getCell(6).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        dataRow.getCell(6).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        
        // 행 높이 자동 조절
        dataRow.height = undefined;
        
        currentRow++;
      });
      
      // 열 너비 설정
      dataSheet.getColumn(1).width = 15; // 구분
      dataSheet.getColumn(2).width = 12; // 날짜
      dataSheet.getColumn(3).width = 12; // 작성자
      dataSheet.getColumn(4).width = 50; // 공유 (넓게)
      dataSheet.getColumn(5).width = 50; // 요청 (넓게)
      dataSheet.getColumn(6).width = 50; // 비고 (넓게)
      
      logger.info('Data sheet created', { rowCount: sortedDates.length });
    } catch (error) {
      logger.error('Failed to create Data sheet', {
        error: error.message,
        stack: error.stack,
        startDate,
        endDate
      });
      throw error;
    }
  }
  
  /**
   * 날짜별로 데이터 그룹화 및 분류
   * @param {Array} issues - 이슈 배열
   * @param {Array} dataItems - Data 아이템 배열
   * @returns {Object} 날짜별 그룹화된 데이터
   */
  groupDataByDate(issues, dataItems) {
    const dateGroups = {};
    
    // ReportItemIssue 처리
    issues.forEach(issue => {
      const date = issue.date || issue.createdAt.toISOString().split('T')[0];
      
      if (!dateGroups[date]) {
        dateGroups[date] = {
          shares: [],
          requests: [],
          remarks: [],
          authors: new Set()
        };
      }
      
      const group = dateGroups[date];
      
      // 작성자 수집
      if (issue.assignedAgent?.name) {
        group.authors.add(issue.assignedAgent.name);
      }
      
      // 시간 포맷 (HH:mm)
      const createdAt = new Date(issue.createdAt);
      const hours = String(createdAt.getHours()).padStart(2, '0');
      const minutes = String(createdAt.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;
      
      // 에이전트 이름
      const agentName = issue.assignedAgent?.name || '담당자';
      
      // 내용
      const content = issue.summary || issue.detail || '';
      
      // 분류
      const categoryName = (issue.category?.name || issue.categoryGroup?.name || '').toLowerCase();
      const type = this.inferType(issue);
      const source = (issue.source || '').toLowerCase();
      
      // 공유 (Issues): 일반적인 이슈 (category != 'Request', source != 'Notice')
      if (source !== 'notice' && !categoryName.includes('요청') && !categoryName.includes('공지')) {
        if (content) {
          group.shares.push(`공유 - ${timeStr} / ${agentName}\n${content}`);
        }
      }
      
      // 요청 (Requests): type == '건의' 또는 category에 '요청' 포함
      if (type === '건의' || categoryName.includes('요청')) {
        if (content) {
          group.requests.push(`${content} - ${timeStr} / ${agentName}`);
        }
      }
      
      // 비고 (Notices): source == 'Notice' 또는 category에 '공지' 포함
      if (source === 'notice' || categoryName.includes('공지') || categoryName.includes('패치')) {
        const noticeTitle = content || issue.summary || '';
        const noticeDate = new Date(issue.createdAt);
        const noticeMonth = String(noticeDate.getMonth() + 1).padStart(2, '0');
        const noticeDay = String(noticeDate.getDate()).padStart(2, '0');
        const noticeHours = String(noticeDate.getHours()).padStart(2, '0');
        const noticeMinutes = String(noticeDate.getMinutes()).padStart(2, '0');
        
        // 말머리 추론 (category 또는 summary에서)
        let prefix = '';
        if (categoryName.includes('패치')) {
          prefix = '[패치노트]';
        } else if (categoryName.includes('안내')) {
          prefix = '[안내]';
        } else if (categoryName.includes('점검')) {
          prefix = '[점검]';
        } else {
          prefix = '[안내]';
        }
        
        group.remarks.push(`${noticeDate.getFullYear()}.${noticeMonth}.${noticeDay} ${noticeHours}:${noticeMinutes}\n${prefix} ${noticeTitle}`);
      }
    });
    
    // ReportItemData 처리
    dataItems.forEach(item => {
      const date = item.date;
      
      if (!dateGroups[date]) {
        dateGroups[date] = {
          shares: [],
          requests: [],
          remarks: [],
          authors: new Set()
        };
      }
      
      const group = dateGroups[date];
      
      // 작성자 수집
      if (item.author) {
        group.authors.add(item.author);
      }
      
      // 공유 (share 필드)
      if (item.share) {
        group.shares.push(item.share);
      }
      
      // 요청 (request 필드)
      if (item.request) {
        group.requests.push(item.request);
      }
      
      // 비고 (remarks 필드)
      if (item.remarks) {
        group.remarks.push(item.remarks);
      }
    });
    
    // 작성자 정리 (가장 많이 등장한 작성자 또는 첫 번째 작성자)
    Object.keys(dateGroups).forEach(date => {
      const group = dateGroups[date];
      const authorsArray = Array.from(group.authors);
      group.author = authorsArray.length > 0 ? authorsArray[0] : '';
      delete group.authors;
    });
    
    return dateGroups;
  }
  
  /**
   * 주차 레이블 생성 (예: "11월 2주차")
   * @param {string} dateStr - 날짜 문자열 (YYYY-MM-DD)
   * @returns {string} 주차 레이블
   */
  getWeekLabel(dateStr) {
    try {
      const date = new Date(dateStr + 'T00:00:00.000Z');
      const month = date.getMonth() + 1; // 0-based to 1-based
      const day = date.getDate();
      
      // 해당 월의 첫 번째 날짜
      const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
      const firstDayOfWeek = firstDay.getDay(); // 0 (일요일) ~ 6 (토요일)
      
      // 첫 번째 주의 시작일 계산 (일요일 기준)
      const firstSunday = firstDayOfWeek === 0 ? 1 : 8 - firstDayOfWeek;
      
      // 현재 날짜가 몇 주차인지 계산
      let weekNumber;
      if (day < firstSunday) {
        // 첫 번째 주
        weekNumber = 1;
      } else {
        weekNumber = Math.floor((day - firstSunday) / 7) + 1;
      }
      
      return `${month}월 ${weekNumber}주차`;
    } catch (error) {
      logger.error('Failed to calculate week label', { dateStr, error: error.message });
      return '';
    }
  }

  /**
   * INDEX 시트 생성
   * @param {ExcelJS.Workbook} workbook - 워크북 객체
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   */
  async createIndexSheet(workbook, startDate, endDate, projectId = null, reportConfig = null) {
    try {
      // 시트 생성
      const indexSheet = workbook.addWorksheet('INDEX');
      
      // 프로젝트 필터 조건
      // CategoryGroup은 항상 프로젝트에 속하므로 projectId는 필수 (null 불가)
      const projectFilter = projectId 
        ? { projectId: projectId }
        : {};
      
      // 스타일 정의
      const borderStyle = {
        style: 'thin',
        color: { argb: 'FF000000' }
      };
      
      const headerFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' } // 진한 파란색
      };
      
      const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      
      // 색상 그룹 정의
      const colorGroups = {
        orange: { argb: 'FFFFE699' }, // 노랑 (서버, 퍼포먼스, 불법프로그램)
        green: { argb: 'FFC6EFCE' },  // 초록 (콘텐츠, 버그)
        blue: { argb: 'FFBDD7EE' }    // 파랑 (이스포츠, 커뮤니티, 타게임)
      };
      
      let currentRow = 1;
      
      // ===== 왼쪽 표: 카테고리 맵 =====
      const categoryMapStartCol = 1;
      const categoryMapStartRow = currentRow;
      
      // 카테고리 그룹 및 카테고리 조회 (프로젝트 필터 적용)
      let sql = 'SELECT * FROM CategoryGroup WHERE isActive = 1';
      const params = [];
      if (projectId) {
        sql += ' AND projectId = ?';
        params.push(projectId);
      }
      sql += ' ORDER BY name ASC';
      
      const categoryGroups = query(sql, params).map(group => {
        const categories = query(
          'SELECT * FROM Category WHERE groupId = ? AND isActive = 1 ORDER BY name ASC',
          [group.id]
        );
        return {
          ...group,
          categories
        };
      });
      
      // 헤더
      indexSheet.getCell(currentRow, categoryMapStartCol).value = '카테고리 맵';
      indexSheet.getCell(currentRow, categoryMapStartCol).font = headerFont;
      indexSheet.getCell(currentRow, categoryMapStartCol).fill = headerFill;
      indexSheet.getCell(currentRow, categoryMapStartCol).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      indexSheet.getCell(currentRow, categoryMapStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
      indexSheet.mergeCells(currentRow, categoryMapStartCol, currentRow, categoryMapStartCol + 1);
      currentRow++;
      
      // 서브헤더
      indexSheet.getCell(currentRow, categoryMapStartCol).value = '대분류';
      indexSheet.getCell(currentRow, categoryMapStartCol).font = { bold: true };
      indexSheet.getCell(currentRow, categoryMapStartCol).fill = headerFill;
      indexSheet.getCell(currentRow, categoryMapStartCol).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      indexSheet.getCell(currentRow, categoryMapStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
      
      indexSheet.getCell(currentRow, categoryMapStartCol + 1).value = '중분류';
      indexSheet.getCell(currentRow, categoryMapStartCol + 1).font = { bold: true };
      indexSheet.getCell(currentRow, categoryMapStartCol + 1).fill = headerFill;
      indexSheet.getCell(currentRow, categoryMapStartCol + 1).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      indexSheet.getCell(currentRow, categoryMapStartCol + 1).alignment = { horizontal: 'center', vertical: 'middle' };
      currentRow++;
      
      // 카테고리 데이터
      categoryGroups.forEach(group => {
        // 그룹 색상 결정
        let groupColor = colorGroups.blue; // 기본값
        if (group.color) {
          // DB의 color 필드 사용 (hex -> argb 변환)
          const hex = group.color.replace('#', '');
          groupColor = { argb: `FF${hex}` };
        } else {
          // 하드코딩된 색상 매핑
          if (group.importance === 'HIGH' && (group.code === 'SERVER' || group.code === 'PERFORMANCE' || group.code === 'ILLEGAL_PROGRAM')) {
            groupColor = colorGroups.orange;
          } else if (group.code === 'CONTENT' || group.code === 'BUG') {
            groupColor = colorGroups.green;
          }
        }
        
        // 첫 번째 카테고리 행
        const firstCategory = group.categories[0];
        if (firstCategory) {
          // 대분류 셀 (병합)
          const categoryCount = group.categories.length;
          indexSheet.mergeCells(currentRow, categoryMapStartCol, currentRow + categoryCount - 1, categoryMapStartCol);
          const groupCell = indexSheet.getCell(currentRow, categoryMapStartCol);
          groupCell.value = group.name;
          groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: groupColor };
          groupCell.border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          groupCell.alignment = { horizontal: 'center', vertical: 'middle' };
          
          // 중분류 셀
          const categoryCell = indexSheet.getCell(currentRow, categoryMapStartCol + 1);
          categoryCell.value = firstCategory.name;
          categoryCell.fill = { type: 'pattern', pattern: 'solid', fgColor: groupColor };
          categoryCell.border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          categoryCell.alignment = { horizontal: 'left', vertical: 'middle' };
          currentRow++;
          
          // 나머지 카테고리들
          for (let i = 1; i < group.categories.length; i++) {
            const catCell = indexSheet.getCell(currentRow, categoryMapStartCol + 1);
            catCell.value = group.categories[i].name;
            catCell.fill = { type: 'pattern', pattern: 'solid', fgColor: groupColor };
            catCell.border = {
              top: borderStyle,
              left: borderStyle,
              bottom: borderStyle,
              right: borderStyle
            };
            catCell.alignment = { horizontal: 'left', vertical: 'middle' };
            currentRow++;
          }
        } else {
          // 카테고리가 없는 그룹
          indexSheet.getCell(currentRow, categoryMapStartCol).value = group.name;
          indexSheet.getCell(currentRow, categoryMapStartCol).fill = { type: 'pattern', pattern: 'solid', fgColor: groupColor };
          indexSheet.getCell(currentRow, categoryMapStartCol).border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          indexSheet.getCell(currentRow, categoryMapStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
          indexSheet.mergeCells(currentRow, categoryMapStartCol, currentRow, categoryMapStartCol + 1);
          currentRow++;
        }
      });
      
      const categoryMapEndRow = currentRow - 1;
      
      // ===== 중간 표: 분류 기준 =====
      currentRow = categoryMapStartRow;
      const criteriaStartCol = 4;
      
      // 헤더
      indexSheet.getCell(currentRow, criteriaStartCol).value = '분류 기준';
      indexSheet.getCell(currentRow, criteriaStartCol).font = headerFont;
      indexSheet.getCell(currentRow, criteriaStartCol).fill = headerFill;
      indexSheet.getCell(currentRow, criteriaStartCol).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      indexSheet.getCell(currentRow, criteriaStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
      indexSheet.mergeCells(currentRow, criteriaStartCol, currentRow, criteriaStartCol + 1);
      currentRow++;
      
      // 서브헤더
      indexSheet.getCell(currentRow, criteriaStartCol).value = '항목';
      indexSheet.getCell(currentRow, criteriaStartCol).font = { bold: true };
      indexSheet.getCell(currentRow, criteriaStartCol).fill = headerFill;
      indexSheet.getCell(currentRow, criteriaStartCol).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      indexSheet.getCell(currentRow, criteriaStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
      
      indexSheet.getCell(currentRow, criteriaStartCol + 1).value = '값';
      indexSheet.getCell(currentRow, criteriaStartCol + 1).font = { bold: true };
      indexSheet.getCell(currentRow, criteriaStartCol + 1).fill = headerFill;
      indexSheet.getCell(currentRow, criteriaStartCol + 1).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      indexSheet.getCell(currentRow, criteriaStartCol + 1).alignment = { horizontal: 'center', vertical: 'middle' };
      currentRow++;
      
      // 분류 기준 데이터 (SystemCode에서 조회)
      const systemCodes = query(
        'SELECT * FROM SystemCode WHERE isActive = 1 ORDER BY type ASC, displayOrder ASC'
      );
      
      const criteriaData = [
        { label: '종류', type: 'ISSUE_TYPE' },
        { label: '중요도', type: 'IMPORTANCE' },
        { label: '성향', type: 'SENTIMENT' },
        { label: '출처', values: ['Naver Café', 'Discord', 'Steam', '기타'] },
        { label: '플랫폼', type: 'PLATFORM' },
        { label: '근무 시간', values: ['주간 (09:00~18:00)', '야간 (18:00~09:00)'] }
      ];
      
      criteriaData.forEach(criteria => {
        let values = [];
        
        if (criteria.type) {
          // SystemCode에서 조회
          values = systemCodes
            .filter(sc => sc.type === criteria.type)
            .map(sc => sc.label);
        } else {
          // 하드코딩된 값
          values = criteria.values || [];
        }
        
        const valuesText = values.join(', ');
        
        indexSheet.getCell(currentRow, criteriaStartCol).value = criteria.label;
        indexSheet.getCell(currentRow, criteriaStartCol).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        indexSheet.getCell(currentRow, criteriaStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
        
        indexSheet.getCell(currentRow, criteriaStartCol + 1).value = valuesText;
        indexSheet.getCell(currentRow, criteriaStartCol + 1).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        indexSheet.getCell(currentRow, criteriaStartCol + 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        currentRow++;
      });
      
      // ===== 오른쪽 표: 통계 =====
      currentRow = categoryMapStartRow;
      const statsStartCol = 7;
      
      // 최근 12주 데이터 조회
      const statsEndDate = new Date(endDate + 'T23:59:59.999Z');
      const statsStartDate = new Date(statsEndDate);
      statsStartDate.setDate(statsStartDate.getDate() - 84); // 12주 = 84일
      
      // 이슈 통계 조회 (보고서 제외 이슈 제외)
      const issues = query(
        'SELECT createdAt, date FROM ReportItemIssue WHERE (excludedFromReport = 0 OR excludedFromReport IS NULL) AND createdAt >= ? AND createdAt <= ?',
        [statsStartDate.toISOString(), statsEndDate.toISOString()]
      );
      
      // 댓글 통계 조회
      const comments = query(
        'SELECT createdAt FROM IssueComment WHERE createdAt >= ? AND createdAt <= ?',
        [statsStartDate.toISOString(), statsEndDate.toISOString()]
      );
      
      // 주별 통계 계산
      const weeklyStats = {};
      issues.forEach(issue => {
        const issueDate = new Date(issue.createdAt);
        const weekKey = this.getWeekKey(issueDate);
        if (!weeklyStats[weekKey]) {
          weeklyStats[weekKey] = { issues: 0, comments: 0 };
        }
        weeklyStats[weekKey].issues++;
      });
      
      comments.forEach(comment => {
        const commentDate = new Date(comment.createdAt);
        const weekKey = this.getWeekKey(commentDate);
        if (!weeklyStats[weekKey]) {
          weeklyStats[weekKey] = { issues: 0, comments: 0 };
        }
        weeklyStats[weekKey].comments++;
      });
      
      // 주별 통계를 월별로 집계
      const monthlyStats = {};
      Object.keys(weeklyStats).forEach(weekKey => {
        const [year, month] = weekKey.split('-').slice(0, 2);
        const monthKey = `${year}-${month}`;
        if (!monthlyStats[monthKey]) {
          monthlyStats[monthKey] = { weeks: new Set(), issues: 0, comments: 0 };
        }
        monthlyStats[monthKey].weeks.add(weekKey);
        monthlyStats[monthKey].issues += weeklyStats[weekKey].issues;
        monthlyStats[monthKey].comments += weeklyStats[weekKey].comments;
      });
      
      // 헤더
      indexSheet.getCell(currentRow, statsStartCol).value = '통계';
      indexSheet.getCell(currentRow, statsStartCol).font = headerFont;
      indexSheet.getCell(currentRow, statsStartCol).fill = headerFill;
      indexSheet.getCell(currentRow, statsStartCol).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      indexSheet.getCell(currentRow, statsStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
      indexSheet.mergeCells(currentRow, statsStartCol, currentRow, statsStartCol + 2);
      currentRow++;
      
      // 서브헤더
      const statsHeaders = ['월별 주수', '총게시물량', '댓글량'];
      statsHeaders.forEach((header, idx) => {
        const cell = indexSheet.getCell(currentRow, statsStartCol + idx);
        cell.value = header;
        cell.font = { bold: true };
        cell.fill = headerFill;
        cell.border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      currentRow++;
      
      // 통계 데이터 (최근 12주 또는 월별)
      const sortedMonths = Object.keys(monthlyStats).sort().slice(-12); // 최근 12개월
      sortedMonths.forEach(monthKey => {
        const stats = monthlyStats[monthKey];
        const [year, month] = monthKey.split('-');
        const monthLabel = `${year}년 ${parseInt(month)}월`;
        
        indexSheet.getCell(currentRow, statsStartCol).value = `${monthLabel} (${stats.weeks.size}주)`;
        indexSheet.getCell(currentRow, statsStartCol).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        indexSheet.getCell(currentRow, statsStartCol).alignment = { horizontal: 'left', vertical: 'middle' };
        
        indexSheet.getCell(currentRow, statsStartCol + 1).value = stats.issues;
        indexSheet.getCell(currentRow, statsStartCol + 1).numFmt = '#,##0';
        indexSheet.getCell(currentRow, statsStartCol + 1).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        indexSheet.getCell(currentRow, statsStartCol + 1).alignment = { horizontal: 'right', vertical: 'middle' };
        
        indexSheet.getCell(currentRow, statsStartCol + 2).value = stats.comments;
        indexSheet.getCell(currentRow, statsStartCol + 2).numFmt = '#,##0';
        indexSheet.getCell(currentRow, statsStartCol + 2).border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        indexSheet.getCell(currentRow, statsStartCol + 2).alignment = { horizontal: 'right', vertical: 'middle' };
        currentRow++;
      });
      
      // 이슈 결과 값 테이블
      currentRow += 2; // 빈 행 2개
      
      // 헤더
      indexSheet.getCell(currentRow, statsStartCol).value = '이슈 결과 값';
      indexSheet.getCell(currentRow, statsStartCol).font = headerFont;
      indexSheet.getCell(currentRow, statsStartCol).fill = headerFill;
      indexSheet.getCell(currentRow, statsStartCol).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      indexSheet.getCell(currentRow, statsStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
      indexSheet.mergeCells(currentRow, statsStartCol, currentRow, statsStartCol + 1);
      currentRow++;
      
      // 서브헤더
      indexSheet.getCell(currentRow, statsStartCol).value = '결과';
      indexSheet.getCell(currentRow, statsStartCol).font = { bold: true };
      indexSheet.getCell(currentRow, statsStartCol).fill = headerFill;
      indexSheet.getCell(currentRow, statsStartCol).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      indexSheet.getCell(currentRow, statsStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
      
      indexSheet.getCell(currentRow, statsStartCol + 1).value = '설명';
      indexSheet.getCell(currentRow, statsStartCol + 1).font = { bold: true };
      indexSheet.getCell(currentRow, statsStartCol + 1).fill = headerFill;
      indexSheet.getCell(currentRow, statsStartCol + 1).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      indexSheet.getCell(currentRow, statsStartCol + 1).alignment = { horizontal: 'center', vertical: 'middle' };
      currentRow++;
      
      // 이슈 결과 데이터 (SystemCode에서 조회)
      const issueResults = systemCodes.filter(sc => sc.type === 'ISSUE_RESULT');
      if (issueResults.length === 0) {
        // 기본값
        const defaultResults = [
          { label: '해결', description: '이슈가 해결됨' },
          { label: '공유 완료', description: '고객사에 공유 완료' },
          { label: '중복', description: '중복된 이슈' },
          { label: '수정 안함', description: '수정하지 않음' }
        ];
        
        defaultResults.forEach(result => {
          indexSheet.getCell(currentRow, statsStartCol).value = result.label;
          indexSheet.getCell(currentRow, statsStartCol).border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          indexSheet.getCell(currentRow, statsStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
          
          indexSheet.getCell(currentRow, statsStartCol + 1).value = result.description;
          indexSheet.getCell(currentRow, statsStartCol + 1).border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          indexSheet.getCell(currentRow, statsStartCol + 1).alignment = { horizontal: 'left', vertical: 'middle' };
          currentRow++;
        });
      } else {
        issueResults.forEach(result => {
          indexSheet.getCell(currentRow, statsStartCol).value = result.label;
          indexSheet.getCell(currentRow, statsStartCol).border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          indexSheet.getCell(currentRow, statsStartCol).alignment = { horizontal: 'center', vertical: 'middle' };
          
          indexSheet.getCell(currentRow, statsStartCol + 1).value = result.metadata || '';
          indexSheet.getCell(currentRow, statsStartCol + 1).border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          indexSheet.getCell(currentRow, statsStartCol + 1).alignment = { horizontal: 'left', vertical: 'middle' };
          currentRow++;
        });
      }
      
      // 열 너비 설정
      indexSheet.getColumn(categoryMapStartCol).width = 15; // 대분류
      indexSheet.getColumn(categoryMapStartCol + 1).width = 20; // 중분류
      indexSheet.getColumn(criteriaStartCol).width = 12; // 항목
      indexSheet.getColumn(criteriaStartCol + 1).width = 30; // 값
      indexSheet.getColumn(statsStartCol).width = 15; // 월별 주수
      indexSheet.getColumn(statsStartCol + 1).width = 12; // 총게시물량
      indexSheet.getColumn(statsStartCol + 2).width = 12; // 댓글량
      
      logger.info('INDEX sheet created', { 
        categoryGroups: categoryGroups.length,
        monthlyStats: sortedMonths.length 
      });
    } catch (error) {
      logger.error('Failed to create INDEX sheet', {
        error: error.message,
        stack: error.stack,
        startDate,
        endDate
      });
      throw error;
    }
  }
  
  /**
   * 주차 키 생성 (YYYY-WW 형식)
   * @param {Date} date - 날짜
   * @returns {string} 주차 키
   */
  getWeekKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    // ISO 주차 계산 (간단한 버전)
    const startOfYear = new Date(year, 0, 1);
    const days = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000));
    const week = Math.floor(days / 7) + 1;
    
    return `${year}-${month}-W${week}`;
  }

  /**
   * 게시물량 시트 생성
   * @param {ExcelJS.Workbook} workbook - 워크북 객체
   * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
   * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
   */
  async createVolumeSheet(workbook, startDate, endDate, projectId = null, reportConfig = null) {
    try {
      // 날짜 범위를 DateTime으로 변환
      const startDateTime = new Date(`${startDate}T00:00:00.000Z`);
      const endDateTime = new Date(`${endDate}T23:59:59.999Z`);
      
      // RawLog 테이블에서 데이터 조회 (전체 소스 합산)
      const rawLogs = query(
        'SELECT timestamp FROM RawLog WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC',
        [startDateTime.toISOString(), endDateTime.toISOString()]
      );
      
      // 시간대별 집계
      const volumeMap = {};
      rawLogs.forEach(log => {
        const logDate = new Date(log.timestamp);
        const dateKey = logDate.toISOString().split('T')[0]; // YYYY-MM-DD
        const hour = logDate.getHours(); // 0~23
        
        const key = `${dateKey}-${hour}`;
        if (!volumeMap[key]) {
          volumeMap[key] = 0;
        }
        volumeMap[key]++;
      });
      
      // 시트 생성
      const volumeSheet = workbook.addWorksheet('게시물량');
      
      // 스타일 정의
      const borderStyle = {
        style: 'thin',
        color: { argb: 'FF000000' }
      };
      
      const headerFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' } // 회색 배경
      };
      
      let currentRow = 1;
      
      // Row 1: 빈 행
      currentRow++;
      
      // Row 2: "PUBG PC 시간대별 게시물 등록량" 헤더 (B2:D2 병합)
      volumeSheet.getCell(currentRow, 2).value = 'PUBG PC 시간대별 게시물 등록량';
      volumeSheet.getCell(currentRow, 2).font = { bold: true, size: 12 };
      volumeSheet.getCell(currentRow, 2).fill = headerFill;
      volumeSheet.getCell(currentRow, 2).border = {
        top: borderStyle,
        left: borderStyle,
        bottom: borderStyle,
        right: borderStyle
      };
      volumeSheet.getCell(currentRow, 2).alignment = { horizontal: 'center', vertical: 'middle' };
      volumeSheet.mergeCells(currentRow, 2, currentRow, 4);
      currentRow++;
      
      // Row 3: 빈 행
      currentRow++;
      
      // Row 4: 메인 헤더
      const headerRow = volumeSheet.getRow(currentRow);
      const headerLabels = ['날짜', '시간', '게시물 량'];
      
      headerLabels.forEach((label, idx) => {
        const cell = headerRow.getCell(idx + 2); // B열부터 시작
        cell.value = label;
        cell.font = { bold: true };
        cell.fill = headerFill;
        cell.border = {
          top: borderStyle,
          left: borderStyle,
          bottom: borderStyle,
          right: borderStyle
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      currentRow++;
      
      // 날짜 범위 생성 (모든 날짜)
      const dates = [];
      const currentDate = new Date(startDateTime);
      while (currentDate <= endDateTime) {
        dates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      // 데이터 행 작성 (모든 날짜와 모든 시간)
      dates.forEach(date => {
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        
        // 0시부터 23시까지 모든 시간대 출력
        for (let hour = 0; hour < 24; hour++) {
          const dataRow = volumeSheet.getRow(currentRow);
          
          // 날짜 (B열)
          dataRow.getCell(2).value = dateStr;
          dataRow.getCell(2).border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          dataRow.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
          
          // 시간 (C열) - "0:00", "1:00" 형식
          const timeStr = `${hour}:00`;
          dataRow.getCell(3).value = timeStr;
          dataRow.getCell(3).border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          dataRow.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
          
          // 게시물 량 (D열) - 집계된 카운트 또는 0
          const key = `${dateStr}-${hour}`;
          const count = volumeMap[key] || 0;
          dataRow.getCell(4).value = count;
          dataRow.getCell(4).numFmt = '#,##0';
          dataRow.getCell(4).border = {
            top: borderStyle,
            left: borderStyle,
            bottom: borderStyle,
            right: borderStyle
          };
          dataRow.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
          
          currentRow++;
        }
      });
      
      // 열 너비 설정
      volumeSheet.getColumn(1).width = 5; // A열 (빈 열)
      volumeSheet.getColumn(2).width = 15; // 날짜
      volumeSheet.getColumn(3).width = 10; // 시간
      volumeSheet.getColumn(4).width = 15; // 게시물 량
      
      logger.info('Volume sheet created', { 
        dateRange: `${startDate} ~ ${endDate}`,
        totalLogs: rawLogs.length,
        totalRows: dates.length * 24
      });
    } catch (error) {
      logger.error('Failed to create Volume sheet', {
        error: error.message,
        stack: error.stack,
        startDate,
        endDate
      });
      throw error;
    }
  }
}

module.exports = new ExcelReportService();

