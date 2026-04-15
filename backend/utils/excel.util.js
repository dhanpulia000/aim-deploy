// Excel 관련 유틸리티 함수들

/**
 * Excel 날짜를 ISO 문자열로 변환
 * @param {number} excelSerial - Excel 시리얼 번호
 * @returns {string} ISO 날짜 문자열
 */
function excelDateToISOString(excelSerial) {
  if (!excelSerial || typeof excelSerial !== 'number') {
    return null;
  }
  // Excel 1900 date system: day 1 = 1899-12-31 (with the 1900 leap bug),
  // 관용적으로 1899-12-30을 기준으로 excelSerial 일수를 더하는 방식이 오프셋 문제를 줄임
  const baseUtc = Date.UTC(1899, 11, 30); // 1899-12-30
  const ms = baseUtc + excelSerial * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 유효한 날짜 셀인지 판별 (숫자 시리얼 또는 YYYY-MM-DD 문자열)
function isValidDateCell(val) {
  if (typeof val === 'number') return true;
  if (val instanceof Date) return true;
  if (typeof val === 'string') {
    const s = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
    // Excel에서 문자열로 들어온 날짜 (예: 2025/10/21)
    if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(s)) return true;
  }
  return false;
}

/**
 * 일일 보고서 파싱
 * @param {Array} data - Excel 데이터 배열
 * @returns {Object} 파싱된 일일 보고서 데이터
 */
function parseDailyReport(data) {
  // 일일 보고서 파싱 로직 (실제 데이터 구조에 맞게 수정 필요)
  return {
    totalIssues: data.length - 1, // 헤더 제외
    processedCount: 0,
    notes: '일일 보고서 데이터',
  };
}

/**
 * 이슈 정리 파싱
 * @param {Array} data - Excel 데이터 배열
 * @returns {Array} 파싱된 이슈 목록
 */
function parseIssueReport(data) {
  // 이슈 정리 파싱 로직
  return data.slice(1).map((row, index) => ({
    id: index + 1,
    title: row[0] || '',
    status: row[1] || '',
    assignee: row[2] || '',
  }));
}

/**
 * Mobile Data 시트 파싱 (SUMMARY DATA)
 * @param {Array} data - Excel 데이터 배열
 * @param {string} dateFilter - 날짜 필터
 * @returns {Array} 파싱된 모바일 데이터
 */
function parseMobileDataSheet(data, dateFilter) {
  // 기본 데이터 처리
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.log('Data 시트: 기본 데이터가 배열이 아님');
    return [];
  }
  
  console.log(`Data 시트 파싱 시작: 총 ${data.length}행`);
  
  // Data 시트 구조 (실제 구조 확인 필요):
  // Column A: 행번호 (index 0)
  // Column B: 구분/주차 (index 1) 
  // Column C: 날짜 (index 2)
  // Column D: 작성자 (index 3)
  // Column E: 커뮤니티 이슈 (index 4)
  // Column F: 공유 (index 5)
  // Column G: 요청 (index 6)
  // Column H: 비고 (index 7)
  
  // 첫 번째 샘플 로그
  console.log('Data 시트 샘플 (처음 5행):');
  for (let i = 0; i < Math.min(5, data.length); i++) {
    console.log(`  행${i}: A=${data[i][0]}, B=${data[i][1]}, C=${data[i][2]} (type: ${typeof data[i][2]}), D=${data[i][3]}`);
  }
  
  const validData = data.filter((row, index) => {
    // 헤더 행 제외 (첫 번째가 헤더라고 가정)
    if (index === 0) return false;
    
    // 필수 컬럼이 있는지 확인 (날짜와 작성자)
    const hasDate = row[2] !== undefined && row[2] !== null && row[2] !== '';
    // 작성자 없을 수도 있어 날짜만으로 허용
    return hasDate;
  });
  
  console.log(`Data 시트: 유효한 데이터 ${validData.length}행`);
  
  return validData.map((row, index) => {
    const dateValue = row[2];
    let dateStr = '';
    
    // 날짜 처리
    if (typeof dateValue === 'number') {
      // Excel 시리얼 번호인 경우
      dateStr = excelDateToISOString(dateValue);
    } else if (typeof dateValue === 'string') {
      // 문자열 날짜인 경우
      dateStr = dateValue;
    } else if (dateValue instanceof Date) {
      // Date 객체인 경우
      dateStr = dateValue.toISOString();
    }
    
    return {
      id: index + 1,
      rowNumber: row[0] || '',
      week: row[1] || '',
      weekType: row[1] || '',
      date: dateStr,
      author: row[3] || '',
      communityIssues: row[4] || '',
      shared: row[6] || row[5] || '',
      requests: row[6] || '',
      notes: row[7] || ''
    };
  });
}

/**
 * Mobile Cheat/Abuse 시트 파싱
 * @param {Array} data - Excel 데이터 배열
 * @returns {Array} 파싱된 치팅/어뷰즈 데이터
 */
function parseMobileCheatAbuseSheet(data) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.log('Cheat/Abuse 시트: 기본 데이터가 배열이 아님');
    return [];
  }
  
  console.log(`Cheat/Abuse 시트 파싱 시작: 총 ${data.length}행`);
  
  // 첫 번째 샘플 로그
  console.log('Cheat/Abuse 시트 샘플 (처음 5행):');
  for (let i = 0; i < Math.min(5, data.length); i++) {
    console.log(`  행${i}:`, data[i]);
  }
  
  const validData = data.filter((row, index) => {
    // 헤더 행 제외
    if (index === 0) return false;
    
    // 최소한의 데이터가 있는지 확인
    return row.some(cell => cell !== undefined && cell !== null && cell !== '');
  });
  
  console.log(`Cheat/Abuse 시트: 유효한 데이터 ${validData.length}행`);
  
  return validData.map((row, index) => ({
    id: index + 1,
    category: row[0] || '',
    description: row[1] || '',
    count: row[2] || 0,
    notes: row[3] || ''
  }));
}

/**
 * Mobile Issue 시트 파싱
 * @param {Array} data - Excel 데이터 배열
 * @param {string} dateFilter - 날짜 필터
 * @param {Object} links - 링크 정보
 * @returns {Array} 파싱된 이슈 데이터
 */
function parseMobileIssueSheet(data, dateFilter, links = {}) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.log('Issue 시트: 기본 데이터가 배열이 아님');
    return [];
  }
  
  console.log(`Issue 시트 파싱 시작: 총 ${data.length}행`);
  
  // 첫 번째 샘플 로그
  console.log('Issue 시트 샘플 (처음 5행):');
  for (let i = 0; i < Math.min(5, data.length); i++) {
    console.log(`  행${i}:`, data[i]);
  }
  
  const validData = data.filter((row, index) => {
    if (!row) return false;
    // 유효한 날짜(열 2)가 있는 행만 채택 (여러 헤더 라인 제거)
    const dateCell = row[2];
    return isValidDateCell(dateCell);
  });
  
  console.log(`Issue 시트: 유효한 데이터 ${validData.length}행`);
  
  return validData.map((row, index) => {
    // 실제 파일은 첫 열이 비어있고, 헤더가 한 칸씩 우측으로 치우친 형태
    // 헤더 샘플: [ <empty>, 'No', '날짜', '분류', '요약', '세부 내용', '최초게시물', '이슈확인시간', ... ]
    const get = (i) => (row[i] === undefined || row[i] === null) ? '' : row[i];
    const rawDate = get(2); // '날짜'
    let dateStr = '';
    if (typeof rawDate === 'number') dateStr = excelDateToISOString(rawDate);
    else if (rawDate instanceof Date) dateStr = rawDate.toISOString();
    else if (typeof rawDate === 'string') dateStr = rawDate.trim();

    return {
      id: index + 1,
      no: get(1),
      date: dateStr,
      category: String(get(3)).trim(),
      title: String(get(4)).trim(),
      detail: String(get(5)).trim(),
      firstPost: String(get(6)).trim(),
      confirmTime: get(7) || '',
      shareTime: get(8) || '',
      shareMethod: String(get(9)).trim(),
      receiver: String(get(10)).trim(),
      result: String(get(11)).trim(),
      remarks: String(get(12)).trim(),
      link: links[get(4)] || ''
    };
  });
}

/**
 * Mobile VOC 시트 파싱
 * @param {Array} data - Excel 데이터 배열
 * @param {string} dateFilter - 날짜 필터
 * @param {Object} links - 링크 정보
 * @returns {Array} 파싱된 VOC 데이터
 */
function parseMobileVOCSheet(data, dateFilter, links = {}) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.log('VOC 시트: 기본 데이터가 배열이 아님');
    return [];
  }
  
  console.log(`VOC 시트 파싱 시작: 총 ${data.length}행`);
  
  // 첫 번째 샘플 로그
  console.log('VOC 시트 샘플 (처음 5행):');
  for (let i = 0; i < Math.min(5, data.length); i++) {
    console.log(`  행${i}:`, data[i]);
  }
  
  const validData = data.filter((row) => {
    if (!row) return false;
    // 유효한 날짜(열 1)가 있는 행만 채택 (여러 헤더 라인 제거)
    const dateCell = row[1];
    return isValidDateCell(dateCell);
  });
  
  console.log(`VOC 시트: 유효한 데이터 ${validData.length}행`);
  
  return validData.map((row, index) => {
    // 헤더 샘플: [ <empty>, '날짜', '출처', '대분류', '중분류', '종류', '성향', '중요도', '내용', '판단 /  확인 사항', '근무 타입', '비고', ... ]
    const get = (i) => (row[i] === undefined || row[i] === null) ? '' : row[i];
    const rawDate = get(1);
    let dateStr = '';
    if (typeof rawDate === 'number') dateStr = excelDateToISOString(rawDate);
    else if (rawDate instanceof Date) dateStr = `${rawDate.getFullYear()}-${String(rawDate.getMonth()+1).padStart(2,'0')}-${String(rawDate.getDate()).padStart(2,'0')}`;
    else if (typeof rawDate === 'string') {
      const s = rawDate.trim();
      if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(s)) {
        const d = new Date(s);
        dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      } else {
        dateStr = s;
      }
    }

    const sourceRaw = String(get(2)).trim();
    const source = /naver/i.test(sourceRaw) ? 'naver' : 'system';
    const sentimentRaw = String(get(6)).trim();
    const sentiment = sentimentRaw.includes('부정') ? 'neg' : sentimentRaw.includes('긍정') ? 'pos' : 'neu';
    const importanceRaw = String(get(7)).trim();
    const severity = importanceRaw.includes('중') ? 2 : 3;

    // 게시물 주소들 수집: 우선 M(12)~V(21), 없으면 모든 셀에서 URL 패턴 스캔
    const linkColsStart = 12;
    const linkColsEnd = 21;
    let linksArr = [];
    for (let c = linkColsStart; c <= linkColsEnd; c++) {
      const val = String(get(c)).trim();
      if (val) linksArr.push(val);
    }
    if (linksArr.length === 0) {
      const urlRegex = /(https?:\/\/|mcps:\/\/)[^\s]+/i;
      linksArr = (row || [])
        .map(cell => (typeof cell === 'string' ? cell : ''))
        .filter(s => urlRegex.test(s));
    }
    // 중복 제거
    linksArr = Array.from(new Set(linksArr));

    return {
      id: index + 1,
      date: dateStr,
      source,
      category: String(get(3)).trim(),
      subcategory: String(get(4)).trim(),
      type: String(get(5)).trim(),
      sentiment,
      severity,
      content: String(get(8)).trim(),
      judgment: String(get(9)).trim(),
      working: String(get(10)).trim(),
      remarks: String(get(11)).trim(),
      link: links[get(8)] || '',
      links: linksArr
    };
  });
}

/**
 * 주간 보고서 파싱
 * @param {Array} data - Excel 데이터 배열
 * @returns {Object} 파싱된 주간 보고서 데이터
 */
function parseWeeklyReport(data) {
  // 주간 보고서 파싱 로직
  return {
    totalReports: data.length - 1,
    processedCount: 0,
    notes: '주간 보고서 데이터',
  };
}

module.exports = {
  excelDateToISOString,
  isValidDateCell,
  parseDailyReport,
  parseIssueReport,
  parseMobileDataSheet,
  parseMobileCheatAbuseSheet,
  parseMobileIssueSheet,
  parseMobileVOCSheet,
  parseWeeklyReport
};

