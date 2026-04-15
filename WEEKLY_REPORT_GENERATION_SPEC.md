# 주간보고서 생성 로직 상세 스펙

**작성일**: 2026-01-23  
**버전**: 1.0  
**대상**: PUBG PC / PUBG Mobile 주간 SUMMARY 보고서

---

## 📋 목차

1. [개요](#개요)
2. [시스템 아키텍처](#시스템-아키텍처)
3. [API 엔드포인트](#api-엔드포인트)
4. [데이터 수집 로직](#데이터-수집-로직)
5. [엑셀 시트 구성](#엑셀-시트-구성)
6. [데이터 집계 및 변환](#데이터-집계-및-변환)
7. [주차 계산 로직](#주차-계산-로직)
8. [프로젝트 필터링](#프로젝트-필터링)
9. [에러 처리](#에러-처리)
10. [사용 예시](#사용-예시)

---

## 개요

주간보고서는 **일주일 단위(월요일~일요일)**로 커뮤니티 이슈, VoC, 공유 이슈 등을 집계하여 Excel 파일로 생성하는 기능입니다.

### 주요 특징

- **플랫폼별 분리**: PUBG PC (projectId: 1) / PUBG Mobile (projectId: 2)
- **5개 시트 구성**: 메인 시트, 주요 이슈 증감, 공유 이슈, VoC, Data
- **전주 대비 비교**: 이전 주차 데이터와 비교하여 증감률 계산
- **자동 주차 계산**: 시작일 기준으로 자동으로 주차 정보 계산

---

## 두 가지 구현 방식

### 1. 신규 방식 (현재 사용 중) - `weeklyReport.service.js`

**엔드포인트**: `GET /api/reports/weekly/download`

**특징**:
- **직접 데이터 수집**: 일일보고서 없이 `ReportItemIssue`, `RawLog`, `IssueShareLog`에서 직접 데이터 수집
- **프로젝트 필터링**: `projectId`로 PC/Mobile 분리
- **5개 시트 생성**: ExcelJS로 직접 생성
- **전주 대비 비교**: 자동으로 이전 주차 계산하여 비교

**사용 케이스**: 주간 SUMMARY 보고서 생성 (프론트엔드 `WeeklyReportGenerator.tsx`에서 사용)

### 2. 레거시 방식 - `weekly.service.js`

**엔드포인트**: `POST /api/weekly-reports/generate`

**특징**:
- **일일보고서 기반**: 이미 업로드된 일일보고서(`Report` 테이블)의 데이터를 집계
- **에이전트별**: `agentId` 기준으로 보고서 생성
- **WeeklyReport 테이블 저장**: 생성된 보고서를 DB에 저장
- **다운로드**: 저장된 보고서를 Excel로 다운로드

**사용 케이스**: 에이전트별 주간보고서 관리 (현재는 주로 신규 방식 사용)

---

## 시스템 아키텍처

### 컴포넌트 구조

```
┌─────────────────────────────────────────────────────────┐
│                    프론트엔드                           │
│              (WeeklyReportGenerator.tsx)                │
│  - 플랫폼 선택 (PC/Mobile)                              │
│  - 기간 설정 (시작일/종료일)                            │
│  - 다운로드 요청                                        │
└────────────────────┬──────────────────────────────────┘
                     │ HTTP GET
                     │ /api/reports/weekly/download
                     ▼
┌─────────────────────────────────────────────────────────┐
│                    백엔드 라우트                        │
│              (routes/reports.routes.js)                 │
└────────────────────┬──────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  컨트롤러                               │
│         (controllers/reports.controller.js)              │
│  - 요청 파라미터 검증                                    │
│  - WeeklyReportService 호출                             │
└────────────────────┬──────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  서비스 레이어                          │
│         (services/weeklyReport.service.js)               │
│  - 데이터 수집 (이슈, RawLog, 공유 로그)                 │
│  - 데이터 집계 및 변환                                    │
│  - Excel 파일 생성 (ExcelJS)                            │
└────────────────────┬──────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  데이터베이스                           │
│  - ReportItemIssue (이슈 데이터)                          │
│  - RawLog (게시글 등록량)                               │
│  - IssueShareLog (공유 이슈)                            │
│  - CategoryGroup / Category (카테고리)                  │
│  - MonitoredBoard (프로젝트 필터링)                     │
└─────────────────────────────────────────────────────────┘
```

### 데이터 흐름

```
1. 사용자 입력 (플랫폼, 시작일, 종료일)
   ↓
2. 이전 주차 계산 (startDate - 7일, endDate - 7일)
   ↓
3. 현재 주차 데이터 수집
   ├─ ReportItemIssue (이슈 데이터)
   ├─ RawLog (게시글 등록량)
   └─ IssueShareLog (공유 이슈)
   ↓
4. 이전 주차 데이터 수집 (동일 로직)
   ↓
5. 데이터 집계 및 변환
   ├─ 성향별 통계 (긍정/부정/중립)
   ├─ 대분류별 통계
   ├─ 일별 통계
   └─ 공유 이슈 추출
   ↓
6. Excel 시트 생성
   ├─ 시트 1: [월N주차] (메인)
   ├─ 시트 2: 주요 이슈 건수 증감
   ├─ 시트 3: 공유 이슈 시간 순
   ├─ 시트 4: VoC
   └─ 시트 5: Data
   ↓
7. 파일 다운로드
```

---

## API 엔드포인트

### 1. 주간 SUMMARY 보고서 다운로드 (신규 방식)

**엔드포인트**: `GET /api/reports/weekly/download`

**쿼리 파라미터**:
- `startDate` (필수): 시작 날짜 (YYYY-MM-DD)
- `endDate` (필수): 종료 날짜 (YYYY-MM-DD)
- `platform` (선택): 플랫폼 ('pc' 또는 'mobile', 기본값: 'pc')

**응답**:
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition: `attachment; filename="weekly_report_{platform}_{startDate}_{endDate}.xlsx"`

**예시**:
```bash
GET /api/reports/weekly/download?startDate=2025-01-20&endDate=2025-01-26&platform=mobile
```

### 2. 에이전트별 주간보고서 생성 (레거시 방식)

**엔드포인트**: `POST /api/weekly-reports/generate`

**요청 본문**:
```json
{
  "agentId": "agent-123",
  "reportType": "pc",
  "startDate": "2025-01-20",
  "endDate": "2025-01-26",
  "options": {
    "includeVOC": true,
    "includeIssues": true,
    "includeData": true
  }
}
```

**응답**: 생성된 `WeeklyReport` 객체 (DB에 저장됨)

**다운로드**: `GET /api/weekly-reports/:agentId/download/:reportId`

---

## 데이터 수집 로직

### 1. 이슈 데이터 조회

**함수**: `queryIssuesWithCategories(startDate, endDate, projectId)`

**SQL 쿼리**:
```sql
SELECT i.*, 
       cg.id as categoryGroup_id, 
       cg.name as categoryGroup_name, 
       cg.code as categoryGroup_code,
       c.id as category_id, 
       c.name as category_name
FROM ReportItemIssue i
LEFT JOIN CategoryGroup cg ON i.categoryGroupId = cg.id
LEFT JOIN Category c ON i.categoryId = c.id
WHERE i.excludedFromReport = 0
  AND i.projectId = ?
  AND i.date >= ? AND i.date <= ?
ORDER BY i.date ASC
```

**필터 조건**:
- `excludedFromReport = 0`: 보고서에서 제외되지 않은 이슈만
- `projectId`: 플랫폼별 필터링 (1: PC, 2: Mobile)
- `date`: 기간 필터링

**반환 데이터**:
```javascript
{
  id: string,
  date: string,           // YYYY-MM-DD
  summary: string,        // 이슈 요약
  detail: string,         // 상세 내용
  sentiment: string,      // 'pos' | 'neg' | 'neu'
  severity: number,       // 1-3 (1: 심각, 2: 중간, 3: 경미)
  categoryGroup: {       // 대분류
    id: number,
    name: string,
    code: string
  },
  category: {            // 중분류
    id: number,
    name: string
  },
  // ... 기타 필드
}
```

### 2. 게시글 등록량 조회

**함수**: `queryRawLogsByProject(startDateTime, endDateTime, projectId)`

**SQL 쿼리**:
```sql
SELECT rl.timestamp 
FROM RawLog rl
LEFT JOIN MonitoredBoard mb ON rl.boardId = mb.id
WHERE mb.projectId = ?
  AND rl.timestamp >= ? AND rl.timestamp <= ?
ORDER BY rl.timestamp ASC
```

**필터 조건**:
- `MonitoredBoard.projectId`: 프로젝트별 게시판만 조회
- `timestamp`: 기간 필터링

**반환 데이터**:
```javascript
[
  { timestamp: '2025-01-20T10:30:00.000Z' },
  { timestamp: '2025-01-20T11:15:00.000Z' },
  // ...
]
```

### 3. 공유 이슈 조회

**함수**: `queryShareLogs(startDateTime, endDateTime, projectId)`

**SQL 쿼리**:
```sql
SELECT sl.*, 
       i.summary, 
       i.detail, 
       i.date,
       a.name as agent_name
FROM IssueShareLog sl
INNER JOIN ReportItemIssue i ON sl.issueId = i.id
LEFT JOIN Agent a ON sl.agentId = a.id
WHERE sl.status = 'SUCCESS'
  AND i.projectId = ?
  AND sl.sentAt >= ? AND sl.sentAt <= ?
ORDER BY sl.sentAt ASC
```

**필터 조건**:
- `status = 'SUCCESS'`: 공유 성공한 이슈만
- `projectId`: 프로젝트별 필터링
- `sentAt`: 공유 시간 기준 필터링

**반환 데이터**:
```javascript
[
  {
    id: number,
    issueId: string,
    agentId: string,
    agent_name: string,
    target: string,        // 'Client_Channel' | 'Internal_Channel'
    sentAt: string,        // ISO datetime
    status: 'SUCCESS',
    summary: string,
    detail: string,
    date: string
  }
]
```

---

## 엑셀 시트 구성

### 시트 1: [월N주차] (메인 시트)

**시트명**: `{month}월{week}째주` (예: "1월4째주")

#### 1.1 성향별 주간 동향 수

**구조**:
| 성향 | 전주 건수 | 금주 건수 |
|------|----------|----------|
| 긍정 | 10 | 15 |
| 부정 | 20 | 18 |
| 중립 | 5 | 7 |

**데이터 소스**: `ReportItemIssue.sentiment`
- 긍정: `sentiment === 'pos'`
- 부정: `sentiment === 'neg'`
- 중립: `sentiment === 'neu'` 또는 기타

**집계 함수**: `getSentimentStats(issues)`

#### 1.2 이슈별 주간 동향 수

**구조**:
| 대분류 | 전주 건수 | 금주 건수 |
|--------|----------|----------|
| 버그 | 5 | 8 |
| 서버/접속 | 3 | 2 |
| 게임 플레이 | 10 | 12 |
| ... | ... | ... |

**데이터 소스**: `ReportItemIssue.categoryGroup.name`

**집계 함수**: `getIssueStatsByCategory(issues)`

#### 1.3 주간 부정 동향 요약

**구조**: 요인별 그룹화된 부정 이슈 목록
```
[요인 설명] (N건)
[요인 설명] (M건)
...
```

**데이터 소스**: `sentiment === 'neg'`인 이슈들

**집계 로직**:
1. 부정 이슈 필터링
2. 요인별 그룹화 (대분류 + 중분류 + 요약)
3. 건수 순 정렬
4. 상위 요인만 표시

**함수**: `createNegativeTrendSummary()`

#### 1.4 주간 긍정 동향 요약

**구조**: 요인별 그룹화된 긍정 이슈 목록

**데이터 소스**: `sentiment === 'pos'`인 이슈들

**함수**: `createPositiveTrendSummary()`

#### 1.5 커뮤니티 주요 동향

**구조**: 부정/긍정/기타로 분류된 동향 테이블

**테이블 구조**:
| 대분류 | 중분류 | 내용 |
|--------|--------|------|
| 버그 | UI/UX | > 이슈 설명 1<br>> 이슈 설명 2 |
| 서버 | 접속 | > 이슈 설명 3 |

**함수**: `createCommunityTrends()`

#### 1.6 모니터링 업무 현황

**구조**:
| 날짜 | 게시글 등록량 | 이슈 취합건수 |
|------|--------------|--------------|
| 2025-01-20 | 150 | 25 |
| 2025-01-21 | 180 | 30 |
| ... | ... | ... |
| 합계 | 1050 | 175 |

**데이터 소스**:
- 게시글 등록량: `RawLog.timestamp` 일별 집계
- 이슈 취합건수: `ReportItemIssue.date` 일별 집계

**함수**: `createMonitoringStatus()`, `getDailyStats()`

#### 1.7 협의 및 논의 사항 / 요청 사항 / 비고

**구조**: 빈 섹션 (수동 입력용)
```
협의 및 논의 사항: -
요청 사항: -
비고: -
```

**함수**: `createDiscussionSection()`

---

### 시트 2: 주요 이슈 건수 증감

**시트명**: `주요 이슈 건수 증감`

#### 구조

| 순위 | 주요 이슈 구분 | 전주 건수 | 금주 건수 | 전주 비율 (MO 취합량 대비 %) | 금주 비율 (MO 취합량 대비 %) | 증감 | 전주 대비 % |
|------|--------------|----------|----------|---------------------------|---------------------------|------|------------|
| 1 | 버그 | 10 | 15 | 20.0 | 25.0 | ↑5.0% | 50.0 |
| 2 | 서버/접속 | 8 | 12 | 16.0 | 20.0 | ↑4.0% | 50.0 |
| ... | ... | ... | ... | ... | ... | ... | ... |

#### 계산 로직

1. **전주 비율**: `(전주 건수 / 전주 MO 총 취합량) * 100`
2. **금주 비율**: `(금주 건수 / 금주 MO 총 취합량) * 100`
3. **증감**: `금주 비율 - 전주 비율` (↑ 또는 ↓ 표시)
4. **전주 대비 %**: `((금주 건수 - 전주 건수) / 전주 건수) * 100`

#### 정렬 기준

- 금주 건수 기준 내림차순

**함수**: `createSecondSheet()`

---

### 시트 3: 공유 이슈 시간 순

**시트명**: `공유 이슈 시간 순`

#### 구조

| 공유 시간 | 이슈 내용 | 담당 Agent | 공유 대상 | 상태 |
|----------|----------|-----------|----------|------|
| 2025-01-20 14:30 | 이슈 제목/내용 | Agent명 | 고객사/내부 | 공유 완료 |
| 2025-01-21 09:15 | 이슈 제목/내용 | Agent명 | 고객사 | 공유 완료 |

#### 데이터 소스

- `IssueShareLog` (status = 'SUCCESS')
- `ReportItemIssue` (INNER JOIN)
- `Agent` (LEFT JOIN)

#### 정렬 기준

- `sentAt` 기준 오름차순 (시간순)

**함수**: `createThirdSheet()`, `queryShareLogs()`

---

### 시트 4: VoC

**시트명**: `VoC`

#### 구조

일일보고서의 VoC 시트와 동일한 구조를 사용합니다.

**데이터 소스**: `excelReport.service.createVoCSheet()` 재사용

**컬럼**:
- 날짜, 출처, 대분류, 중분류, 종류, 성향, 중요도, 내용, 판단/확인사항, 근무, 비고
- 게시물 주소 (최대 10개 컬럼, 하이퍼링크 포함)

**함수**: `createFourthSheet()`

---

### 시트 5: Data

**시트명**: `Data`

#### 구조

| 주차 | 날짜 | 담당 Agent | 커뮤니티 이슈 | 이용자 동향 | 공유 내용 | 요청 내용 | 비고 |
|------|------|-----------|--------------|------------|----------|----------|------|
| 1월 4주차 | 2025-01-20 | Agent명 | 대분류명 | 긍정/부정/중립 | 이슈 내용 - 시간 | - | - |
| ... | ... | ... | ... | ... | ... | ... | ... |

#### 데이터 소스

- `IssueShareLog` (공유된 이슈)
- 날짜별 그룹화
- 주차 정보 자동 계산

**함수**: `createFifthSheet()`, `queryShareLogsForDataSheet()`, `groupShareLogsByDate()`

---

## 데이터 집계 및 변환

### 성향 정규화

**함수**: `normalizeSentiment(sentiment)`

**로직**:
```javascript
if (sentiment === 'pos' || sentiment.includes('긍정')) return 'pos';
if (sentiment === 'neg' || sentiment.includes('부정')) return 'neg';
return 'neu'; // 기본값
```

### 이슈 설명 추출

**함수**: `getFinalDescription(issue)`

**우선순위**:
1. `aiClassificationReason` (AI 분류 이유)
2. `summary` (요약)
3. `detail` (상세, 최대 200자)

### 주차 정보 계산

**함수**: `getWeekInfo(startDate)`

**로직**:
1. 해당 월의 첫 번째 일요일 계산
2. 현재 날짜가 몇 주차인지 계산
3. 반환: `{ month: 1, week: 4, label: '1월4째주' }`

**예시**:
- 2025-01-20 (월요일) → `{ month: 1, week: 4, label: '1월4째주' }`
- 2025-01-27 (월요일) → `{ month: 1, week: 5, label: '1월5째주' }`

### 일별 통계 계산

**함수**: `getDailyStats(data, startDate, endDate)`

**로직**:
1. 시작일~종료일 범위의 모든 날짜 초기화
2. `RawLog.timestamp`를 날짜별로 집계 (게시글 등록량)
3. `ReportItemIssue.date`를 날짜별로 집계 (이슈 취합건수)

**반환 형식**:
```javascript
{
  '2025-01-20': { posts: 150, issues: 25 },
  '2025-01-21': { posts: 180, issues: 30 },
  // ...
}
```

---

## 주차 계산 로직

### 주간 범위 계산

**함수**: `getWeekRange(date)`

**로직**:
- 월요일을 주간 시작일로 설정
- 일요일을 주간 종료일로 설정

**예시**:
```javascript
// 2025-01-22 (수요일) 기준
getWeekRange(new Date('2025-01-22'))
// 반환: { start: '2025-01-20', end: '2025-01-26' }
```

### 이전 주차 계산

**함수**: `calculatePreviousWeek(startDate, endDate)`

**로직**:
```javascript
prevWeekStart = startDate - 7일
prevWeekEnd = endDate - 7일
```

**예시**:
```javascript
// 현재 주차: 2025-01-20 ~ 2025-01-26
// 이전 주차: 2025-01-13 ~ 2025-01-19
```

---

## 프로젝트 필터링

### 프로젝트 ID 매핑

**상수**:
```javascript
PROJECT_IDS = {
  PC: 1,      // PUBG PC
  MOBILE: 2   // PUBG Mobile
}
```

### 필터링 적용 위치

1. **이슈 데이터**: `ReportItemIssue.projectId = ?`
2. **게시글 등록량**: `MonitoredBoard.projectId = ?` (RawLog 조인)
3. **공유 이슈**: `ReportItemIssue.projectId = ?` (IssueShareLog 조인)

### 플랫폼 변환

**함수**: `getProjectIdFromPlatform(platform)`

```javascript
platform === 'mobile' ? 2 : 1
```

---

## 에러 처리

### 입력 검증

1. **날짜 검증**:
   - `startDate`, `endDate` 필수
   - 유효한 날짜 형식 (YYYY-MM-DD)
   - `startDate <= endDate`

2. **플랫폼 검증**:
   - `platform`은 'pc' 또는 'mobile' (기본값: 'pc')

### 데이터 수집 실패 처리

- **이슈 데이터 없음**: 빈 배열 반환, 경고 로그
- **RawLog 데이터 없음**: 게시글 등록량 0으로 처리
- **공유 이슈 없음**: 해당 시트에 "공유된 이슈가 없습니다." 표시

### Excel 생성 실패 처리

- 각 시트 생성 시 try-catch로 감싸서 오류 발생 시 빈 시트라도 생성
- 로그에 상세 오류 정보 기록

---

## 사용 예시

### 프론트엔드 사용

```typescript
// WeeklyReportGenerator.tsx
const handleDownload = async () => {
  const params = new URLSearchParams({
    startDate: '2025-01-20',
    endDate: '2025-01-26',
    platform: 'mobile'
  });
  
  const res = await fetch(`/api/reports/weekly/download?${params}`);
  const blob = await res.blob();
  
  // 파일 다운로드
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `weekly_report_mobile_2025-01-20_2025-01-26.xlsx`;
  link.click();
};
```

### 백엔드 직접 호출

```javascript
// 컨트롤러에서
const weeklyReportService = require('./services/weeklyReport.service');

const buffer = await weeklyReportService.generateWeeklyReport(
  '2025-01-20',  // startDate
  '2025-01-26',  // endDate
  'mobile'       // platform
);

res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
res.setHeader('Content-Disposition', 'attachment; filename="weekly_report.xlsx"');
res.send(buffer);
```

---

## 데이터베이스 스키마

### 관련 테이블

#### ReportItemIssue
```sql
CREATE TABLE ReportItemIssue (
  id TEXT PRIMARY KEY,
  projectId INTEGER,
  date TEXT,                    -- YYYY-MM-DD
  summary TEXT,
  detail TEXT,
  sentiment TEXT,               -- 'pos' | 'neg' | 'neu'
  severity INTEGER,              -- 1-3
  categoryGroupId INTEGER,
  categoryId INTEGER,
  excludedFromReport INTEGER DEFAULT 0,
  -- ...
);
```

#### RawLog
```sql
CREATE TABLE RawLog (
  id TEXT PRIMARY KEY,
  boardId INTEGER,
  timestamp TEXT,                -- ISO datetime
  -- ...
);
```

#### MonitoredBoard
```sql
CREATE TABLE MonitoredBoard (
  id INTEGER PRIMARY KEY,
  projectId INTEGER,             -- 1: PC, 2: Mobile
  -- ...
);
```

#### IssueShareLog
```sql
CREATE TABLE IssueShareLog (
  id INTEGER PRIMARY KEY,
  issueId TEXT,
  agentId TEXT,
  target TEXT,                   -- 'Client_Channel' | 'Internal_Channel'
  sentAt TEXT,                   -- ISO datetime
  status TEXT,                   -- 'SUCCESS' | 'FAILED'
  -- ...
);
```

#### CategoryGroup / Category
```sql
CREATE TABLE CategoryGroup (
  id INTEGER PRIMARY KEY,
  name TEXT,
  code TEXT,
  -- ...
);

CREATE TABLE Category (
  id INTEGER PRIMARY KEY,
  groupId INTEGER,
  name TEXT,
  -- ...
);
```

---

## 성능 고려사항

### 최적화 전략

1. **인덱스 활용**:
   - `ReportItemIssue.date`, `ReportItemIssue.projectId` 인덱스
   - `RawLog.timestamp`, `MonitoredBoard.projectId` 인덱스
   - `IssueShareLog.sentAt`, `IssueShareLog.status` 인덱스

2. **쿼리 최적화**:
   - 필요한 컬럼만 SELECT
   - JOIN 최소화
   - 날짜 범위 필터링을 WHERE 절에 명시

3. **메모리 관리**:
   - 대량 데이터는 스트리밍 처리 고려
   - ExcelJS 버퍼 크기 모니터링

---

## 확장 가능성

### 향후 개선 사항

1. **캐싱**: 자주 요청되는 주차 데이터 캐싱
2. **비동기 생성**: 대용량 데이터의 경우 백그라운드 작업으로 처리
3. **템플릿 커스터마이징**: 시트 구조를 설정으로 변경 가능하게
4. **다중 프로젝트**: 여러 프로젝트를 한 번에 집계

---

## 참고 자료

- [ExcelJS 문서](https://github.com/exceljs/exceljs)
- [일일보고서 스펙](./MOBILE_WEEKLY_REPORT_FINAL.md)
- [데이터 매핑 가이드](./MOBILE_WEEKLY_REPORT_MAPPING.md)

---

**문서 버전**: 1.0  
**최종 업데이트**: 2026-01-23
