# Agent Ops Wallboard - 프로세스 분석 문서

## 목차
1. [시스템 개요](#시스템-개요)
2. [데이터 흐름](#데이터-흐름)
3. [주간보고서 생성 프로세스](#주간보고서-생성-프로세스)
4. [Excel 파싱 프로세스](#excel-파싱-프로세스)
5. [최근 수정 사항](#최근-수정-사항)

---

## 시스템 개요

### 구성 요소
- **Frontend**: React + TypeScript + Vite (포트 5173)
- **Backend**: Node.js + Express (REST API 8080, WebSocket 8081)
- **데이터 소스**: Excel 파일 (Mobile 일일보고서)

### 주요 기능
1. 실시간 현황판 (에이전트 상태, 이슈 큐)
2. 일일보고서 업로드 및 파싱
3. 주간보고서 자동 생성
4. Excel 파일 다운로드

---

## 데이터 흐름

### 전체 데이터 흐름도

```
┌──────────────────────────────────────────────────────────────┐
│                    사용자 액션                                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 일일보고서 업로드 (Dashboard)                            │
│     → Excel 파일 선택                                        │
│     → POST /api/upload-report                                │
│                                                              │
│  2. 주간보고서 생성 (Weekly Report)                          │
│     → 기간 선택 (시작일 ~ 종료일)                            │
│     → POST /api/generate-weekly-report                       │
│                                                              │
│  3. Excel 다운로드                                           │
│     → GET /api/weekly-reports/:agentId/download/:reportId   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│                    백엔드 처리 (server.js)                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  일일보고서 파싱:                                             │
│  ┌──────────────────────────────────────────────┐           │
│  │ Excel 파일 읽기 (XLSX.readFile)              │           │
│  │ ↓                                            │           │
│  │ 1. VOC 시트 → parseMobileVOCSheet()          │           │
│  │    - 날짜 필터링 없이 전체 데이터 저장        │           │
│  │    - 헤더 제거 로직 적용                      │           │
│  │ ↓                                            │           │
│  │ 2. Issue 시트 → parseMobileIssueSheet()      │           │
│  │    - 날짜 필터링 없이 전체 데이터 저장        │           │
│  │    - 헤더 제거 로직 적용                      │           │
│  │ ↓                                            │           │
│  │ 3. Data 시트 → parseMobileDataSheet()        │           │
│  │    - 컬럼 구조:                              │           │
│  │      A열: 행번호, B열: 주차, C열: 날짜       │           │
│  │      D열: 작성자, E열: 커뮤니티 이슈         │           │
│  │    - 헤더 제거 로직 적용                      │           │
│  │ ↓                                            │           │
│  │ 데이터 저장 → reports[agentId].push(report)  │           │
│  │ ↓                                            │           │
│  │ 파일 저장 → saveReportsToFile()              │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  주간보고서 생성:                                             │
│  ┌──────────────────────────────────────────────┐           │
│  │ WeeklyReportGenerator 인스턴스 생성          │           │
│  │ ↓                                            │           │
│  │ 1. 기간 필터링                                │           │
│  │    - VOC: 날짜 기준 필터링                   │           │
│  │    - Issue: 날짜 기준 필터링                 │           │
│  │    - Data: 날짜 기준 필터링 (VOC와 동일)     │           │
│  │ ↓                                            │           │
│  │ 2. 통계 집계                                  │           │
│  │    - 성향별 (긍정/부정/중립)                  │           │
│  │    - 이슈별 (카테고리별 건수)                 │           │
│  │    - 주요 이슈 건수                           │           │
│  │    - 공유 이슈 (Severity 1-2)                 │           │
│  │ ↓                                            │           │
│  │ 3. 보고서 반환                                │正式       │
│  │    - voc, issue, data 데이터 포함             │           │
│  │    - statistics, charts 포함                 │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  Excel 다운로드:                                              │
│  ┌──────────────────────────────────────────────┐           │
│  │ 1. 시트 생성                                  │           │
│  │    - 요약, 성향별, 이슈별, 주요이슈, 공유이슈 │           │
│  │    - VOC 대분류별 시트 (10개 카테고리)       │           │
│  │    - VOC 전체, Data 전체                      │           │
│  │ ↓                                            │           │
│  │ 2. 시트 이름 안전화                           │           │
│  │    - safeSheetName(): 특수문자 제거          │           │
│  │ ↓                                            │           │
│  │ 3. Excel 생성                                 │           │
│  │    - XLSX.write(workbook, ...)               │           │
│  │    - 에러 처리 강화 (try-catch)               │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│                    프론트엔드 표시                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  - 주간보고서 요약 카드                                       │
│  - VOC, Issue, Data 통계                                     │
│  - Excel 다운로드 버튼                                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 주간보고서 생성 프로세스

### 1단계: 일일보고서 업로드

**입력**: Excel 파일 (Mobile 일일보고서)
```javascript
// 파일 타입: mobile_daily
POST /api/upload-report
Content-Type: multipart/form-data
Body: {
  file: <File>,
  agentId: "agent1",
  fileType: "mobile_daily"
}
```

**처리**:
```javascript
// backend/server.js
app.post('/api/upload-report', upload.single('file'), (req, res) => {
  // 1. Excel 파일 읽기
  const workbook = XLSX.readFile(filePath);
  
  // 2. 각 시트별 데이터 추출
  workbook.SheetNames.forEach(sheetName => {
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const links = extractHyperlinks(worksheet);
    allSheets[sheetName] = { data, links };
  });
  
  // 3. 시트별 파싱
  parsedData = {
    issue: parseMobileIssueSheet(allSheets['Issue']?. across || [], null, links),
    voc: parseMobileVOCSheet(allSheets['VoC']?.data || [], null, links),
    data: parseMobileDataSheet(allSheets['Data']?.data || [], null),
  };
  
  // 4. 저장
  reports[agentId].push(report);
  saveReportsToFile();
});
```

**출력**: `data/reports.json`
```json
{
  "agent1": [
    {
      "id": "r123456",
      "date": "2025-10-27",
      "fileType": "mobile_daily",
      "data": {
        "issue": [...],
        "voc": [...],
        "data": [...]
      }
    }
  ]
}
```

---

### 2단계: 주간보고서 생성

**입력**: 시작일, 종료일
```javascript
POST /api/generate-weekly-report
Body: {
  agentId: "agent1",
  reportType: "mobile",
  startDate: "2025-10-19",
  endDate: "2025-10-26"
}
```

**처리**:
```javascript
// weekly-report-generator.js
generateMobileWeeklyReport(startDate, endDate) {
  // 1. 모든 일일보고서 수집
  const mobileReports = this.getDailyReportsForPeriod(startDate, endDate, 'mobile_daily');
  
  // 2. Raw 데이터 수집
  const allVOCRaw = mobileReports.flatMap(r => r.data?.voc || []);
  const allIssuesRaw = mobileReports.flatMap(r => r.data?.issue || []);
  const allDataRaw = mobileReports.flatMap(r => r.data?.data || []);
  
  // 3. 기간 필터링
  const allVOC = allVOCRaw.filter(item => {
    const itemDate = parseDate(item.date);
    return itemDate >= startDate && itemDate <= endDate;
  });
  
  const allIssues = allIssuesRaw.filter(item => {
    const itemDate = parseDate(item.date);
    return itemDate >= startDate && itemDate <= endDate;
  });
  
  const allData = allDataRaw.filter(item => {
    const itemDate = parseDate(item.date);
    return itemDate >= startDate && itemDate <= endDate;
  });
  
  // 4. 통계 집계
  const sentimentStats = { 긍정: 0, 부정: 0, 중립: 0 };
  const issueStats = { 게임플레이: 0, 버그: 0, ... };
  const majorIssueStats = { 유료아이템: 0, ... };
  const sharedIssues = [...].filter(i => i.severity <= 2);
  
  // 5. 보고서 반환
  return {
    reportType: 'mobile_weekly',
    period: '2025-10-19 ~ 2025-10-26',
    statistics: { vocCount, issueCount, dataCount },
    charts: { sentimentStats, issueStats },
    voc: allVOC,
    data: allData,
    ...
  };
}
```

**출력**: 
- 메모리: `weeklyReports[agentId]`
- 파일: `data/weekly-reports.json` (데이터 크기 제한)

---

### 3단계: Excel 다운로드

**입력**: agentId, reportId
```javascript
GET /api/weekly-reports/:agentId/download/:reportId
```

**처리**:
```javascript
// backend/server.js
app.get('/api/weekly-reports/:agentId/download/:reportId', (req, res) => {
  const report = weeklyReports[agentId].find(r => r.id === reportId);
  const workbook = XLSX.utils.book_new();
  
  // 1. 요약 시트
  const summarySheet = [...];
  XLSX.utils.book_append_sheet(workbook, ws1, safeSheetName('요약'));
  
  // 2. VOC 대분류별 시트
  vocByCategory.forEach((category, vocs) => {
    const wsCategory = XLSX.utils.aoa_to_sheet(categorySheet);
    const sheetName = safeSheetName(`VOC-${category}`);
    XLSX.utils.book_append_sheet(workbook, wsCategory, sheetName);
  });
  
  // 3. Data 시트
  if (report.data && report.data.length > 0) {
    const wsData = XLSX.utils.aoa_to_sheet(dataSheet);
    XLSX.utils.book_append_sheet(workbook, wsData, safeSheetName('Data'));
  }
  
  // 4. Excel 생성 및 전송
  const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.send(excelBuffer);
});
```

---

## Excel 파싱 프로세스

### Mobile 일일보고서 구조

#### VOC 시트
```
Column A: (헤더)
Column B: 날짜 (index 1)
Column C: 출처 (index 2)
Column D: 대분류 (index 3)
Column E: 중분류 (index 4)
Column F: 종류 (index 5)
Column G: 성향 (index 6)
Column H: 중요도 (index 7)
Column I: 내용 (index 8)
Column J: 판단/확인사항 (index 9)
Column K: 근무 (index 10)
Column L: 비고 (index 11)
Column M: 링크 (index 12) - 하이퍼링크
```

**파싱 로직**:
```javascript
function parseMobileVOCSheet(data, dateFilter, links = {}) {
  // 1. 첫 1행 제외 (헤더)
  const validRows = data.slice(1).filter(row => {
    const date = row[1];
    const content = row[8];
    
    // 유효성 검사
    if (!date || !content) return false;
    if (date === 'Naver Café' || date === 'Discord') return false;
    
    return true;
  });
  
  // 2. 데이터 변환
  return validRows.map(row => ({
    date: excelDateToISOString(row[1]),
    source: row[2],
    category: row[3],
    subcategory: row[4],
    ...
    link: links[`${index}_12`] || row[12]
  }));
}
```

---

#### Issue 시트
```
Column A-C: (헤더)
Column C: 날짜 (index 2)
Column D: 분류 (index 3)
Column E: 요약 (index 4)
Column F: 세부 내용 (index 5)
Column G: 링크 (index 6)
Column H: 시간 (index 7)
```

**파싱 로직**:
```javascript
function parseMobileIssueSheet(data, dateFilter, links = {}) {
  // 첫 4행 제외 (헤더)
  const validRows = data.slice(4).filter(row => {
    const date = row[2];
    const category = row[3];
    if (!date && !category) return false;
    if (date.includes('날짜') || category.includes('분류')) return false;
    return true;
  });
  
  return validRows.map(row => ({
    date: row[2],
    category: row[3],
    title: row[4],
    detail: row[5],
    ...
  }));
}
```

---

#### Data 시트 ⚠️ 최근 수정됨
```
Column A: 행번호 (index 0)
Column B: 주차 (index 1) - "10월 4주차"
Column C: 날짜 (index 2) - "2025-10-21" (실제 날짜)
Column D: 작성자 (index 3)
Column E: 커뮤니티 이슈 (index 4)
Column F: 공유 (index 5)
Column G: 요청 (index 6)
Column H: 비고 (index 7)
```

**파싱 로직**:
```javascript
function parseMobileDataSheet(data, dateFilter) {
  // 첫 2행 제외
  const validData = data.filter((row, index) => {
    if (index === 0 || index === 1) return false;
    
    const dateValue = row[2]; // C열: 실제 날짜
    if (!dateValue) return false;
    
    // 날짜 유효성 검사
    const itemDate = typeof dateValue === 'number' 
      ? excelDateToISOString(dateValue)
      : new Date(dateValue);
    if (isNaN(itemDate.getTime())) return false;
    
    return true;
  });
  
  return validData.map(row => ({
    category: row[1],  // B열: 주차
    date: excelDateToISOString(row[2]),  // C열: 날짜
    author: row[3],  // D열: 작성자
    communityIssue: row[4],  // E열: 커뮤니티 이슈
    share: row[5],
    request: row[6],
    remarks: row[7]
  }));
}
```

---

## 최근 수정 사항

### 2025년 1월 - 주요 버그 수정

#### 1. Data 시트 파싱 오류 수정 ✅
**문제**: 유효 행 0개 발생
**원인**: 컬럼 인덱스 불일치 (날짜를 B열에서 찾았으나 실제는 C열)
**해결**: 
- 날짜 컬럼: `row[1]` → `row[2]`
- 모든 컬럼 1칸씩 오프셋 조정

#### 2. Excel 생성 실패 오류 수정 ✅
**문제**: "Sheet name cannot contain: \ / ? * [ ]" 에러
**원인**: 시트 이름에 특수문자 포함
**해결**:
- `safeSheetName()` 함수 추가
- 특수문자 자동 제거
- 31자 제한 적용
- 에러 발생 시 재시도 로직 추가

#### 3. VOC 헤더 필터링 강화 ✅
**문제**: "출처", "Naver Café" 같은 헤더가 데이터로 포함
**해결**:
- VOC 시트 헤더 검증 로직 추가
- 출처, 날짜, 내용 필드의 헤더 텍스트 제외
- Issue 시트도 동일한 필터링 적용

#### 4. 날짜 필터링 일관성 확보 ✅
**문제**: Data 시트가 VOC/Issue와 다른 필터링 로직 사용
**해결**:
- Data 시트도 VOC와 동일한 기간 필터 적용
- 날짜 비교 시 시간 부분 제거
- Excel 시리얼 날짜 정확한 변환

#### 5. 에러 로깅 강화 ✅
**추가 내용**:
- 상세한 에러 스택 트레이스
- VOC 카테고리 디버깅 로그
- Data 시트 샘플 로그
- Excel 내보내기 단계별 로그

---

## 문제 해결 가이드

### Data 시트 유효 행 0개

**증상**: 일일보고서 업로드 시 "Data 시트 유효 행: 0개"

**원인 확인**:
1. 백엔드 콘솔에서 "Data 시트 샘플" 로그 확인
2. 첫 5행의 A, B, C, D 값 확인

**해결 방법**:
```javascript
// backend/server.js의 parseMobileDataSheet 함수
// 샘플 로그를 보고 실제 컬럼 구조에 맞게 수정
const dateValue = row[2]; // 실제 날짜 위치 확인
```

---

### Excel 다운로드 실패

**증상**: "Sheet name cannot contain..." 에러

**해결**:
- 서버 콘솔에서 "VOC 카테고리 원본" 로그 확인
- 특수문자가 포함된 카테고리 확인
- `safeSheetName()` 함수로 자동 처리됨

---

### VOC 데이터 0개

**증상**: 주간보고서에서 vocCount: 0

**원인**:
1. 헤더가 데이터로 포함됨
2. 날짜 필터링에서 제외됨

**해결**:
- VOC 시트 파싱 로직 확인
- "출처", "Naver Café" 같은 헤더 제외 로직 적용

---

## 디버깅 체크리스트

### 일일보고서 업로드 시
- [ ] "VOC 시트 유효 행" 로그 확인
- [ ] "Issue 시트 유효 행" 로그 확인
- [ ] "Data 시트 샘플" 로그 확인
- [ ] "Data 시트 유효 행" 로그 확인
- [ ] "보고서 데이터 저장 완료" 확인

### 주간보고서 생성 시
- [ ] "Mobile 일일보고서 X개 발견" 확인
- [ ] "Raw 데이터" vocCount, issuesCount, dataCount 확인
- [ ] "필터링 전 VOC 샘플" 확인 (헤더가 포함되어 있으면 안됨)
- [ ] "필터링 후 데이터" 개수 확인
- [ ] "주간보고서 생성 완료" statistics 확인

### Excel 다운로드 시
- [ ] "VOC 카테고리 원본" 로그 확인
- [ ] "시트 이름 생성" 로그 확인
- [ ] "Excel 내보내기: Data 시트 행 수" 확인
- [ ] 에러 발생 시 "Excel 생성 오류" 로그 확인

---

## API 엔드포인트 요약

### 일일보고서
```javascript
POST /api/upload-report
- 파일: Excel 일일보고서
- 응답: { success: true, report: {...} }
```

### 주간보고서 생성
```javascript
POST /api/generate-weekly-report
Body: { agentId, reportType, startDate, endDate }
- 응답: { success: true, report: {...} }
```

### 주간보고서 조회
```javascript
GET /api/weekly-reports/:agentId
- 응답: { reports: [...] }
```

### Excel 다운로드
```javascript
GET /api/weekly-reports/:agentId/download/:reportId
- 응답: Excel 파일 (binary)
```

---

## 파일 구조

```
backend/
├── server.js                      # 메인 서버
│   ├── VOC 시트 파싱 함수
│   ├── Issue 시트 파싱 함수
│   ├── Data 시트 파选择了      함수 ⚠️ 최근 수정
│   ├── 시트 이름 안전화 함수
│   ├── Excel 다운로드 엔드포인트
│   └── 에러 처리 강화
│
├── weekly-report-generator.js     # 주간보고서 생성기
│   ├── VOC 필터링 (날짜 기준)
│   ├── Issue 필터링 (날짜 기준)
│   ├── Data 필터링 (날짜 기준) ⚠️ 최근 수정
│   └── 통계 집계
│
└── data/
    ├── reports.json               # 일일보고서 저장
    └── weekly-reports.json        # 주간보고서 저장

src/
├── App.tsx                        # 메인 현황판
├── Dashboard.tsx                  # 일일보고서 업로드
└── WeeklyReportGenerator.tsx      # 주간보고서 UI
```

---

## 주요 함수 및 변수

### 파싱 함수
- `parseMobileVOCSheet(data, dateFilter, links)`: VOC 시트 파싱
- `parseMobileIssueSheet(data, dateFilter, links)`: Issue 시트 파싱
- `parseMobileDataSheet(data, dateFilter)`: Data 시트 파싱 ⚠️ 최근 수정

### 헬퍼 함수
- `excelDateToISOString(serial)`: Excel 시리얼 날짜 변환
- `safeString(value)`: 안전한 문자열 변환
- `safeSheetName(name)`: Excel 시트 이름 안전화
- `normalizeDateForExport(value)`: 날짜 정규화

### 생성기 함수
- `generateMobileWeeklyReport(startDate, endDate)`: Mobile 주간보고서 생성
- `filterByDateRange(items, startDate, endDate)`: 날짜 필터링

### 저장소
- `reports[agentId]`: 일일보고서 배열
- `weeklyReports[agentId]`: 주간보고서 배열

---

## 성능 최적화

### 파일 크기 제한
- 일일보고서: 무제한 (메모리 허용 범위)
- 주간보고서: 최신 20개만 파일에 저장

### 메모리 관리
- 파일 저장 실패해도 메모리에는 데이터 유지
- 최대 20개 주간보고서만 유지 (파일 저장 시 10개로 축소)
- VOC/Issue/Data 전체 데이터는 메모리에만 저장

---

## 참고 문서

- `DATA_FLOW_GUIDE.md`: 데이터 흐름 상세 가이드
- `EXCEL_FORMAT_GUIDE.md`: Excel 파일 형식 가이드
- `MOBILE_SETUP_COMPLETE.md`: Mobile 보고서 설정 가이드
- `backend/README.md`: 백엔드 서버 사용법

