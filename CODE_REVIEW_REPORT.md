# 코드 검토 보고서 (Code Review Report)

**프로젝트명**: WallboardV2 - Agent Ops Monitoring System  
**검토 일자**: 2025-01-27  
**검토 범위**: 전체 코드베이스 (Backend + Frontend)

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [아키텍처 분석](#2-아키텍처-분석)
3. [주요 발견 사항](#3-주요-발견-사항)
4. [로직 개선 사항](#4-로직-개선-사항)
5. [코딩 오류 및 버그](#5-코딩-오류-및-버그)
6. [중복 코드 분석](#6-중복-코드-분석)
7. [성능 최적화 방안](#7-성능-최적화-방안)
8. [프론트엔드 분석 (React)](#8-프론트엔드-분석-react)
9. [모니터링 워커 안정성 검토](#9-모니터링-워커-안정성-검토)
10. [API 설계 및 보안 검토](#10-api-설계-및-보안-검토)
11. [보안 이슈](#11-보안-이슈)
12. [데이터베이스 개선](#12-데이터베이스-개선)
13. [테스트 및 품질 관리](#13-테스트-및-품질-관리)
14. [우선순위별 개선 계획](#14-우선순위별-개선-계획)
15. [결론 및 권장사항](#15-결론-및-권장사항)

---

## 1. 프로젝트 개요

### 1.1 시스템 목적
- **Discord/Naver Cafe 모니터링**: 게임 커뮤니티에서 이슈 수집
- **이슈 관리**: 수집된 이슈의 분류, 할당, 처리 추적
- **SLA 모니터링**: 심각도별 응답 시간 관리 및 알림
- **보고서 생성**: 일일/주간 보고서 자동 생성
- **실시간 대시보드**: WebSocket 기반 실시간 현황 표시

### 1.2 기술 스택
- **Backend**: Node.js, Express.js, Prisma ORM, SQLite
- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **실시간 통신**: WebSocket (ws)
- **외부 연동**: OpenAI API, Slack API, Discord API, Naver Cafe Scraping

### 1.3 프로젝트 규모
- **Backend 파일 수**: 약 100+ 파일
- **Frontend 파일 수**: 약 20+ 파일
- **데이터베이스 모델**: 20+ 모델
- **API 엔드포인트**: 50+ 엔드포인트

---

## 2. 아키텍처 분석

### 2.1 현재 아키텍처

```
┌─────────────────────────────────────────────────┐
│              Frontend (React)                    │
│  - App.tsx (메인 대시보드)                       │
│  - WebSocket 실시간 통신                         │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│         Backend (Express.js)                    │
│  ┌──────────────┬──────────────┬─────────────┐ │
│  │ Controllers  │   Services    │   Workers   │ │
│  │ (요청 처리)   │ (비즈니스 로직)│ (백그라운드)│ │
│  └──────┬───────┴──────┬────────┴──────┬──────┘ │
│         │              │                │        │
│  ┌──────▼──────────────▼────────────────▼──────┐ │
│  │         Prisma ORM (SQLite)                  │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 2.2 아키텍처 강점
✅ **레이어 분리**: Controller → Service → Database 패턴 적용  
✅ **워커 프로세스**: 모니터링 작업을 별도 프로세스로 분리  
✅ **실시간 통신**: WebSocket을 통한 실시간 업데이트  
✅ **타입 안정성**: Frontend에서 TypeScript 사용

### 2.3 아키텍처 약점
❌ **에러 처리 불일치**: 일부는 try-catch, 일부는 asyncMiddleware 사용  
❌ **로깅 표준화 부족**: console.log와 logger 혼용 (8190개 console 사용)  
❌ **환경 변수 검증 부족**: 필수 환경 변수 누락 시 런타임 에러 가능  
❌ **트랜잭션 부족**: 복잡한 비즈니스 로직에서 트랜잭션 미사용

---

## 3. 주요 발견 사항

### 3.1 코드 품질 지표

| 항목 | 수치 | 평가 |
|------|------|------|
| console.log 사용 | 8,190개 | ⚠️ 높음 (로거로 전환 필요) |
| TODO/FIXME 주석 | 1,127개 | ⚠️ 높음 (우선순위 정리 필요) |
| 중복 코드 패턴 | 다수 발견 | ⚠️ 리팩토링 필요 |
| 테스트 커버리지 | 낮음 (추정) | ❌ 테스트 부족 |

### 3.2 주요 문제점 요약

1. **로깅 표준화 부족**: console.log 남용
2. **에러 처리 불일치**: 다양한 에러 처리 패턴 혼재
3. **중복 코드**: 유사한 로직의 반복
4. **성능 이슈**: N+1 쿼리, 대량 데이터 처리 최적화 부족
5. **보안 취약점**: 환경 변수 검증 부족, 인증 미완성 부분
6. **테스트 부족**: 단위 테스트 및 통합 테스트 부재

---

## 4. 로직 개선 사항

### 4.1 이슈 분류 로직

**현재 문제점**:
```javascript
// backend/services/issues.service.js
const categorizedIssues = issues.map(issue => {
  const contentToCategorize = `${issue.summary || ''} ${issue.detail || ''} ${issue.firstPost || ''}`;
  const { categories, primaryCategory } = categorizeIssue(contentToCategorize);
  // ...
});
```
- 매번 조회 시마다 카테고리 분류 수행 (비효율)
- 분류 결과가 DB에 저장되지 않음

**개선 방안**:
1. 이슈 생성/업데이트 시 카테고리 분류 수행
2. 분류 결과를 DB에 저장 (categoryGroupId, categoryId 활용)
3. 조회 시에는 저장된 카테고리 사용

### 4.2 프로젝트 ID 필터링 로직

**현재 문제점**:
```javascript
// backend/services/issues.service.js:108-113
if (projectId !== undefined && projectId !== null) {
  where.OR = [
    { projectId: projectId },
    { projectId: null } // 크롤링된 이슈 등 projectId가 없는 이슈도 포함
  ];
}
```
- projectId가 null인 이슈까지 포함하여 필터링 의미가 약함
- 명시적 필터 옵션 필요

**개선 방안**:
```javascript
// 옵션 추가
const options = {
  projectId,
  includeCrawledIssues: false // 기본값: false
};

if (projectId !== undefined && projectId !== null) {
  if (options.includeCrawledIssues) {
    where.OR = [{ projectId }, { projectId: null }];
  } else {
    where.projectId = projectId;
  }
}
```

### 4.3 SLA 계산 로직

**현재 문제점**:
```javascript
// src/App.tsx:622-629
const responseTimeMs = severity === 1 ? 10 * 60 * 1000 : 
                        severity === 2 ? 30 * 60 * 1000 : 
                        60 * 60 * 1000;
```
- 하드코딩된 SLA 시간
- 프로젝트별/채널별 SLA 정책 무시

**개선 방안**:
1. SlaPolicy 테이블에서 동적으로 SLA 조회
2. 프로젝트별, 심각도별, 채널별 SLA 정책 지원
3. 프론트엔드에서도 동일한 로직 사용

### 4.4 워커 프로세스 관리

**현재 문제점**:
```javascript
// backend/server.js:163-228
function startMonitoringWorker(workerName, scriptPath) {
  // 프로세스 재시작 로직이 복잡하고 에러 처리 부족
}
```
- 워커 프로세스 재시작 로직이 복잡
- 워커 상태 모니터링 부족
- 워커 간 의존성 관리 없음

**개선 방안**:
1. 워커 상태 관리 서비스 도입
2. 워커 헬스체크 메커니즘 추가
3. 워커 재시작 정책 설정 가능하도록 개선

### 4.5 Excel 파싱 로직

**현재 문제점**:
- Excel 파일 파싱 시 에러 처리 부족
- 대용량 파일 처리 시 메모리 이슈 가능
- 파싱 결과 검증 로직 부족

**개선 방안**:
1. 스트리밍 방식으로 대용량 파일 처리
2. 파싱 결과 검증 로직 강화
3. 에러 발생 시 부분 실패 처리 (일부 행만 실패해도 나머지 처리)

---

## 5. 코딩 오류 및 버그

### 5.1 타입 안정성 문제

**문제점**:
```javascript
// backend/services/issues.service.js:9-18
function normalizeProjectIdInput(projectId) {
  if (projectId === undefined || projectId === null || projectId === '') {
    return undefined;
  }
  const id = Number(projectId);
  if (Number.isNaN(id)) {
    throw new Error('Invalid project id');
  }
  return id;
}
```
- 문자열 '0'이 falsy로 처리될 수 있음
- 타입 체크가 일관되지 않음

**수정안**:
```javascript
function normalizeProjectIdInput(projectId) {
  if (projectId === undefined || projectId === null || projectId === '') {
    return undefined;
  }
  // '0'도 유효한 값으로 처리
  if (projectId === 0 || projectId === '0') {
    return 0;
  }
  const id = Number(projectId);
  if (Number.isNaN(id) || id <= 0) {
    throw new Error('Invalid project id');
  }
  return id;
}
```

### 5.2 메모리 누수 가능성

**문제점**:
```javascript
// backend/server.js:416-425
const interval = setInterval(() => {
  ws.send(JSON.stringify({
    type: 'state_update',
    payload: { agents: agents || [], tickets: tickets || [] }
  }));
}, 5000);
```
- WebSocket 연결이 끊겨도 interval이 정리되지 않을 수 있음
- 대량의 WebSocket 연결 시 메모리 누수 가능

**수정안**:
```javascript
ws.on('close', () => {
  logger.info('WebSocket client disconnected');
  clearInterval(interval);
  // 추가 정리 작업
});
```

### 5.3 Race Condition

**문제점**:
```javascript
// backend/services/naverCafeIssues.service.js (추정)
// 동시에 같은 URL을 크롤링할 경우 중복 이슈 생성 가능
```
- 모니터링 워커가 동시에 같은 URL을 처리할 경우 중복 이슈 생성
- externalPostId로 중복 체크하지만 race condition 가능

**수정안**:
1. 데이터베이스 유니크 제약 조건 활용
2. 분산 락 메커니즘 도입 (Redis 등)
3. upsert 로직 강화

### 5.4 에러 처리 누락

**문제점**:
```javascript
// backend/server.js:76-83
} catch (err) {
  logger.error('[NaverCafeScheduler] Failed for URL', { 
    url: mu.url, 
    error: err.message,
    stack: err.stack 
  });
  // 개별 URL 실패는 전체 스케줄러를 중단하지 않음
}
```
- 에러 발생 시 재시도 로직 없음
- 연속 실패 시 알림 없음

**수정안**:
1. 재시도 로직 추가 (exponential backoff)
2. 연속 실패 시 알림 발송
3. 실패 카운터 및 임계값 설정

### 5.5 SQL Injection 위험 (낮음)

**현재 상태**: Prisma 사용으로 대부분 안전하나, 일부 Raw Query 사용 시 주의 필요

**권장사항**:
- 모든 Raw Query에 파라미터 바인딩 사용
- 사용자 입력은 반드시 Prisma의 파라미터화된 쿼리 사용

---

## 6. 중복 코드 분석

### 6.1 프로젝트 ID 파싱 로직 중복

**발견 위치**:
- `backend/controllers/issues.controller.js:8-12`
- `backend/controllers/issues.controller.js:77`
- 기타 여러 컨트롤러

**중복 코드**:
```javascript
const parseProjectId = (value) => {
  if (!value && value !== 0) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};
```

**개선 방안**:
```javascript
// backend/utils/validators.js
exports.parseProjectId = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value === 0 || value === '0') return 0;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};
```

### 6.2 에러 응답 포맷 중복

**발견 위치**: 모든 컨트롤러

**중복 코드**:
```javascript
try {
  // ...
} catch (error) {
  logger.error('Failed to ...', { error: error.message });
  sendError(res, 'Failed to ...', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
}
```

**개선 방안**:
```javascript
// backend/middlewares/error.middleware.js에 통합
// 또는 Service 레이어에서 에러를 던지고, Controller에서는 catch만 수행
```

### 6.3 이슈 상태 업데이트 로직 중복

**발견 위치**:
- `backend/services/issues.service.js` (checkIssue, processIssue 등)
- 유사한 패턴 반복

**개선 방안**:
```javascript
// 공통 함수로 추출
async function updateIssueStatus(issueId, status, agentId, timestampField) {
  // 공통 로직
}
```

### 6.4 프론트엔드 API 호출 중복

**발견 위치**: `src/App.tsx`

**중복 코드**:
```javascript
const res = await fetch(withProjectParam(`/api/issues/${issueId}/...`), {
  method: 'POST',
  headers: {
    ...authHeaders,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ ... })
});
```

**개선 방안**:
```typescript
// src/utils/api.ts
export const apiClient = {
  post: (path: string, data: any) => {
    return fetch(withProjectParam(path), {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  },
  // ...
};
```

---

## 7. 성능 최적화 방안

### 7.1 N+1 쿼리 문제

**문제점**:
```javascript
// backend/services/issues.service.js:137-161
const issues = await prisma.reportItemIssue.findMany({
  include: {
    report: { select: { agentId: true } },
    assignedAgent: { select: { id: true, name: true } },
    categoryGroup: true,
    category: true,
    // ...
  }
});
```
- include는 적절히 사용되고 있으나, 일부 쿼리에서 N+1 가능성

**개선 방안**:
1. Prisma의 `include` 최적화
2. 필요한 필드만 `select`로 지정 (현재 적용 중)
3. 쿼리 성능 모니터링 도구 도입

### 7.2 대량 데이터 처리

**문제점**:
```javascript
// src/App.tsx:605
const params = new URLSearchParams({ limit: "1000" });
```
- 프론트엔드에서 1000건을 한 번에 로드
- 가상 스크롤 사용 중이지만 초기 로딩 시간 길음

**개선 방안**:
1. 페이지네이션 강화 (서버 사이드)
2. 무한 스크롤 구현
3. 중요 이슈만 우선 로드, 나머지는 지연 로드

### 7.3 Excel 파일 처리

**문제점**:
- 대용량 Excel 파일 처리 시 메모리 사용량 증가
- 스트리밍 처리 미적용

**개선 방안**:
1. ExcelJS의 스트리밍 API 사용
2. 청크 단위로 처리
3. 진행률 표시

### 7.4 WebSocket 메시지 최적화

**문제점**:
```javascript
// backend/server.js:416-425
ws.send(JSON.stringify({
  type: 'state_update',
  payload: { agents: agents || [], tickets: tickets || [] }
}));
```
- 5초마다 전체 agents와 tickets 전송
- 변경된 데이터만 전송하는 것이 효율적

**개선 방안**:
1. 변경 감지 로직 추가
2. 변경된 데이터만 전송 (delta 업데이트)
3. 클라이언트에서 merge 로직 구현

### 7.5 데이터베이스 인덱스 최적화

**현재 상태**: Prisma 스키마에 인덱스는 정의되어 있음

**개선 방안**:
1. 쿼리 성능 분석 (EXPLAIN QUERY PLAN)
2. 자주 사용되는 쿼리 패턴에 맞춘 복합 인덱스 추가
3. 불필요한 인덱스 제거 (쓰기 성능 향상)

---

## 8. 프론트엔드 분석 (React)

### 8.1 렌더링 성능 분석

#### 8.1.1 useMemo/useCallback 사용 현황

**현재 상태**:
```typescript
// src/App.tsx
const filteredTickets = useMemo(() => tickets.filter(...), [tickets, filter]);
const highPriorityTickets = useMemo(() => ..., [filteredTickets]);
const visibleTickets = useMemo(() => normalTickets.slice(0, visibleCount), [normalTickets, visibleCount]);
const handleLoadMore = useCallback(() => ..., [hasMoreTickets, normalTickets.length]);
```

**강점**:
✅ **필터링 결과 메모이제이션**: `filteredTickets`, `highPriorityTickets`, `normalTickets` 등이 적절히 메모이제이션됨  
✅ **가상 스크롤 사용**: `react-virtuoso`를 사용하여 대량 데이터 렌더링 최적화  
✅ **조건부 렌더링**: 중요 이슈와 일반 이슈를 분리하여 렌더링

**문제점**:
❌ **렌더 함수 미메모이제이션**: `renderCardItem`, `renderListRow` 함수가 `useCallback`으로 감싸져 있지 않음  
❌ **인라인 함수 사용**: 이벤트 핸들러에서 인라인 함수 생성으로 불필요한 리렌더링 유발  
❌ **복잡한 계산 로직**: `getRowBgColor` 같은 함수가 매 렌더마다 실행

**개선 방안**:
```typescript
// renderCardItem을 useCallback으로 감싸기
const renderCardItem = useCallback((ticket: Ticket) => {
  // ... 기존 로직
}, [selectedTicketIds, projectAgents, getCurrentAgentId]);

// getRowBgColor를 useMemo로 메모이제이션
const rowBgColorMap = useMemo(() => {
  return tickets.reduce((acc, ticket) => {
    acc[ticket.id] = getRowBgColor(
      ticket.severity, 
      !!ticket.checkedAt, 
      !!ticket.processedAt,
      ticket.gameName,
      ticket.trend
    );
    return acc;
  }, {} as Record<string, string>);
}, [tickets]);
```

#### 8.1.2 불필요한 리렌더링 유발 코드

**문제점 1: 인라인 객체 생성**
```typescript
// src/App.tsx:214-220
const authHeaders = useMemo<Record<string, string>>(() => {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}, [token]);
```
✅ 이미 `useMemo`로 최적화되어 있음

**문제점 2: 함수 참조 불안정**
```typescript
// src/App.tsx:960-1076
const createTicketInteractions = (ticket: Ticket) => {
  // 매번 새로운 함수 객체 생성
  const handleRowClick = () => { ... };
  const handleLinkClick = async (e?: MouseEvent) => { ... };
  // ...
};
```
❌ `createTicketInteractions`가 매 렌더마다 호출되어 새로운 함수 생성

**개선 방안**:
```typescript
// useCallback으로 감싸기
const createTicketInteractions = useCallback((ticket: Ticket) => {
  const handleRowClick = useCallback(() => {
    // ...
  }, [ticket.id, selectedTicketIds.size]);
  
  const handleLinkClick = useCallback(async (e?: MouseEvent) => {
    // ...
  }, [ticket.id, ticket.link, currentAgentId]);
  
  // ...
}, [selectedTicketIds, currentAgentId]);
```

**문제점 3: 조건부 렌더링 최적화 부족**
```typescript
// src/App.tsx:1078-1185
const renderCardItem = (ticket: Ticket) => {
  const interactions = createTicketInteractions(ticket);
  // 매번 createTicketInteractions 호출
  // ...
};
```
- `renderCardItem`이 VirtualList의 `itemContent`로 전달되지만, 매번 새로운 함수로 인식될 수 있음

**개선 방안**:
```typescript
// itemContent를 useCallback으로 고정
const itemContent = useCallback((index: number, ticket: Ticket) => {
  return viewMode === "list" 
    ? renderListRow(ticket) 
    : renderCardItem(ticket);
}, [viewMode, selectedTicketIds, projectAgents]);
```

#### 8.1.3 대량 데이터 렌더링

**현재 상태**:
- `react-virtuoso`를 사용한 가상 스크롤 ✅
- 초기 로드: 1000건 (limit: 1000)
- 점진적 로딩: 50건씩 추가

**문제점**:
- 초기 1000건을 모두 메모리에 로드
- 필터링/정렬이 클라이언트 사이드에서 수행됨

**개선 방안**:
1. 서버 사이드 페이지네이션으로 전환
2. 초기 로드량 감소 (예: 100건)
3. 무한 스크롤로 점진적 로딩

### 8.2 상태 관리 분석

#### 8.2.1 Props Drilling 문제

**현재 상태**:
```typescript
// src/App.tsx:2017-2031
{selectedTicket && (
  <IssueDetailPanel
    ticket={selectedTicket}
    agents={projectAgents}
    comments={issueComments}
    commentsLoading={commentsLoading}
    newComment={commentInput}
    submittingComment={commentSubmitting}
    onClose={closeDetailPanel}
    onStatusChange={handleStatusUpdate}
    onAssignAgent={handleAssignAgent}
    onCommentChange={setCommentInput}
    onSubmitComment={handleCommentSubmit}
  />
)}
```

**문제점**:
❌ **과도한 Props 전달**: `IssueDetailPanel`에 9개의 props 전달  
❌ **상태 분산**: 이슈 관련 상태가 `App.tsx`에 집중  
❌ **콜백 함수 전달**: 여러 핸들러 함수를 props로 전달

**개선 방안 1: Context API 활용**
```typescript
// src/contexts/IssueContext.tsx
const IssueContext = createContext<{
  selectedTicket: Ticket | null;
  comments: IssueComment[];
  updateTicket: (ticket: Ticket) => void;
  // ...
} | null>(null);

// App.tsx에서 Provider로 감싸기
<IssueContext.Provider value={issueContextValue}>
  {selectedTicket && <IssueDetailPanel />}
</IssueContext.Provider>

// IssueDetailPanel에서 직접 사용
const { selectedTicket, comments, updateTicket } = useIssueContext();
```

**개선 방안 2: Custom Hook으로 로직 분리**
```typescript
// src/hooks/useIssueDetail.ts
export function useIssueDetail(ticketId: string) {
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [loading, setLoading] = useState(false);
  
  const fetchComments = useCallback(async () => {
    // ...
  }, [ticketId]);
  
  const submitComment = useCallback(async (body: string) => {
    // ...
  }, [ticketId]);
  
  return { comments, loading, fetchComments, submitComment };
}

// IssueDetailPanel에서 사용
const { comments, loading, submitComment } = useIssueDetail(ticket.issueId);
```

#### 8.2.2 전역 상태 관리

**현재 상태**:
- `AuthContext`: 인증 관련 상태 (✅ 적절히 사용)
- `useRealtime`: WebSocket 실시간 데이터 (✅ Custom Hook으로 잘 분리)
- `App.tsx`: 대부분의 상태를 로컬 state로 관리

**문제점**:
❌ **상태 중앙화 부족**: 이슈, 티켓, 에이전트 상태가 `App.tsx`에 집중  
❌ **상태 동기화 복잡**: WebSocket 업데이트와 로컬 상태 동기화가 복잡

**개선 방안**:
1. **상태 관리 라이브러리 도입 고려** (Zustand, Jotai 등)
   ```typescript
   // src/stores/issueStore.ts (Zustand 예시)
   const useIssueStore = create<{
     tickets: Ticket[];
     agents: Agent[];
     setTickets: (tickets: Ticket[]) => void;
     updateTicket: (id: string, updates: Partial<Ticket>) => void;
   }>((set) => ({
     tickets: [],
     agents: [],
     setTickets: (tickets) => set({ tickets }),
     updateTicket: (id, updates) => set((state) => ({
       tickets: state.tickets.map(t => t.id === id ? { ...t, ...updates } : t)
     }))
   }));
   ```

2. **WebSocket 상태 통합**
   ```typescript
   // useRealtime에서 받은 업데이트를 스토어에 반영
   useRealtime({
     handlers: {
       onIssueUpdated: (payload) => {
         useIssueStore.getState().updateTicket(payload.issueId, payload);
       }
     }
   });
   ```

#### 8.2.3 상태 업데이트 패턴

**문제점**:
```typescript
// src/App.tsx:1000-1012
setTickets(prev => prev.map(t =>
  t.id === ticket.id
    ? { ...t, checkedAt: timestamp, checkedBy: currentAgentId }
    : t
));
```
- 상태 업데이트가 여러 곳에 분산
- 일관성 없는 업데이트 패턴

**개선 방안**:
```typescript
// 통일된 업데이트 함수
const updateTicket = useCallback((ticketId: string, updates: Partial<Ticket>) => {
  setTickets(prev => prev.map(t => 
    t.id === ticketId ? { ...t, ...updates } : t
  ));
}, []);

// 사용
updateTicket(ticket.id, { 
  checkedAt: timestamp, 
  checkedBy: currentAgentId 
});
```

### 8.3 컴포넌트 구조 분석

#### 8.3.1 컴포넌트 분리 현황

**현재 구조**:
```
src/
├── App.tsx (2034 lines) ⚠️ 매우 큰 파일
├── components/
│   ├── IssueDetailPanel.tsx (967 lines) ⚠️ 큰 파일
│   ├── VirtualList.tsx (32 lines) ✅ 적절한 크기
│   ├── ProjectSelector.tsx (37 lines) ✅ 적절한 크기
│   ├── MetricsOverview.tsx (49 lines) ✅ 적절한 크기
│   └── ScheduleCalendar.tsx
└── ...
```

**문제점**:
❌ **App.tsx 과대**: 2034 라인으로 너무 큰 단일 컴포넌트  
❌ **IssueDetailPanel 과대**: 967 라인으로 복잡한 컴포넌트  
❌ **재사용 컴포넌트 부족**: 버튼, 카드, 배지 등이 인라인으로 작성됨

**개선 방안 1: App.tsx 분리**
```typescript
// src/components/TicketCard.tsx
export const TicketCard = React.memo(({ ticket, onSelect, ... }) => {
  // renderCardItem 로직 분리
});

// src/components/TicketListRow.tsx
export const TicketListRow = React.memo(({ ticket, onSelect, ... }) => {
  // renderListRow 로직 분리
});

// src/components/HighPrioritySection.tsx
export const HighPrioritySection = ({ tickets, ... }) => {
  // 중요 이슈 섹션 분리
};

// src/components/NormalTicketSection.tsx
export const NormalTicketSection = ({ tickets, ... }) => {
  // 일반 이슈 섹션 분리
};

// App.tsx는 조합만 수행
export default function App() {
  return (
    <>
      <HighPrioritySection tickets={highPriorityTickets} />
      <NormalTicketSection tickets={normalTickets} />
    </>
  );
}
```

**개선 방안 2: 공통 UI 컴포넌트 생성**
```typescript
// src/components/ui/Button.tsx
export const Button = React.memo(({ 
  variant = 'primary', 
  size = 'md', 
  children, 
  ...props 
}) => {
  const className = `px-3 py-1.5 rounded-lg ${variantClasses[variant]} ${sizeClasses[size]}`;
  return <button className={className} {...props}>{children}</button>;
});

// src/components/ui/Badge.tsx
export const Badge = React.memo(({ 
  variant, 
  children 
}) => {
  return <span className={`px-2 py-0.5 rounded-full ${variantClasses[variant]}`}>{children}</span>;
});

// src/components/ui/Card.tsx
export const Card = React.memo(({ 
  children, 
  className = '' 
}) => {
  return <div className={`rounded-lg border p-4 ${className}`}>{children}</div>;
});
```

**개선 방안 3: IssueDetailPanel 분리**
```typescript
// src/components/IssueDetailPanel/
├── IssueDetailPanel.tsx (메인 컨테이너)
├── OriginalContentSection.tsx (원문 영역)
├── ClassificationSection.tsx (분류 영역)
├── CommentSection.tsx (코멘트 영역)
├── ShareModal.tsx (슬랙 공유 모달)
└── ScreenshotViewer.tsx (스크린샷 뷰어)
```

#### 8.3.2 재사용성 문제

**문제점 1: 인라인 스타일 반복**
```typescript
// src/App.tsx:1094-1100
<div className={classNames(
  "mb-1.5 rounded-lg border p-1.5 text-xs shadow-sm transition-all",
  getRowBgColor(ticket.severity, isChecked, isProcessed, ticket.gameName, ticket.trend),
  isSelected && "ring-2 ring-blue-300"
)}>
```
- 동일한 스타일 패턴이 여러 곳에 반복

**개선 방안**:
```typescript
// src/components/TicketCard/TicketCard.tsx
export const TicketCard = ({ ticket, isSelected, ... }) => {
  const bgColor = useMemo(() => 
    getRowBgColor(ticket.severity, ticket.checkedAt, ticket.processedAt, ticket.gameName, ticket.trend),
    [ticket.severity, ticket.checkedAt, ticket.processedAt, ticket.gameName, ticket.trend]
  );
  
  return (
    <div className={classNames(
      "ticket-card", // CSS 클래스로 추출
      bgColor,
      isSelected && "ticket-card--selected"
    )}>
      {/* ... */}
    </div>
  );
};
```

**문제점 2: 중복된 필터 UI**
```typescript
// src/App.tsx:1358-1390
<select className="border rounded-md px-2 py-1 bg-white" value={filter.game || "all"}
  onChange={e=>setFilter(f=>({...f, game: e.target.value as any}))}>
  {/* ... */}
</select>
```
- 필터 select가 4개 반복됨

**개선 방안**:
```typescript
// src/components/FilterSelect.tsx
export const FilterSelect = <T,>({
  value,
  options,
  onChange,
  label,
  allLabel = "모든 ..."
}: FilterSelectProps<T>) => {
  return (
    <select 
      className="border rounded-md px-2 py-1 bg-white"
      value={value || "all"}
      onChange={e => onChange(e.target.value === "all" ? undefined : e.target.value as T)}
    >
      <option value="all">{allLabel}</option>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
};

// 사용
<FilterSelect
  label="게임"
  value={filter.game}
  options={availableGames.map(g => ({ value: g, label: g === 'PUBG_PC' ? 'PUBG PC' : 'PUBG Mobile' }))}
  onChange={game => setFilter(f => ({ ...f, game }))}
/>
```

### 8.4 프론트엔드 성능 메트릭

**현재 상태**:
- **컴포넌트 수**: 약 10개 (작은 편)
- **최대 컴포넌트 크기**: App.tsx 2034 라인
- **useMemo/useCallback 사용**: 12개 (적절)
- **React.memo 사용**: 0개 (부족)

**권장 개선 목표**:
- ✅ 컴포넌트당 200 라인 이하
- ✅ 재사용 가능한 UI 컴포넌트 10개 이상
- ✅ React.memo 적용률 50% 이상
- ✅ useCallback 적용률 80% 이상 (이벤트 핸들러)

### 8.5 프론트엔드 개선 우선순위

#### 🔴 높은 우선순위

1. **App.tsx 분리** (2-3일)
   - TicketCard, TicketListRow 컴포넌트 분리
   - HighPrioritySection, NormalTicketSection 분리
   - 필터 UI 컴포넌트화

2. **렌더 함수 메모이제이션** (1일)
   - renderCardItem, renderListRow를 useCallback으로 감싸기
   - itemContent 함수 고정

3. **공통 UI 컴포넌트 생성** (2일)
   - Button, Badge, Card, Select 등

#### 🟡 중간 우선순위

4. **IssueDetailPanel 분리** (2-3일)
   - 섹션별로 컴포넌트 분리
   - 모달 컴포넌트 분리

5. **상태 관리 개선** (3-5일)
   - Context API 또는 Zustand 도입
   - Props Drilling 해결

6. **React.memo 적용** (1-2일)
   - 자주 리렌더링되는 컴포넌트에 적용

#### 🟢 낮은 우선순위

7. **서버 사이드 페이지네이션** (3-5일)
   - 초기 로드량 감소
   - 무한 스크롤 개선

8. **코드 스플리팅** (2-3일)
   - 라우트별 코드 스플리팅
   - 동적 import 활용

---

## 9. 모니터링 워커 안정성 검토

### 9.1 에러 핸들링 및 재시도 로직

#### 9.1.1 현재 상태

**Naver Cafe 워커**:
```javascript
// backend/workers/monitoring/naverCafe.worker.js:287-305
for (let retry = 0; retry < 3; retry++) {
  try {
    await page.waitForSelector('.se-main-container', { timeout: 15000 });
    seMainContainer = await page.$('.se-main-container');
    if (seMainContainer) break;
  } catch (e) {
    if (retry < 2) {
      await page.waitForTimeout(3000); // 고정 3초 대기
    }
  }
}
```

**문제점**:
❌ **고정 딜레이**: 재시도 시 항상 3초 대기 (지수 백오프 없음)  
❌ **제한된 재시도**: 네트워크 타임아웃 시 3회만 재시도  
❌ **전역 재시도 부재**: API 요청 실패 시 재시도 로직 없음  
❌ **타임아웃 설정**: 30초 타임아웃이지만 재시도 시 누적 시간 증가

**Discord 워커**:
```javascript
// backend/workers/monitoring/discord.worker.js
// 재시도 로직 없음
client.on('error', (error) => {
  logger.error('[DiscordWorker] Discord client error', { error: error.message });
  // 재연결 시도 없음
});
```

**문제점**:
❌ **에러 후 재연결 없음**: Discord 연결 실패 시 수동 재시작 필요  
❌ **일시적 네트워크 오류 처리 부족**: API 요청 실패 시 재시도 없음

**Slack 워커**:
```javascript
// backend/workers/ingestion/slackNotice.worker.js:253-264
const result = await slackClient.conversations.history({
  channel: SLACK_NOTICE_CHANNEL_ID,
  oldest: oldest.toString(),
  limit: 100
});

if (!result.ok) {
  logger.error('[SlackNoticeWorker] Failed to fetch messages', {
    error: result.error
  });
  return; // 재시도 없이 종료
}
```

**문제점**:
❌ **API 실패 시 재시도 없음**: Slack API 실패 시 다음 주기까지 대기  
❌ **레이트 리밋 처리 부족**: Slack API 레이트 리밋 발생 시 대응 없음

#### 9.1.2 개선 방안

**1. 지수 백오프 재시도 유틸리티 생성**
```javascript
// backend/utils/retry.js
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    onRetry = null
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // 마지막 시도가 아니면 재시도
      if (attempt < maxRetries) {
        if (onRetry) {
          onRetry(attempt + 1, error, delay);
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffMultiplier, maxDelay);
      }
    }
  }

  throw lastError;
}
```

**2. Naver Cafe 워커에 적용**
```javascript
// backend/workers/monitoring/naverCafe.worker.js
const { retryWithBackoff } = require('../../utils/retry');

// 게시판 목록 페이지 로드
await retryWithBackoff(
  () => page.goto(targetUrl, { 
    waitUntil: 'networkidle',
    timeout: 30000 
  }),
  {
    maxRetries: 3,
    initialDelay: 2000,
    maxDelay: 10000,
    onRetry: (attempt, error, delay) => {
      logger.warn(`[NaverCafeWorker] Retry ${attempt}/3 after ${delay}ms`, {
        url: targetUrl,
        error: error.message
      });
    }
  }
);
```

**3. Discord 워커 재연결 로직**
```javascript
// backend/workers/monitoring/discord.worker.js
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

client.on('error', async (error) => {
  logger.error('[DiscordWorker] Discord client error', { error: error.message });
  
  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
    
    logger.info(`[DiscordWorker] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    
    setTimeout(async () => {
      try {
        await client.destroy();
        await start(); // 재시작
        reconnectAttempts = 0;
      } catch (err) {
        logger.error('[DiscordWorker] Reconnection failed', { error: err.message });
      }
    }, delay);
  } else {
    logger.error('[DiscordWorker] Max reconnection attempts reached');
    process.exit(1);
  }
});
```

**4. Slack 워커 레이트 리밋 처리**
```javascript
// backend/workers/ingestion/slackNotice.worker.js
async function collectSlackMessages() {
  // ...
  
  const result = await retryWithBackoff(
    () => slackClient.conversations.history({
      channel: SLACK_NOTICE_CHANNEL_ID,
      oldest: oldest.toString(),
      limit: 100
    }),
    {
      maxRetries: 5,
      initialDelay: 1000,
      maxDelay: 60000, // Slack 레이트 리밋: 최대 1분 대기
      onRetry: (attempt, error, delay) => {
        // 레이트 리밋 감지
        if (error.message?.includes('rate_limited')) {
          const retryAfter = error.retryAfter || delay;
          logger.warn(`[SlackNoticeWorker] Rate limited, retrying after ${retryAfter}ms`);
          return retryAfter;
        }
        return delay;
      }
    }
  );
}
```

### 9.2 프로세스 관리 및 좀비 프로세스 방지

#### 9.2.1 현재 상태

**프로세스 생성 및 종료**:
```javascript
// backend/server.js:168-227
const workerProcess = spawn('node', [workerPath], {
  cwd: __dirname,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env }
});

// 종료 처리
kill(pid, 'SIGTERM', (err) => {
  if (err) {
    kill(pid, 'SIGKILL'); // 강제 종료
  }
  resolve();
});
```

**문제점**:
❌ **wait() 호출 없음**: 자식 프로세스 종료를 기다리지 않아 좀비 프로세스 가능성  
❌ **타임아웃 없음**: SIGTERM 후 무한 대기 가능성  
❌ **프로세스 그룹 관리 부족**: 자식의 자식 프로세스(Playwright 브라우저 등) 종료 보장 부족

**워커 종료 처리**:
```javascript
// backend/workers/monitoring/naverCafe.worker.js:831-828
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

async function stop() {
  if (scanInterval) clearInterval(scanInterval);
  if (browser) await browser.close();
  // 하지만 process.exit() 호출 없음
}
```

**문제점**:
❌ **비동기 정리 완료 대기 없음**: stop()이 완료되기 전에 프로세스가 종료될 수 있음  
❌ **브라우저 프로세스 정리**: Playwright 브라우저의 자식 프로세스 정리 보장 부족

#### 9.2.2 개선 방안

**1. 프로세스 종료 개선 (server.js)**
```javascript
// backend/server.js
async function stopAllMonitoringWorkers() {
  logger.info('[WorkerManager] Stopping all monitoring workers');
  
  const stopPromises = [];
  const KILL_TIMEOUT_MS = 10000; // 10초 타임아웃
  
  for (const [workerName, workerInfo] of workerProcesses.entries()) {
    if (workerInfo.restartTimeout) {
      clearTimeout(workerInfo.restartTimeout);
    }
    
    if (workerInfo.process) {
      logger.info(`[WorkerManager] Stopping ${workerName}`);
      
      const stopPromise = new Promise((resolve) => {
        const pid = workerInfo.process.pid;
        let killed = false;
        
        // 타임아웃 설정
        const timeout = setTimeout(() => {
          if (!killed) {
            logger.warn(`[WorkerManager] Force killing ${workerName} after timeout`);
            try {
              kill(pid, 'SIGKILL');
            } catch (err) {
              logger.error(`[WorkerManager] Failed to force kill ${workerName}`, { error: err.message });
            }
            killed = true;
            resolve();
          }
        }, KILL_TIMEOUT_MS);
        
        // 프로세스 종료 대기
        workerInfo.process.on('exit', (code, signal) => {
          if (!killed) {
            clearTimeout(timeout);
            killed = true;
            logger.info(`[WorkerManager] ${workerName} exited`, { code, signal });
            resolve();
          }
        });
        
        // SIGTERM 전송
        try {
          kill(pid, 'SIGTERM');
        } catch (err) {
          logger.error(`[WorkerManager] Failed to send SIGTERM to ${workerName}`, { error: err.message });
          clearTimeout(timeout);
          killed = true;
          resolve();
        }
      });
      
      stopPromises.push(stopPromise);
    }
  }
  
  // 모든 프로세스 종료 대기
  await Promise.all(stopPromises);
  workerProcesses.clear();
}
```

**2. 워커 종료 처리 개선**
```javascript
// backend/workers/monitoring/naverCafe.worker.js
let isShuttingDown = false;

async function stop() {
  if (!isRunning || isShuttingDown) return;
  
  isShuttingDown = true;
  isRunning = false;
  logger.info('[NaverCafeWorker] Stopping...');

  // 1. 스캔 중단
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }

  // 2. 브라우저 종료 (모든 페이지 닫기)
  if (browser) {
    try {
      // 모든 페이지 닫기
      const pages = await browser.pages();
      await Promise.all(pages.map(page => page.close().catch(() => {})));
      
      // 브라우저 종료
      await browser.close();
      browser = null;
    } catch (error) {
      logger.error('[NaverCafeWorker] Error closing browser', { error: error.message });
    }
  }

  logger.info('[NaverCafeWorker] Stopped');
  
  // 정리 완료 후 프로세스 종료
  process.exit(0);
}

// 시그널 핸들러 개선
process.on('SIGTERM', async () => {
  logger.info('[NaverCafeWorker] SIGTERM received');
  await stop();
});

process.on('SIGINT', async () => {
  logger.info('[NaverCafeWorker] SIGINT received');
  await stop();
});
```

**3. 좀비 프로세스 방지**
```javascript
// backend/server.js:168-172
const workerProcess = spawn('node', [workerPath], {
  cwd: __dirname,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
  detached: false, // 부모 프로세스와 연결 유지
  killSignal: 'SIGTERM'
});

// 자식 프로세스 종료 감지 및 정리
workerProcess.on('exit', (code, signal) => {
  // waitpid() 자동 호출됨 (detached: false일 때)
  logger.info(`[WorkerManager] ${workerName} exited`, { code, signal });
});
```

### 9.3 확장성 분석 (100개 크롤링 대상 시나리오)

#### 9.3.1 현재 구조 분석

**Naver Cafe 워커**:
```javascript
// backend/workers/monitoring/naverCafe.worker.js:718-736
for (const board of boards) {
  // Interval 체크
  if (board.lastScanAt) {
    const diffSec = (Date.now() - new Date(board.lastScanAt).getTime()) / 1000;
    if (diffSec < interval) {
      continue; // 스킵
    }
  }
  
  await scanBoard(board); // 순차 처리
}
```

**예상 성능 (100개 게시판)**:
- **스캔 시간**: 게시판당 평균 30초 (페이지 로드 + 게시글 처리)
- **총 소요 시간**: 100개 × 30초 = 3,000초 (50분)
- **스캔 주기**: 기본 5분 (300초)
- **문제**: 스캔 주기(5분)보다 총 소요 시간(50분)이 훨씬 길어 다음 스캔이 시작되기 전에 이전 스캔이 끝나지 않음

**병목 구간**:
1. **순차 처리**: 게시판을 하나씩 처리하여 병렬 처리 불가
2. **단일 브라우저 인스턴스**: Playwright 브라우저가 하나만 있어 동시 처리 제한
3. **데이터베이스 연결**: Prisma 연결 풀 제한 (기본 10개)
4. **네트워크 대역폭**: 동시 요청 제한

#### 9.3.2 병목 구간 상세 분석

**1. 브라우저 인스턴스 제한**
```javascript
// 현재: 단일 브라우저 인스턴스
browser = await chromium.launch({ ... });

// 각 게시판마다 새 페이지 생성
const page = await browser.newPage();
```
- **문제**: 브라우저당 최대 페이지 수 제한 (약 100개)
- **해결**: 여러 브라우저 인스턴스 또는 브라우저 풀 필요

**2. 데이터베이스 연결 풀**
```javascript
// Prisma 기본 설정
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```
- **SQLite 제한**: 동시 쓰기 제한 (WAL 모드에서도 제한적)
- **문제**: 100개 게시판 동시 처리 시 DB 락 발생 가능

**3. 네트워크 요청 제한**
```javascript
// 각 게시글마다 페이지 로드
await page.goto(articleUrl, { 
  waitUntil: 'networkidle',
  timeout: 30000 
});
```
- **문제**: 네이버 서버의 동시 연결 제한
- **문제**: 과도한 요청 시 IP 차단 가능성

#### 9.3.3 개선 방안

**1. 병렬 처리 도입**
```javascript
// backend/workers/monitoring/naverCafe.worker.js
const CONCURRENT_BOARDS = 5; // 동시 처리 게시판 수

async function scanAllBoards() {
  // ...
  
  const boardsToScan = boards.filter(board => {
    const interval = board.checkInterval || board.interval || 300;
    if (board.lastScanAt) {
      const diffSec = (Date.now() - new Date(board.lastScanAt).getTime()) / 1000;
      return diffSec >= interval;
    }
    return true;
  });
  
  // 병렬 처리 (배치 단위)
  for (let i = 0; i < boardsToScan.length; i += CONCURRENT_BOARDS) {
    const batch = boardsToScan.slice(i, i + CONCURRENT_BOARDS);
    
    await Promise.all(
      batch.map(board => scanBoard(board).catch(error => {
        logger.error('[NaverCafeWorker] Board scan failed', {
          boardId: board.id,
          error: error.message
        });
      }))
    );
    
    // 배치 간 딜레이 (서버 부하 방지)
    if (i + CONCURRENT_BOARDS < boardsToScan.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}
```

**2. 브라우저 풀 구현**
```javascript
// backend/workers/monitoring/naverCafe.worker.js
const BROWSER_POOL_SIZE = 3;

let browserPool = [];

async function initBrowserPool() {
  browserPool = await Promise.all(
    Array.from({ length: BROWSER_POOL_SIZE }, () =>
      chromium.launch({
        headless: BROWSER_HEADLESS,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      })
    )
  );
  logger.info('[NaverCafeWorker] Browser pool initialized', { size: BROWSER_POOL_SIZE });
}

async function getBrowser() {
  // 라운드 로빈 방식으로 브라우저 할당
  return browserPool[Math.floor(Math.random() * browserPool.length)];
}

async function scanBoard(board) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  // ...
}
```

**3. 데이터베이스 최적화**
```javascript
// prisma/schema.prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
  // WAL 모드 활성화 (동시 읽기 성능 향상)
}

// 또는 PostgreSQL로 마이그레이션
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  connection_limit = 20 // 연결 풀 크기 증가
}
```

**4. 요청 레이트 제한**
```javascript
// backend/utils/rateLimiter.js
class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }
  
  async wait() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      const oldest = this.requests[0];
      const waitTime = this.windowMs - (now - oldest);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    this.requests.push(Date.now());
  }
}

// 사용
const naverRateLimiter = new RateLimiter(10, 1000); // 초당 10회

async function scanBoard(board) {
  await naverRateLimiter.wait(); // 레이트 제한 대기
  // ...
}
```

**5. 동적 스캔 주기 조정**
```javascript
// 스캔 소요 시간에 따라 다음 스캔 주기 조정
async function scanAllBoards() {
  const startTime = Date.now();
  
  // ... 스캔 로직 ...
  
  const elapsed = Date.now() - startTime;
  const scanInterval = await loadScanInterval();
  
  // 스캔 시간이 주기보다 길면 경고
  if (elapsed > scanInterval) {
    logger.warn('[NaverCafeWorker] Scan took longer than interval', {
      elapsed,
      interval: scanInterval,
      boardsCount: boards.length
    });
    
    // 다음 스캔을 즉시 시작하지 않고 여유 시간 확보
    const nextScanDelay = Math.max(60000, scanInterval - elapsed + 30000);
    setTimeout(() => {
      scanAllBoards().catch(err => {
        logger.error('[NaverCafeWorker] Scheduled scan failed', { error: err.message });
      });
    }, nextScanDelay);
  }
}
```

### 9.4 모니터링 워커 개선 우선순위

#### 🔴 높은 우선순위

1. **지수 백오프 재시도 로직 구현** (2일)
   - 재시도 유틸리티 생성
   - 모든 워커에 적용

2. **프로세스 종료 개선** (1일)
   - wait() 호출 추가
   - 타임아웃 설정
   - 좀비 프로세스 방지

3. **에러 복구 로직** (2일)
   - Discord 재연결 로직
   - Slack 레이트 리밋 처리

#### 🟡 중간 우선순위

4. **병렬 처리 도입** (3-5일)
   - 게시판 병렬 스캔
   - 브라우저 풀 구현

5. **레이트 리밋 처리** (2일)
   - 요청 레이트 제한
   - 동적 딜레이 조정

#### 🟢 낮은 우선순위

6. **데이터베이스 최적화** (1주)
   - PostgreSQL 마이그레이션
   - 연결 풀 크기 조정

7. **모니터링 및 알림** (2-3일)
   - 워커 상태 모니터링
   - 장애 알림 시스템

---

## 10. API 설계 및 보안 검토

### 10.1 API 응답 통일성 문제

#### 10.1.1 현재 상태 분석

**표준 응답 유틸리티 존재**:
```javascript
// backend/utils/http.js
function sendSuccess(res, data = null, message = 'Success', statusCode = HTTP_STATUS.OK) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  });
}

function sendError(res, message = 'Internal Server Error', statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, details = null) {
  return res.status(statusCode).json({
    success: false,
    message,
    error: details,
    timestamp: new Date().toISOString()
  });
}
```

**문제점**: 일부 컨트롤러가 표준 유틸리티를 사용하지 않음

**응답 구조 불일치 사례**:

1. **auth.controller.js** (로그인):
```javascript
// ❌ 표준 형식 미사용
return res.status(200).json({
  token: result.token,
  user: result.user
});

// ✅ 표준 형식 사용 예시
return sendSuccess(res, { token: result.token, user: result.user }, 'Login successful');
```

2. **auth.controller.js** (me):
```javascript
// ❌ 표준 형식 미사용
return res.json({
  user: { id, email, role, name }
});

// ✅ 표준 형식 사용 예시
return sendSuccess(res, { user: { id, email, role, name } });
```

3. **categories.controller.js**:
```javascript
// ❌ 표준 형식 미사용
res.json(groupsWithCounts);

// ❌ 에러 응답도 불일치
res.status(500).json({ error: 'Failed to list category groups' });

// ✅ 표준 형식 사용 예시
return sendSuccess(res, groupsWithCounts);
return sendError(res, 'Failed to list category groups', HTTP_STATUS.INTERNAL_SERVER_ERROR);
```

4. **monitoredUrls.controller.js**:
```javascript
// ❌ 표준 형식 미사용
res.status(201).json(monitoredUrl);
res.status(500).json({ error: 'Failed to create monitored URL' });
```

**응답 구조 비교**:

| 컨트롤러 | 성공 응답 | 실패 응답 | 표준 사용 |
|---------|----------|----------|----------|
| auth.controller.js (login) | `{ token, user }` | `{ error }` | ❌ |
| auth.controller.js (me) | `{ user }` | `{ error }` | ❌ |
| issues.controller.js | `{ success, data, message }` | `{ success, message, error }` | ✅ |
| categories.controller.js | `{ ...data }` | `{ error }` | ❌ |
| monitoredUrls.controller.js | `{ ...data }` | `{ error }` | ❌ |
| feedbackNotices.controller.js | `{ success, data, message }` | `{ success, message, error }` | ✅ |

#### 10.1.2 문제점 요약

❌ **응답 구조 불일치**: 
- 일부는 `{ success, data, message }` 형식
- 일부는 `{ token, user }` 또는 `{ ...data }` 형식
- 일부는 `{ error }` 형식

❌ **프론트엔드 처리 복잡도 증가**:
```typescript
// 프론트엔드에서 일관성 없는 응답 처리
const body = await res.json();
const data = body.data || body.user || body; // 불확실한 데이터 추출
```

❌ **에러 처리 불일치**:
- 일부는 `{ error: 'message' }`
- 일부는 `{ success: false, message: '...', error: '...' }`

#### 10.1.3 개선 방안

**1. 모든 컨트롤러 표준화**
```javascript
// 모든 성공 응답
return sendSuccess(res, data, 'Operation successful');

// 모든 에러 응답
return sendError(res, 'Error message', HTTP_STATUS.BAD_REQUEST);

// 검증 에러
return sendValidationError(res, [{ field: 'email', message: 'Email is required' }]);
```

**2. 미들웨어로 강제**
```javascript
// backend/middlewares/response.middleware.js
function enforceStandardResponse(req, res, next) {
  const originalJson = res.json;
  res.json = function(data) {
    // 표준 형식이 아니면 래핑
    if (!data.success && !data.error) {
      return originalJson.call(this, {
        success: true,
        data,
        timestamp: new Date().toISOString()
      });
    }
    return originalJson.call(this, data);
  };
  next();
}
```

**3. 타입 정의 (TypeScript 또는 JSDoc)**
```typescript
// backend/types/api.d.ts
interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  message: string;
  timestamp: string;
}

interface ApiErrorResponse {
  success: false;
  message: string;
  error?: string | object;
  timestamp: string;
}

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
```

### 10.2 입력 값 검증 (Validation) 문제

#### 10.2.1 현재 검증 방식

**수동 검증만 사용**:
```javascript
// backend/controllers/auth.controller.js:22-27
if (!email || !password) {
  return res.status(400).json({ error: 'Email and password are required' });
}
```

**검증 라이브러리 부재**:
- ❌ Joi 없음
- ❌ Zod 없음
- ❌ express-validator 없음
- ✅ 수동 검증만 사용

#### 10.2.2 발견된 엣지 케이스 및 취약점

**1. 타입 변환 오류**
```javascript
// backend/controllers/feedbackNotices.controller.js:131
where: { id: parseInt(id) }
// ❌ parseInt('abc') = NaN → DB 쿼리 실패 또는 예상치 못한 동작

// 개선안
const noticeId = parseInt(id, 10);
if (isNaN(noticeId) || noticeId <= 0) {
  return sendError(res, 'Invalid notice ID', HTTP_STATUS.BAD_REQUEST);
}
```

**2. 문자열 길이 제한 없음**
```javascript
// backend/controllers/feedbackNotices.controller.js:95-98
gameName: gameName.trim(),
managerName: managerName.trim(),
category: category.trim(),
content: content.trim(), // ❌ 길이 제한 없음 (DoS 가능)
```
- **문제**: 매우 긴 문자열로 DB 오버플로우 또는 메모리 부족 가능
- **예시**: `content: 'A'.repeat(1000000)` → 메모리 부족

**3. 이메일 형식 검증 없음**
```javascript
// backend/controllers/auth.controller.js:22-27
if (!email || !password) {
  return res.status(400).json({ error: 'Email and password are required' });
}
// ❌ 이메일 형식 검증 없음
// 예: email: 'not-an-email' 허용됨
```

**4. 숫자 범위 검증 부족**
```javascript
// backend/controllers/monitoredBoards.controller.js:143
interval: interval ? parseInt(interval) : 300
// ❌ 음수, 0, 매우 큰 값 검증 없음
// 예: interval: -1000 또는 interval: 999999999
```

**5. URL 검증 부족**
```javascript
// backend/controllers/monitoredBoards.controller.js:99-102
if (!url || !url.trim()) {
  return sendError(res, '게시판 URL은 필수입니다', HTTP_STATUS.BAD_REQUEST);
}
// ❌ URL 형식 검증 없음
// 예: url: 'javascript:alert(1)' 또는 url: 'file:///etc/passwd'
```

**6. 날짜 형식 검증 부족**
```javascript
// backend/controllers/feedbackNotices.controller.js:99
noticeDate: new Date(noticeDate)
// ❌ 잘못된 날짜 형식 시 Invalid Date 생성
// 예: noticeDate: 'invalid-date' → Invalid Date 객체 생성
```

**7. SQL Injection 위험 (낮음, Prisma 사용으로 대부분 방지)**
```javascript
// Prisma 사용으로 대부분 안전하나, Raw Query 사용 시 주의 필요
// 현재 코드에서는 Raw Query 사용 없음 (안전)
```

**8. XSS 위험 (낮음, 백엔드에서는 직접 렌더링 없음)**
- 백엔드는 JSON만 반환하므로 직접적인 XSS 위험 낮음
- 프론트엔드에서 출력 시 이스케이프 필요

#### 10.2.3 구체적인 취약점 사례

**취약점 1: 정수 파싱 오류**
```javascript
// backend/controllers/categories.controller.js:112
where: { id: parseInt(id) }
// 문제: parseInt('123abc') = 123 (부분 파싱)
// 문제: parseInt('abc') = NaN (쿼리 실패)

// 공격 시나리오
// GET /api/categories/123abc → 예상치 못한 동작
// GET /api/categories/NaN → 에러 발생
```

**취약점 2: 문자열 길이 DoS**
```javascript
// backend/controllers/feedbackNotices.controller.js:98
content: content.trim()
// 문제: 매우 긴 문자열 허용
// 공격: content: 'A'.repeat(10000000) → 메모리 부족, DB 오버플로우
```

**취약점 3: 배열/객체 주입**
```javascript
// backend/controllers/issues.controller.js
const { agentId, startDate, endDate, severity, status } = req.query;
// 문제: 배열이나 객체가 전달될 경우 처리 부족
// 예: ?severity[]=1&severity[]=2 → 배열로 전달됨
```

**취약점 4: 프로토타입 오염**
```javascript
// req.body에 __proto__ 속성이 포함될 경우
const updateData = req.body;
// 문제: updateData.__proto__ = { ... } → 프로토타입 오염 가능
```

#### 10.2.4 개선 방안

**1. 검증 라이브러리 도입 (Zod 권장)**
```javascript
// backend/validators/auth.validator.js
const { z } = require('zod');

const loginSchema = z.object({
  email: z.string().email('Invalid email format').min(1).max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100)
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['ADMIN', 'LEAD', 'AGENT', 'VIEWER']).optional()
});

// 사용
const result = loginSchema.safeParse(req.body);
if (!result.success) {
  return sendValidationError(res, result.error.errors);
}
```

**2. 검증 미들웨어 생성**
```javascript
// backend/middlewares/validation.middleware.js
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params
    });
    
    if (!result.success) {
      return sendValidationError(res, result.error.errors);
    }
    
    // 검증된 데이터로 교체
    req.validated = result.data;
    next();
  };
}

// 사용
router.post('/login', validate(loginSchema), authController.login);
```

**3. 타입 안전한 파싱 유틸리티**
```javascript
// backend/utils/validators.js
function parseInteger(value, options = {}) {
  const { min, max, required = true } = options;
  
  if (value === undefined || value === null) {
    if (required) throw new Error('Value is required');
    return undefined;
  }
  
  const num = parseInt(String(value), 10);
  if (isNaN(num)) {
    throw new Error(`Invalid integer: ${value}`);
  }
  
  if (min !== undefined && num < min) {
    throw new Error(`Value must be >= ${min}`);
  }
  
  if (max !== undefined && num > max) {
    throw new Error(`Value must be <= ${max}`);
  }
  
  return num;
}

function parseString(value, options = {}) {
  const { minLength = 0, maxLength = 10000, required = true, trim = true } = options;
  
  if (value === undefined || value === null) {
    if (required) throw new Error('Value is required');
    return undefined;
  }
  
  const str = trim ? String(value).trim() : String(value);
  
  if (str.length < minLength) {
    throw new Error(`String must be at least ${minLength} characters`);
  }
  
  if (str.length > maxLength) {
    throw new Error(`String must be at most ${maxLength} characters`);
  }
  
  return str;
}

function parseEmail(value, required = true) {
  if (!value && !required) return undefined;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    throw new Error('Invalid email format');
  }
  
  return value.toLowerCase().trim();
}

function parseURL(value, required = true) {
  if (!value && !required) return undefined;
  
  try {
    const url = new URL(value);
    // 허용된 프로토콜만
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('URL must use http or https protocol');
    }
    return url.href;
  } catch (error) {
    throw new Error(`Invalid URL: ${error.message}`);
  }
}

function parseDate(value, required = true) {
  if (!value && !required) return undefined;
  
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date format');
  }
  
  return date;
}
```

**4. 컨트롤러에 적용**
```javascript
// backend/controllers/feedbackNotices.controller.js
const { parseString, parseDate, parseInteger } = require('../utils/validators');

async function createNotice(req, res) {
  try {
    // 검증 및 파싱
    const gameName = parseString(req.body.gameName, { maxLength: 100 });
    const managerName = parseString(req.body.managerName, { maxLength: 100 });
    const category = parseString(req.body.category, { maxLength: 50 });
    const content = parseString(req.body.content, { maxLength: 10000 }); // 길이 제한
    const noticeDate = parseDate(req.body.noticeDate);
    
    // ... 나머지 로직
  } catch (error) {
    if (error.message.includes('Invalid') || error.message.includes('must be')) {
      return sendValidationError(res, [{ field: 'general', message: error.message }]);
    }
    return sendError(res, 'Failed to create notice', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
```

**5. 프로토타입 오염 방지**
```javascript
// backend/middlewares/sanitize.middleware.js
function sanitizeInput(req, res, next) {
  // __proto__, constructor 등 위험한 키 제거
  const sanitize = (obj) => {
    if (obj === null || typeof obj !== 'object') return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    
    const sanitized = {};
    for (const key in obj) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue; // 위험한 키 제거
      }
      sanitized[key] = sanitize(obj[key]);
    }
    return sanitized;
  };
  
  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  next();
}
```

### 10.3 보안 취약점 요약

#### 10.3.1 입력 검증 취약점

| 취약점 | 심각도 | 위치 | 영향 |
|--------|--------|------|------|
| 타입 변환 오류 | 중간 | 모든 컨트롤러 | 예상치 못한 동작, 에러 발생 |
| 문자열 길이 제한 없음 | 높음 | content, name 등 | DoS, DB 오버플로우 |
| 이메일 형식 검증 없음 | 낮음 | auth.controller.js | 잘못된 데이터 저장 |
| 숫자 범위 검증 없음 | 중간 | interval, limit 등 | 비즈니스 로직 우회 |
| URL 검증 없음 | 중간 | monitoredBoards 등 | SSRF 가능성 |
| 날짜 형식 검증 없음 | 낮음 | noticeDate 등 | Invalid Date 생성 |
| 프로토타입 오염 | 중간 | 모든 req.body | 프로토타입 조작 |

#### 10.3.2 API 응답 불일치 영향

- **프론트엔드 복잡도 증가**: 일관성 없는 응답 처리
- **에러 처리 어려움**: 다양한 에러 형식
- **디버깅 어려움**: 예측 불가능한 응답 구조

### 10.4 개선 우선순위

#### 🔴 높은 우선순위

1. **입력 길이 제한 추가** (1일)
   - 모든 문자열 필드에 maxLength 설정
   - DoS 방지

2. **정수 파싱 검증 강화** (1일)
   - NaN 체크
   - 범위 검증

3. **API 응답 표준화** (2일)
   - 모든 컨트롤러에서 sendSuccess/sendError 사용
   - 레거시 응답 형식 제거

#### 🟡 중간 우선순위

4. **검증 라이브러리 도입** (3일)
   - Zod 도입
   - 스키마 정의
   - 미들웨어 적용

5. **URL/이메일 검증** (1일)
   - URL 형식 검증
   - 이메일 형식 검증

6. **프로토타입 오염 방지** (1일)
   - sanitize 미들웨어 추가

#### 🟢 낮은 우선순위

7. **날짜 검증 강화** (0.5일)
   - 날짜 형식 검증
   - 범위 검증

8. **타입 안전성 강화** (2일)
   - TypeScript 도입 검토
   - JSDoc 타입 정의

---

## 11. 보안 이슈

### 11.1 환경 변수 검증 부족

**문제점**:
- 필수 환경 변수 누락 시 런타임 에러
- 환경 변수 타입 검증 없음

**개선 방안**:
```javascript
// backend/utils/env.js
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  // ...
];

function validateEnv() {
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateEnv();
```

### 11.2 인증 미완성 부분

**문제점**:
```javascript
// backend/services/auth.service.js:6
// TODO: Production 환경에서는 반드시 환경 변수로 설정해야 합니다
```
- JWT_SECRET 하드코딩 가능성
- 인증 미들웨어 일부 미완성

**개선 방안**:
1. 모든 인증 관련 설정을 환경 변수로 이동
2. 인증 미들웨어 테스트 강화
3. 토큰 만료 시간 설정 검증

### 11.3 입력 검증 부족 (중복 - 10.2 참조)

**문제점**:
- 일부 API에서 입력 검증이 부족
- SQL Injection은 Prisma로 방지되나, XSS 가능성

**개선 방안**:
1. Joi 또는 Zod를 사용한 입력 검증 미들웨어 도입
2. XSS 방지를 위한 출력 이스케이프
3. 파일 업로드 검증 강화

### 11.4 CORS 설정

**현재 상태**: `app.js:23`에서 `cors()` 사용 (모든 origin 허용 가능)

**개선 방안**:
```javascript
// 개발/프로덕션 환경별 CORS 설정
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS?.split(',') 
    : '*',
  credentials: true
};
app.use(cors(corsOptions));
```

---

## 12. 데이터베이스 개선

### 12.1 SQLite → PostgreSQL 마이그레이션

**현재 상태**: SQLite 사용 (개발용 적합)

**권장사항**:
- 프로덕션 환경에서는 PostgreSQL 사용 권장
- Prisma를 사용 중이므로 마이그레이션 용이
- 동시성 처리, 트랜잭션 격리 수준 향상

### 12.2 트랜잭션 처리

**문제점**:
- 복잡한 비즈니스 로직에서 트랜잭션 미사용
- 예: 보고서 업로드 시 여러 테이블 동시 업데이트

**개선 방안**:
```javascript
// Prisma 트랜잭션 사용
await prisma.$transaction(async (tx) => {
  const report = await tx.report.create({ ... });
  await tx.reportItemIssue.createMany({ ... });
  // ...
});
```

### 12.3 데이터 정합성

**문제점**:
- 외래 키 제약 조건은 있으나, 일부 비즈니스 로직에서 정합성 검증 부족

**개선 방안**:
1. 데이터베이스 제약 조건 강화
2. 애플리케이션 레벨에서도 검증 로직 추가
3. 정기적인 데이터 정합성 검사 스크립트

### 12.4 마이그레이션 관리

**현재 상태**: Prisma Migrate 사용 중

**권장사항**:
1. 마이그레이션 파일 명명 규칙 통일
2. 롤백 전략 수립
3. 프로덕션 배포 전 스테이징 환경에서 테스트

---

## 13. 테스트 및 품질 관리

### 13.1 테스트 부족

**현재 상태**:
- `backend/__tests__/` 디렉토리 존재하나 테스트 파일 적음
- Frontend 테스트 부재

**개선 방안**:
1. **단위 테스트**: Service 레이어 핵심 로직
2. **통합 테스트**: API 엔드포인트
3. **E2E 테스트**: 주요 사용자 시나리오
4. **테스트 커버리지 목표**: 70% 이상

### 13.2 코드 품질 도구

**권장 도구**:
1. **ESLint**: 코드 스타일 및 잠재적 버그 검사
2. **Prettier**: 코드 포맷팅 자동화
3. **Husky**: Git hooks를 통한 커밋 전 검사
4. **SonarQube**: 코드 품질 분석

### 13.3 CI/CD 파이프라인

**권장사항**:
1. GitHub Actions 또는 GitLab CI 설정
2. 자동 테스트 실행
3. 코드 품질 검사
4. 자동 배포 (선택)

---

## 14. 우선순위별 개선 계획

### 🔴 높은 우선순위 (즉시 수정)

1. **로깅 표준화**
   - console.log → logger로 전환
   - 로그 레벨 통일 (debug, info, warn, error)
   - 예상 작업량: 2-3일

2. **에러 처리 통일**
   - asyncMiddleware 패턴으로 통일
   - 에러 응답 포맷 표준화
   - 예상 작업량: 1-2일

3. **환경 변수 검증**
   - 필수 환경 변수 검증 로직 추가
   - .env.example 파일 생성
   - 예상 작업량: 0.5일

4. **보안 강화**
   - JWT_SECRET 환경 변수화 확인
   - CORS 설정 개선
   - 입력 검증 강화
   - 예상 작업량: 2일

### 🟡 중간 우선순위 (1-2주 내)

5. **중복 코드 제거**
   - 프로젝트 ID 파싱 로직 통합
   - API 클라이언트 유틸리티 생성
   - 예상 작업량: 2-3일

6. **성능 최적화**
   - N+1 쿼리 해결
   - WebSocket 메시지 최적화 (delta 업데이트)
   - 예상 작업량: 3-5일

7. **로직 개선**
   - 이슈 분류 결과 DB 저장
   - SLA 계산 로직 개선 (동적 정책)
   - 예상 작업량: 3-4일

### 🟢 낮은 우선순위 (장기 개선)

8. **테스트 추가**
   - 단위 테스트 작성
   - 통합 테스트 작성
   - 예상 작업량: 1-2주

9. **데이터베이스 마이그레이션**
   - SQLite → PostgreSQL (필요 시)
   - 트랜잭션 처리 강화
   - 예상 작업량: 1주

10. **문서화**
    - API 문서 자동 생성 (Swagger)
    - 아키텍처 다이어그램 업데이트
    - 예상 작업량: 2-3일

---

## 15. 결론 및 권장사항

### 15.1 전반적 평가

**강점**:
- ✅ 명확한 레이어 분리 (Controller → Service → Database)
- ✅ 타입 안정성 (Frontend TypeScript)
- ✅ 실시간 통신 구현 (WebSocket)
- ✅ 모니터링 워커 분리

**개선 필요 영역**:
- ⚠️ 코드 품질 표준화 (로깅, 에러 처리)
- ⚠️ 테스트 커버리지 부족
- ⚠️ 성능 최적화 여지
- ⚠️ 보안 강화 필요

### 15.2 즉시 조치 사항

1. **로깅 시스템 전환**: console.log → logger (가장 많은 영향)
2. **에러 처리 통일**: 일관된 에러 처리 패턴 적용
3. **환경 변수 검증**: 필수 변수 누락 방지
4. **보안 점검**: 인증/인가 로직 검토 및 강화

### 15.3 장기 개선 방향

1. **테스트 문화 정착**: TDD 또는 최소한 테스트 작성 습관화
2. **성능 모니터링**: APM 도구 도입 (예: New Relic, Datadog)
3. **코드 리뷰 프로세스**: Pull Request 기반 코드 리뷰 정착
4. **문서화 자동화**: API 문서 자동 생성 및 유지보수

---

## 부록

### A. 코드 메트릭스

- **총 라인 수**: 약 15,000+ 라인 (추정)
- **파일 수**: 120+ 파일
- **의존성**: 40+ npm 패키지
- **데이터베이스 모델**: 20+ 모델

### B. 참고 문서

- `PROJECT_STRUCTURE.md`: 프로젝트 구조 설명
- `IMPLEMENTATION_DOCUMENTATION.md`: 구현 문서
- `README.md`: 프로젝트 개요

### C. 검토 도구

- **코드 검색**: ripgrep (grep 도구)
- **의존성 분석**: package.json 분석
- **스키마 분석**: Prisma schema.prisma

---

**문서 작성일**: 2025-01-27  
**다음 검토 예정일**: 개선 작업 완료 후

