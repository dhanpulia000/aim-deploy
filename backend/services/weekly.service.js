// Weekly Reports 서비스

const { query, queryOne, execute, executeTransaction, safeQuery } = require('../libs/db');
const { getWeekRange } = require('../utils/dates.util');
const logger = require('../utils/logger');

/**
 * 주간 보고서 생성
 * @param {string} agentId - 에이전트 ID
 * @param {Object} options - 생성 옵션
 * @returns {Promise<Object>} 생성된 주간 보고서
 */
async function generateWeeklyReport(agentId, options = {}) {
  const {
    startDate,
    endDate,
    reportType = 'pc',
    includeVOC = true,
    includeIssues = true,
    includeData = true
  } = options;
  
  try {
    // 날짜 범위 설정 (입력값을 로컬 YYYY-MM-DD로 정규화)
    const toYmd = (d) => {
      if (!d) return '';
      if (typeof d === 'number') return d; // not expected here
      if (typeof d === 'string') {
        if (d.includes('T')) {
          const dt = new Date(d);
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, '0');
          const da = String(dt.getDate()).padStart(2, '0');
          return `${y}-${m}-${da}`;
        }
        return d;
      }
      if (d instanceof Date) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${da}`;
      }
      return '';
    };
    const weekRange = startDate && endDate ? 
      { start: toYmd(startDate), end: toYmd(endDate) } : 
      getWeekRange();
    
    logger.info('Generating weekly report', { 
      agentId, 
      startDate: weekRange.start, 
      endDate: weekRange.end 
    });
    
    // 해당 기간의 보고서들 조회
    const reports = query(
      'SELECT * FROM Report WHERE agentId = ? AND status = ? ORDER BY date ASC',
      [agentId, 'processed']
    );
    
    // 각 보고서의 아이템들 조회
    const reportIds = reports.map(r => r.id);
    let vocItems = [];
    let issueItems = [];
    let dataItems = [];
    
    if (reportIds.length > 0) {
      const placeholders = reportIds.map(() => '?').join(',');
      if (includeVOC) {
        vocItems = query(
          `SELECT * FROM ReportItemVOC WHERE reportId IN (${placeholders}) AND date >= ? AND date <= ?`,
          [...reportIds, weekRange.start, weekRange.end]
        );
      }
      if (includeIssues) {
        issueItems = query(
          `SELECT * FROM ReportItemIssue WHERE reportId IN (${placeholders}) AND date >= ? AND date <= ?`,
          [...reportIds, weekRange.start, weekRange.end]
        );
      }
      if (includeData) {
        dataItems = query(
          `SELECT * FROM ReportItemData WHERE reportId IN (${placeholders}) AND date >= ? AND date <= ?`,
          [...reportIds, weekRange.start, weekRange.end]
        );
      }
    }
    
    // 아이템들을 보고서별로 그룹화
    const vocByReport = {};
    const issueByReport = {};
    const dataByReport = {};
    
    vocItems.forEach(item => {
      if (!vocByReport[item.reportId]) vocByReport[item.reportId] = [];
      vocByReport[item.reportId].push(item);
    });
    issueItems.forEach(item => {
      if (!issueByReport[item.reportId]) issueByReport[item.reportId] = [];
      issueByReport[item.reportId].push(item);
    });
    dataItems.forEach(item => {
      if (!dataByReport[item.reportId]) dataByReport[item.reportId] = [];
      dataByReport[item.reportId].push(item);
    });
    
    // 보고서에 아이템들 연결
    const reportsWithItems = reports.map(report => ({
      ...report,
      vocItems: vocByReport[report.id] || [],
      issueItems: issueByReport[report.id] || [],
      dataItems: dataByReport[report.id] || []
    })).filter(report => {
      // OR 조건: vocItems, issueItems, dataItems 중 하나라도 있으면 포함
      return (report.vocItems.length > 0 || report.issueItems.length > 0 || report.dataItems.length > 0);
    });
    
    if (reports.length === 0) {
      throw new Error('No reports found for the specified period');
    }
    
    // 주간 보고서 데이터 집계
    const weeklyData = aggregateWeeklyData(reports, weekRange);
    
    // 주간 보고서 생성
    const weeklyReport = executeTransaction(() => {
      const { nanoid } = require('nanoid');
      const reportId = nanoid();
      const now = new Date().toISOString();
      
      execute(
        `INSERT INTO WeeklyReport (id, agentId, reportType, period, startDate, endDate, dailyReportCount, status, trends, charts, majorIssueStats, vocData, dataSheet, dailyReports, createdAt, updatedAt) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reportId,
          agentId,
          reportType,
          `${weekRange.start}~${weekRange.end}`,
          weekRange.start,
          weekRange.end,
          reportsWithItems.length,
          'completed',
          JSON.stringify({ 
            sentimentStats: weeklyData.sentimentStats,
            sharedIssues: weeklyData.sharedIssues
          }),
          JSON.stringify({ 
            sentimentStats: weeklyData.sentimentStats, 
            issueStats: weeklyData.issueStats 
          }),
          JSON.stringify(weeklyData.majorIssueStats),
          JSON.stringify(weeklyData.vocList),
          JSON.stringify(weeklyData.dataList),
          JSON.stringify(weeklyData.dailyList),
          now,
          now
        ]
      );
      
      return queryOne('SELECT * FROM WeeklyReport WHERE id = ?', [reportId]);
    });
    
    logger.info('Weekly report generated', { 
      reportId: weeklyReport.id, 
      agentId,
      reportCount: reports.length 
    });
    
    return weeklyReport;
  } catch (error) {
    logger.error('Weekly report generation failed', { 
      error: error.message, 
      agentId 
    });
    throw error;
  }
}

/**
 * 주간 보고서 데이터 집계
 * @param {Array} reports - 보고서 배열
 * @returns {Object} 집계된 데이터
 */
function aggregateWeeklyData(reports, weekRange) {
  const inRange = (d) => {
    if (d === undefined || d === null || d === '') return false;
    let ymd = '';
    if (typeof d === 'number') {
      const iso = excelDateToISOString(d);
      ymd = iso ? iso.slice(0, 10) : '';
    } else if (d instanceof Date) {
      ymd = d.toISOString().slice(0, 10);
    } else {
      ymd = String(d).trim().slice(0, 10);
    }
    return ymd >= weekRange.start && ymd <= weekRange.end;
  };
  const aggregated = {
    totalReports: reports.length,
    // sheets data
    vocList: [],
    dataList: [],
    dailyList: [],
    // charts/stats
    sentimentStats: { 긍정: 0, 부정: 0, 중립: 0 },
    issueStats: {},
    majorIssueStats: {},
    sharedIssues: []
  };
  
  reports.forEach(report => {
    const date = report.date;
    
    // VOC 데이터 집계 및 리스트
    if (report.vocItems) {
      report.vocItems.filter(v => inRange(v.date)).forEach(voc => {
        const s = String(voc.sentiment || '').toLowerCase();
        const sentiment = s.includes('부정') || s.includes('neg') ? '부정'
                         : s.includes('긍정') || s.includes('pos') ? '긍정'
                         : '중립';
        // 링크 후보 수집 (파서가 links 배열을 저장하지 않았을 경우 대비)
        const urlRegex = /(https?:\/\/|mcps:\/\/)[^\s]+/i;
        const linkCandidates = [];
        const tryPush = (v) => { if (v && urlRegex.test(String(v))) linkCandidates.push(String(v)); };
        if (Array.isArray(voc.links)) linkCandidates.push(...voc.links);
        tryPush(voc.link); tryPush(voc.uri); tryPush(voc.url); tryPush(voc.postUrl); tryPush(voc.firstPost);
        // extraField14..extraField23까지 스캔
        for (let i = 14; i <= 23; i++) {
          const key = `extraField${i}`;
          if (voc[key]) tryPush(voc[key]);
        }
        const uniqueLinks = Array.from(new Set(linkCandidates));
        aggregated.sentimentStats[sentiment] = (aggregated.sentimentStats[sentiment] || 0) + 1;
        aggregated.vocList.push({
          date: voc.date || '',
          source: voc.source || '',
          category: voc.category || '',
          subcategory: voc.subcategory || '',
          type: voc.type || '',
          sentiment,
          severity: voc.severity ?? '',
          content: voc.content || voc.title || '',
          judgment: voc.judgment || '',
          working: voc.working || '',
          remarks: voc.remarks || '',
          link: voc.link || voc.uri || '',
          links: uniqueLinks
        });
      });
    }
    
    // Issue 데이터 집계
    if (report.issueItems) {
      report.issueItems.filter(i => inRange(i.date)).forEach(issue => {
        const cat = issue.category || '기타';
        aggregated.issueStats[cat] = (aggregated.issueStats[cat] || 0) + 1;
        // 주요이슈 간단 집계
        aggregated.majorIssueStats[cat] = (aggregated.majorIssueStats[cat] || 0) + 1;
        // 공유이슈 후보: severity <= 2
        const sev = Number(issue.severity);
        if (!isNaN(sev) && sev <= 2) {
          aggregated.sharedIssues.push({
            title: issue.title || issue.summary || issue.content || '(제목 없음)',
            date: issue.date || '',
            status: '공유 완료'
          });
        }
      });
    }
    
    // Data 데이터 집계 및 리스트
    if (report.dataItems) {
      report.dataItems.filter(dt => inRange(dt.date)).forEach(data => {
        aggregated.dataList.push({
          weekType: data.weekType || data.week || '',
          date: data.date || '',
          author: data.author || '',
          communityIssues: data.communityIssues || data.issues || '',
          shared: data.shared || '',
          requests: data.requests || '',
          notes: data.notes || data.remarks || ''
        });
      });
    }
    
    // 일별 세부사항
    aggregated.dailyList.push({
      date,
      reportId: report.id,
      vocCount: (report.vocItems || []).filter(v => inRange(v.date)).length,
      issueCount: (report.issueItems || []).filter(i => inRange(i.date)).length,
      dataCount: (report.dataItems || []).filter(d => inRange(d.date)).length
    });
  });
  
  return aggregated;
}

/**
 * 에이전트별 주간 보고서 목록 조회
 * @param {string} agentId - 에이전트 ID
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Array>} 주간 보고서 목록
 */
async function getWeeklyReportsByAgent(agentId, options = {}) {
  const { limit = 10, offset = 0, orderBy = 'desc' } = options;
  
  return safeQuery(() => {
    const reports = query(
      `SELECT * FROM WeeklyReport WHERE agentId = ? ORDER BY createdAt ${orderBy === 'desc' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`,
      [agentId, limit, offset]
    );
    
    logger.info('Weekly reports retrieved', { agentId, count: reports.length });
    return reports;
  }, []);
}

/**
 * 주간 보고서 다운로드
 * @param {string} reportId - 보고서 ID
 * @returns {Promise<Object>} 다운로드 정보
 */
async function downloadWeeklyReport(reportId) {
  return safeQuery(() => {
    const report = queryOne('SELECT * FROM WeeklyReport WHERE id = ?', [reportId]);
    
    if (!report) {
      throw new Error('Weekly report not found');
    }
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();

    const parse = (str, fallback) => {
      if (!str) return fallback;
      try { return JSON.parse(str); } catch (_) { return fallback; }
    };
    const toArray = (val, key) => {
      if (Array.isArray(val)) return val;
      if (val && key && Array.isArray(val[key])) return val[key];
      return [];
    };

    const statistics = parse(report.statistics, {});
    const charts = parse(report.charts, {});
    const majorIssueStats = parse(report.majorIssueStats, {});
    const trends = parse(report.trends, {});
    const vocParsed = parse(report.vocData, []);
    const dataParsed = parse(report.dataSheet, []);
    const dailyParsed = parse(report.dailyReports, []);
    const vocList = toArray(vocParsed, 'voc');
    const dataList = toArray(dataParsed, 'data');
    toArray(dailyParsed, 'daily');

    // 1) 요약 시트
    const summaryRows = [
      ['보고서 ID', report.id],
      ['Agent', report.agentId],
      ['유형', report.reportType],
      ['기간', report.period],
      ['시작일', report.startDate],
      ['종료일', report.endDate],
      ['일일 보고서 수', report.dailyReportCount],
      ['상태', report.status],
      ['생성시각', String(report.createdAt || '')]
    ];
    if (statistics && Object.keys(statistics).length) {
      summaryRows.push(['']);
      summaryRows.push(['통계']);
      for (const [k, v] of Object.entries(statistics)) {
        summaryRows.push([k, typeof v === 'object' ? JSON.stringify(v) : v]);
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), '요약');

    // 2) 성향별 시트 (charts.sentimentStats 또는 trends 내 집계)
    const sentimentStats = charts?.sentimentStats || statistics?.sentimentStats || trends?.sentimentStats || {};
    const sentimentRows = [['항목', '값']];
    for (const [k, v] of Object.entries(sentimentStats)) sentimentRows.push([k, v]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sentimentRows), '성향별');

    // 3) 이슈별 시트 (charts.issueStats)
    const issueStats = charts?.issueStats || statistics?.issueStats || {};
    const issueRows = [['항목', '값']];
    for (const [k, v] of Object.entries(issueStats)) issueRows.push([k, v]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(issueRows), '이슈별');

    // 4) 주요이슈 시트
    const majorRows = [['항목', '건수']];
    for (const [k, v] of Object.entries(majorIssueStats)) majorRows.push([k, v]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(majorRows), '주요이슈');

    // 5) 공유이슈 시트
    const sharedIssuesParsed = Array.isArray(trends?.sharedIssues) ? trends.sharedIssues : parse(report.sharedIssues, []);
    const sharedIssues = toArray(sharedIssuesParsed, 'sharedIssues');
    const sharedHeader = ['제목', '날짜', '상태'];
    const sharedRows = [sharedHeader];
    for (const it of (sharedIssues || [])) {
      sharedRows.push([it.title || '', it.date || '', it.status || '']);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sharedRows), '공유이슈');

    const toYmd = (d) => {
      if (d === undefined || d === null || d === '') return '';
      if (typeof d === 'number') {
        const iso = excelDateToISOString(d);
        return iso ? iso.slice(0, 10) : '';
      }
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      const s = String(d);
      return s.includes('T') ? s.slice(0, 10) : s;
    };

    // 6) VoC 시트 - 지정된 열 순서
    const vocHeader = ['날짜','출처','대분류','중분류','종류','성향','중요도','내용','판단/확인사항','근무','비고'];
    // 게시물 주소 열 제목을 10개 동일하게 추가 (M~V)
    for (let i = 0; i < 10; i++) vocHeader.push('게시물 주소');
    const vocRows = [vocHeader];
    for (const v of vocList) {
      const row = [
        toYmd(v.date),
        v.source || '',
        v.category || '',
        v.subcategory || '',
        v.type || '',
        v.sentiment || '',
        v.severity ?? '',
        v.content || v.title || '',
        v.judgment || '',
        v.working || '',
        v.remarks || ''
      ];
      const linksArr = Array.isArray(v.links) ? v.links : (v.link ? [v.link] : []);
      for (let i = 0; i < 10; i++) {
        const it = linksArr[i];
        if (!it) { row.push(''); continue; }
        const url = typeof it === 'string' ? it : (it.url || '');
        const text = typeof it === 'string' ? it : (it.text || it.url || '');
        row.push(text);
      }
      vocRows.push(row);
    }
    const vocWs = XLSX.utils.aoa_to_sheet(vocRows);
    // 게시물 주소 열들에 하이퍼링크 주입 (12~21 컬럼)
    for (let r = 2; r <= vocRows.length; r++) {
      const vrow = vocList[r - 2] || {};
      const linksArr = Array.isArray(vrow.links) ? vrow.links : (vrow.link ? [vrow.link] : []);
      for (let i = 0; i < 10; i++) {
        const it = linksArr[i];
        const url = typeof it === 'string' ? it : (it?.url || '');
        if (!url) continue;
        const cellRef = XLSX.utils.encode_cell({ r: r - 1, c: 11 + i });
        const cell = vocWs[cellRef];
        if (cell) {
          cell.t = 'n';
          cell.l = { Target: url, Tooltip: `게시물 ${i + 1}` };
        }
      }
    }
    XLSX.utils.book_append_sheet(wb, vocWs, 'VoC');

    // 7) Data 시트 (가능한 필드 매핑)
    const dataHeader = ['주차','날짜','작성자','커뮤니티 이슈','공유','요청','비고'];
    const dataRows = [dataHeader];
    for (const d of dataList) {
      dataRows.push([
        d.weekType || d.week || '',
        toYmd(d.date),
        d.author || '',
        d.communityIssues || d.issues || '',
        d.shared || '',
        d.requests || '',
        d.notes || d.remarks || ''
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dataRows), 'Data');

    // 최종 파일 버퍼
    const fileBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `weekly_report_${report.startDate}_${report.endDate}.xlsx`;

    logger.info('Weekly report downloaded', { reportId, filename });

    return {
      buffer: fileBuffer,
      filename,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
  });
}

/**
 * 주간 보고서 삭제
 * @param {string} reportId - 보고서 ID
 * @returns {Promise<void>}
 */
async function deleteWeeklyReport(reportId) {
  return executeTransaction(() => {
    execute('DELETE FROM WeeklyReport WHERE id = ?', [reportId]);
    logger.info('Weekly report deleted', { reportId });
  });
}

/**
 * 주간 보고서 통계 조회
 * @param {string} agentId - 에이전트 ID
 * @returns {Promise<Object>} 주간 보고서 통계
 */
async function getWeeklyReportStatistics(agentId) {
  return safeQuery(() => {
    const totalResult = queryOne(
      'SELECT COUNT(*) as count FROM WeeklyReport WHERE agentId = ?',
      [agentId]
    );
    const totalReports = totalResult?.count || 0;
    
    const thisWeekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thisWeekResult = queryOne(
      'SELECT COUNT(*) as count FROM WeeklyReport WHERE agentId = ? AND createdAt >= ?',
      [agentId, thisWeekStart]
    );
    const thisWeekReports = thisWeekResult?.count || 0;
    
    const lastWeekStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const lastWeekEnd = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const lastWeekResult = queryOne(
      'SELECT COUNT(*) as count FROM WeeklyReport WHERE agentId = ? AND createdAt >= ? AND createdAt < ?',
      [agentId, lastWeekStart, lastWeekEnd]
    );
    const lastWeekReports = lastWeekResult?.count || 0;
    
    return {
      totalReports,
      thisWeekReports,
      lastWeekReports,
      trend: thisWeekReports > lastWeekReports ? 'up' : 
             thisWeekReports < lastWeekReports ? 'down' : 'stable'
    };
  }, {
    totalReports: 0,
    thisWeekReports: 0,
    lastWeekReports: 0,
    trend: 'stable'
  });
}

module.exports = {
  generateWeeklyReport,
  getWeeklyReportsByAgent,
  downloadWeeklyReport,
  deleteWeeklyReport,
  getWeeklyReportStatistics
};

