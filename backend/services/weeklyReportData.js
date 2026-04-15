/**
 * WeeklyReportData: 주간보고서에 필요한 모든 수치·요약문을 담는 중간 JSON 객체
 *
 * - WEEKLY_REPORT_GENERATION_SPEC.md 및 샘플 엑셀에 필요한 데이터만 포함
 * - R8/R13(PC), R9/R11(Mobile) 요약문은 AI가 줄바꿈(\n) 포함 순수 문자열로 생성
 * - 엑셀 생성 함수는 이 객체만 인자로 받아 셀 값 + 스타일만 적용
 *
 * @typedef {Object} WeeklyReportData
 * @property {Object} meta - 공통 메타
 * @property {string} meta.startDate - YYYY-MM-DD
 * @property {string} meta.endDate - YYYY-MM-DD
 * @property {number} meta.projectId - 1: PC, 2: Mobile
 * @property {string} meta.mainSheetName - 예: "1월 4주차"
 * @property {string} meta.prevSheetName - 예: "1월 3주차"
 * @property {string} meta.prevWeekStart - YYYY-MM-DD
 * @property {string} meta.prevWeekEnd - YYYY-MM-DD
 * @property {string} meta.platformLabel - "PUBG PC" | "PUBG MOBILE"
 * @property {string} meta.dateRangeText - 예: "2025.01.20 ~ 2025.01.26"
 * @property {string} [meta.authorName] - 작성자 (템플릿 L4에서 읽음)
 * @property {number} [meta.dateCol] - 4행에서 날짜 기입 열 (기본 8)
 *
 * @property {Object} mainSheet - 메인 주차 시트
 * @property {string} mainSheet.b2Value - B2 셀 (시트명 + 일범위)
 * @property {string} [mainSheet.overallSummary] - PC R6: 전반적인 동향 (줄바꿈 \n 가능)
 * @property {string} [mainSheet.bestTrendsText] - PC R8: 최고의 동향 (줄바꿈 \n 포함 순수 문자열)
 * @property {string} [mainSheet.worstTrendsText] - PC R13: 최악의 동향 (줄바꿈 \n 포함 순수 문자열)
 * @property {string} [mainSheet.negSummaryText] - Mobile R9: 주간 부정 동향 요약 (\n 포함 가능)
 * @property {string} [mainSheet.posSummaryText] - Mobile R11: 주간 긍정 동향 요약 (\n 포함 가능)
 * @property {string} [mainSheet.negCountText] - Mobile R13: "부정 동향 (N건)"
 * @property {Array<[number,string]>} [mainSheet.sectionTitles] - Mobile: [[5,'■ 주간 동향 수'], ...]
 * @property {Object} [mainSheet.mainCountBlocks] - Mobile: 성향별/이슈별 주간 동향 수
 * @property {string} mainSheet.mainCountBlocks.prevLabel
 * @property {string} mainSheet.mainCountBlocks.currLabel
 * @property {{ pos: number, neg: number, neu: number }} mainSheet.mainCountBlocks.prevSentiment
 * @property {{ pos: number, neg: number, neu: number }} mainSheet.mainCountBlocks.currSentiment
 * @property {Object} mainSheet.mainCountBlocks.prevIssueCounts - gameplay, paid, bug, ...
 * @property {Object} mainSheet.mainCountBlocks.currIssueCounts
 * @property {Object} mainSheet.trendTable - 인게임/커뮤니티 동향 테이블
 * @property {number} mainSheet.trendTable.dataStartRow
 * @property {Array<{ rowType: 'section'|'header'|'topic'|'data', text?: string, cells?: string[] }>} mainSheet.trendTable.rows
 * @property {boolean} mainSheet.trendTable.isPc - PC면 병합(D:E, F:P) 적용
 *
 * @property {Object} issueDeltaSheet - 주요 이슈 건수 증감
 * @property {number} issueDeltaSheet.prevTotal
 * @property {number} issueDeltaSheet.currTotal
 * @property {Array<{ rank: number, title: string, summary: string, prev: number, curr: number, prevRate: number, currRate: number, diff: number, diffRate: number }>} issueDeltaSheet.rows
 *
 * @property {Object} sharedIssueSheet - 공유 이슈 시간 순
 * @property {number} sharedIssueSheet.count
 * @property {Array<{ line: string }>} sharedIssueSheet.rows
 *
 * @property {Object} vocSheet - VoC 시트
 * @property {Array<Object>} vocSheet.rows - VoC 행 배열 (날짜, 출처, 대분류, 중분류, ...)
 * @property {{ total: number, uniqueGroups: number, uniqueCats: number }} vocSheet.summaryRow - 6행 21~23열
 *
 * @property {Array<Object>} [communitySheet] - PC 커뮤니티 일반 시트용 VoC 행 (mainSheet와 동일 정렬)
 */

const logger = require('../utils/logger');
const PROJECT_IDS = { PC: 1, MOBILE: 2 };

/**
 * 일일보고서 엑셀 + 기간으로 WeeklyReportData 객체 생성 (최우선 로직)
 * - 모든 원천 데이터 분석, AI 요약(R8/R13 등)은 \n 포함 순수 문자열로 생성
 *
 * @param {Object} service - weeklyReport.service 인스턴스 (parseExcelData, AI 요약 등 호출용)
 * @param {import('exceljs').Workbook} dailyWb - 이미 로드된 일일보고서 워크북
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {number} projectId - 1: PC, 2: Mobile
 * @returns {Promise<WeeklyReportData>}
 */
async function buildWeeklyReportData(service, dailyWb, startDate, endDate, projectId) {
  const { prevWeekStart, prevWeekEnd } = service.calculatePreviousWeek(startDate, endDate);
  const currentWeekData = await service.parseExcelData(dailyWb, startDate, endDate, projectId);
  const prevWeekData = await service.parseExcelData(dailyWb, prevWeekStart, prevWeekEnd, projectId);

  const mainSheetName = service.formatMainWeekSheetName(startDate);
  const prevSheetName = service.formatMainWeekSheetName(prevWeekStart);
  const toTemplateDate = (d) => {
    const s = String(d).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '.');
    return s;
  };
  const dateRangeText = `${toTemplateDate(startDate)} ~ ${toTemplateDate(endDate)}`;
  const platformLabel = projectId === PROJECT_IDS.MOBILE ? 'PUBG MOBILE' : 'PUBG PC';

  const voc = currentWeekData.voc || [];
  const issues = currentWeekData.issues || [];
  const prevVoc = prevWeekData.voc || [];
  const negVoc = voc.filter(v => String(v.sentiment || '').includes('부정'));
  const posVoc = voc.filter(v => String(v.sentiment || '').includes('긍정'));

  const meta = {
    startDate,
    endDate,
    projectId,
    mainSheetName,
    prevSheetName,
    prevWeekStart,
    prevWeekEnd,
    platformLabel,
    dateRangeText,
    authorName: '',
    dateCol: 8
  };

  const mainSheet = {
    b2Value: `${mainSheetName} (${new Date(startDate + 'T00:00:00.000Z').getUTCDate()}일~${new Date(endDate + 'T00:00:00.000Z').getUTCDate()}일)`,
    trendTable: { dataStartRow: projectId === PROJECT_IDS.MOBILE ? 15 : 24, rows: [], isPc: projectId === PROJECT_IDS.PC }
  };

  if (projectId === PROJECT_IDS.MOBILE) {
    mainSheet.sectionTitles = [
      [5, '■ 주간 동향 수'],
      [8, '■ 주간 부정 동향 요약'],
      [10, '■ 주간 긍정 동향 요약'],
      [12, '■ 커뮤니티 주요 동향']
    ];
    const { negSummary, posSummary } = await service.summarizeMobileNegPos({
      startDate,
      endDate,
      negVoc,
      posVoc
    });
    mainSheet.negSummaryText = typeof negSummary === 'string' ? negSummary : String(negSummary || '');
    mainSheet.posSummaryText = typeof posSummary === 'string' ? posSummary : String(posSummary || '');
    mainSheet.negCountText = `부정 동향 (${negVoc.length}건)`;
    mainSheet.mainCountBlocks = buildMobileMainCountBlocks(service, mainSheetName, prevSheetName, voc, prevVoc, projectId);
  } else {
    const overall = await service.summarizeWeeklySentiment({
      startDate,
      endDate,
      negVoc,
      posVoc
    });
    mainSheet.overallSummary = String(overall || '');
    const { bestLines, worstLines } = service.buildKeyTrendsFromIssuesOrVoc(issues, voc);
    mainSheet.bestTrendsText = Array.isArray(bestLines) ? bestLines.join('\n') : String(bestLines || '');
    mainSheet.worstTrendsText = Array.isArray(worstLines) ? worstLines.join('\n') : String(worstLines || '');
  }

  mainSheet.trendTable = buildTrendTableStructure(service, voc, projectId);

  const issueDeltaSheet = buildIssueDeltaSheet(service, voc, prevVoc, projectId);
  const sharedIssueSheet = buildSharedIssueSheet(service, issues);
  const vocSheet = buildVocSheetData(service, voc, projectId);

  return {
    meta,
    mainSheet,
    issueDeltaSheet,
    sharedIssueSheet,
    vocSheet,
    communitySheet: projectId === PROJECT_IDS.PC ? vocSheet.rows : undefined
  };
}

function buildMobileMainCountBlocks(service, currentLabel, prevLabel, currentVoc, prevVoc, projectId) {
  const pid = projectId === undefined ? PROJECT_IDS.MOBILE : projectId;
  const countSent = (arr) => {
    const list = Array.isArray(arr) ? arr : [];
    return {
      pos: list.filter(v => String(v.sentiment || '').includes('긍정')).length,
      neg: list.filter(v => String(v.sentiment || '').includes('부정')).length,
      neu: list.filter(v => String(v.sentiment || '').includes('중립')).length
    };
  };
  const bucket = (v) => {
    const n = service.normalizeCategoryForTemplate(pid, v.categoryGroup, v.category);
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
    const out = { gameplay: 0, paid: 0, bug: 0, server: 0, restriction: 0, cheat: 0, manner: 0, community: 0 };
    (Array.isArray(arr) ? arr : []).forEach(v => {
      const k = bucket(v);
      out[k] = (out[k] || 0) + 1;
    });
    return out;
  };
  return {
    prevLabel,
    currLabel: currentLabel,
    prevSentiment: countSent(prevVoc),
    currSentiment: countSent(currentVoc),
    prevIssueCounts: countIssues(prevVoc),
    currIssueCounts: countIssues(currentVoc)
  };
}

function buildTrendTableStructure(service, voc, projectId) {
  const pid = projectId === undefined ? PROJECT_IDS.MOBILE : projectId;
  const norm = (s) => (s ? String(s).trim() : '');
  const uniqueVoc = [];
  const seen = new Set();
  (Array.isArray(voc) ? voc : []).forEach(v => {
    const key = `${v.date}|${(v.content || '').substring(0, 80)}|${v.source}|${v.categoryGroup}|${v.category}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueVoc.push(v);
    }
  });
  uniqueVoc.sort((a, b) => {
    const na = service.normalizeCategoryForTemplate(projectId, a.categoryGroup, a.category);
    const nb = service.normalizeCategoryForTemplate(projectId, b.categoryGroup, b.category);
    const cg = (na.categoryGroup || '').localeCompare(nb.categoryGroup || '');
    if (cg !== 0) return cg;
    const cat = (na.category || '').localeCompare(nb.category || '');
    if (cat !== 0) return cat;
    return new Date(b.date) - new Date(a.date);
  });

  const dataStartRow = projectId === PROJECT_IDS.MOBILE ? 15 : 24;
  const rows = [];
  const MAX_ROWS = 500;

  if (projectId === PROJECT_IDS.MOBILE) {
    const groupMap = new Map();
    uniqueVoc.forEach(v => {
      const n = service.normalizeCategoryForTemplate(projectId, v.categoryGroup, v.category);
      const cg = norm(n.categoryGroup) || '기타 동향';
      const c = norm(n.category) || '기타';
      const key = `${cg}|||${c}`;
      if (!groupMap.has(key)) groupMap.set(key, { categoryGroup: cg, category: c, count: 0 });
      groupMap.get(key).count += 1;
    });
    const groups = Array.from(groupMap.values()).sort((a, b) => b.count - a.count).slice(0, MAX_ROWS);
    groups.forEach(g => {
      const bTitle = /\(\d+건\)/.test(g.categoryGroup) ? g.categoryGroup : `${g.categoryGroup} (${g.count}건)`;
      const cTitle = /\(\d+건\)/.test(g.category) ? g.category : `${g.category} (${g.count}건)`;
      rows.push({ rowType: 'data', cells: [bTitle, cTitle] });
    });
  } else {
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
    const assignPcTrendSection = (categoryGroup, category) => {
      const cg = String(categoryGroup || '').replace(/콘텐츠/g, '컨텐츠').trim();
      const cat = String(category || '').replace(/콘텐츠/g, '컨텐츠').trim();
      const match분류 = (list) => Array.isArray(list) && list.some(kw => kw && cg.includes(kw));
      const match주제 = (list) => Array.isArray(list) && list.some(kw => kw && (cat === kw || cat.includes(kw)));
      const topicSections = PC_TREND_SECTION_ORDER.filter(s => s.주제 && !s.주제제외);
      for (const s of topicSections) {
        if (match분류(s.분류) && match주제(s.주제)) return s.key;
      }
      if (match분류(['컨텐츠'])) return 'content';
      const 분류Only = PC_TREND_SECTION_ORDER.filter(s => !s.주제 && !s.주제제외);
      for (const s of 분류Only) {
        if (match분류(s.분류)) return s.key;
      }
      return 'content';
    };
    const sectionBuckets = {};
    PC_TREND_SECTION_ORDER.forEach(s => { sectionBuckets[s.key] = []; });
    uniqueVoc.forEach(v => {
      const n = service.normalizeCategoryForTemplate(projectId, v.categoryGroup, v.category);
      const key = assignPcTrendSection(n.categoryGroup, n.category);
      if (sectionBuckets[key]) sectionBuckets[key].push({ ...v, categoryGroup: n.categoryGroup, category: n.category });
    });
    PC_TREND_SECTION_ORDER.forEach(s => {
      (sectionBuckets[s.key] || []).sort((a, b) => {
        const ca = (a.category || '').localeCompare(b.category || '');
        if (ca !== 0) return ca;
        return new Date(b.date) - new Date(a.date);
      });
    });

    rows.push({ rowType: 'header', cells: ['분류', '플랫폼', '주제'] });
    const truncate = (s, max = 200) => (!s ? '' : String(s).length > max ? `${String(s).slice(0, max)}…` : String(s));
    const sanitize = (s) => {
      const t = norm(s);
      return t.length > 30 ? '기타' : t || '-';
    };
    PC_TREND_SECTION_ORDER.forEach(section => {
      const list = (sectionBuckets[section.key] || []).slice(0, MAX_ROWS);
      if (list.length === 0) return;
      rows.push({ rowType: 'section', text: section.title });
      let prevTopic = null;
      list.forEach(v => {
        const currentTopic = sanitize(v.category);
        if (prevTopic !== currentTopic) {
          rows.push({ rowType: 'topic', text: `【 주제: ${currentTopic} 】` });
          prevTopic = currentTopic;
        }
        const content = truncate(norm(v.content));
        const platform = norm(v.platform) || norm(v.source) || 'Steam';
        const link = Array.isArray(v.postUrls) && v.postUrls[0] ? (typeof v.postUrls[0] === 'object' && v.postUrls[0].url ? v.postUrls[0].url : String(v.postUrls[0])) : '';
        rows.push({
          rowType: 'data',
          cells: [norm(v.categoryGroup) || '-', platform, sanitize(v.category), content, link]
        });
      });
    });
  }

  return { dataStartRow, rows, isPc: projectId === PROJECT_IDS.PC };
}

function buildIssueDeltaSheet(service, currentVoc, prevVoc, projectId) {
  const pid = projectId === undefined ? PROJECT_IDS.MOBILE : projectId;
  const countBy = (arr) => {
    const m = new Map();
    (Array.isArray(arr) ? arr : []).forEach(v => {
      const n = service.normalizeCategoryForTemplate(pid, v.categoryGroup, v.category);
      const cg = String(n.categoryGroup || '').trim() || '기타';
      m.set(cg, (m.get(cg) || 0) + 1);
    });
    return m;
  };
  const prevMap = countBy(prevVoc);
  const currMap = countBy(currentVoc);
  const prevTotal = (Array.isArray(prevVoc) ? prevVoc.length : 0) || 1;
  const currTotal = (Array.isArray(currentVoc) ? currentVoc.length : 0) || 1;
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
  const keys = Array.from(new Set([...prevMap.keys(), ...currMap.keys()]));
  const rows = keys
    .map(k => {
      const prev = prevMap.get(k) || 0;
      const curr = currMap.get(k) || 0;
      const prevRate = prev / prevTotal;
      const currRate = curr / currTotal;
      return { k, prev, curr, prevRate, currRate, diff: curr - prev, diffRate: currRate - prevRate };
    })
    .sort((a, b) => b.curr - a.curr)
    .slice(0, 20)
    .map((it, idx) => {
      const mapped = labelMap(it.k);
      return {
        rank: idx + 1,
        title: mapped.title,
        summary: mapped.summary,
        prev: it.prev,
        curr: it.curr,
        prevRate: it.prevRate,
        currRate: it.currRate,
        diff: it.diff,
        diffRate: it.diffRate
      };
    });
  return { prevTotal: Array.isArray(prevVoc) ? prevVoc.length : 0, currTotal: Array.isArray(currentVoc) ? currentVoc.length : 0, rows };
}

function buildSharedIssueSheet(service, issues) {
  const list = (Array.isArray(issues) ? issues : [])
    .filter(i => i && (i.summary || i.detail))
    .sort((a, b) => {
      const at = a.shareTime instanceof Date && !isNaN(a.shareTime.getTime()) ? a.shareTime.getTime() : 0;
      const bt = b.shareTime instanceof Date && !isNaN(b.shareTime.getTime()) ? b.shareTime.getTime() : 0;
      return bt - at;
    });
  const rows = list.map(i => {
    const title = String(i.summary || i.detail || '').trim();
    const datePart = i.date ? i.date.slice(5).replace('-', '/') : '';
    const timePart = i.shareTime instanceof Date && !isNaN(i.shareTime.getTime()) ? i.shareTime.toISOString().slice(11, 16) : '';
    const method = String(i.shareMethod || '').trim();
    return { line: `${title} - (${datePart}${timePart ? ' ' + timePart : ''}${method ? ' / ' + method : ''})` };
  });
  return { count: rows.length, rows };
}

function buildVocSheetData(service, voc, projectId) {
  const pid = projectId === undefined ? PROJECT_IDS.MOBILE : projectId;
  const filtered = Array.isArray(voc) ? voc : [];
  const sorted = [...filtered].sort((a, b) => {
    const na = service.normalizeCategoryForTemplate(pid, a.categoryGroup, a.category);
    const nb = service.normalizeCategoryForTemplate(pid, b.categoryGroup, b.category);
    const cg = (na.categoryGroup || '').localeCompare(nb.categoryGroup || '');
    if (cg !== 0) return cg;
    const cat = (na.category || '').localeCompare(nb.category || '');
    if (cat !== 0) return cat;
    return String(b.date || '').localeCompare(String(a.date || ''));
  });
  const uniqueGroups = new Set(sorted.map(v => service.normalizeCategoryForTemplate(pid, v.categoryGroup, v.category).categoryGroup).filter(Boolean));
  const uniqueCats = new Set(sorted.map(v => service.normalizeCategoryForTemplate(pid, v.categoryGroup, v.category).category).filter(Boolean));
  const rows = sorted.map(v => ({
    date: v.date,
    source: v.source || v.platform,
    categoryGroup: service.normalizeCategoryForTemplate(pid, v.categoryGroup, v.category).categoryGroup,
    category: service.normalizeCategoryForTemplate(pid, v.categoryGroup, v.category).category,
    type: v.type,
    sentiment: v.sentiment,
    importance: v.importance,
    content: v.content,
    postUrls: Array.isArray(v.postUrls) ? v.postUrls : []
  }));
  return {
    rows,
    summaryRow: { total: filtered.length, uniqueGroups: uniqueGroups.size, uniqueCats: uniqueCats.size }
  };
}

module.exports = {
  buildWeeklyReportData,
  PROJECT_IDS
};
