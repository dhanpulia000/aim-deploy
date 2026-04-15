# 프로젝트 구조 문서

## 목차
1. [프로젝트 개요](#프로젝트-개요)
2. [기술 스택](#기술-스택)
3. [디렉토리 구조](#디렉토리-구조)
4. [데이터베이스 스키마](#데이터베이스-스키마)
5. [API 엔드포인트](#api-엔드포인트)
6. [주요 기능 모듈](#주요-기능-모듈)
7. [데이터 흐름](#데이터-흐름)
8. [개선 사항 체크리스트](#개선-사항-체크리스트)

---

## 프로젝트 개요

**Agent Ops Wallboard V2**는 실시간 모니터링 및 이슈 관리 시스템입니다.

### 주요 기능
- **실시간 이슈 모니터링**: Discord, 네이버 카페, 시스템에서 발생하는 이슈 실시간 추적
- **자동 크롤링**: 네이버 카페 게시판 자동 스캔 및 이슈 생성
- **이슈 관리**: 이슈 상태 추적, 할당, 댓글, 확인/처리 상태 관리
- **SLA 모니터링**: SLA 정책 기반 자동 알림 및 위반 감지
- **에이전트 관리**: 에이전트 상태, 스케줄, 처리량 추적
- **보고서 생성**: 일일/주간 보고서 생성 및 Excel 다운로드
- **카테고리 자동 분류**: 키워드 기반 이슈 자동 분류
- **프로젝트 관리**: 다중 프로젝트 지원

---

## 기술 스택

### 프론트엔드
- **React 18** (TypeScript)
- **Vite** (빌드 도구)
- **Tailwind CSS** (스타일링)
- **Recharts** (차트 라이브러리)
- **Vitest** (테스트)

### 백엔드
- **Node.js** (JavaScript)
- **Express.js** (웹 프레임워크)
- **Prisma** (ORM)
- **SQLite** (데이터베이스)
- **WebSocket (ws)** (실시간 통신)
- **Cheerio** (HTML 파싱)
- **XLSX** (Excel 처리)

### 주요 라이브러리
- **bcryptjs**: 비밀번호 해싱
- **jsonwebtoken**: JWT 인증
- **multer**: 파일 업로드
- **helmet**: 보안 헤더
- **compression**: 응답 압축
- **cors**: CORS 지원
- **axios**: HTTP 클라이언트
- **google-spreadsheet**: Google Sheets 연동

---

## 디렉토리 구조

```
WallboardV2/
├── src/                          # 프론트엔드 소스
│   ├── App.tsx                   # 메인 현황판 컴포넌트
│   ├── Dashboard.tsx             # 일일 보고서 업로드 페이지
│   ├── Admin.tsx                 # 관리자 페이지 (에이전트, 스케줄, SLA 등)
│   ├── Login.tsx                 # 로그인 페이지
│   ├── WeeklyReportGenerator.tsx  # 주간 보고서 생성 페이지
│   ├── components/               # 재사용 컴포넌트
│   │   ├── IssueDetailPanel.tsx  # 이슈 상세 패널
│   │   ├── MetricsOverview.tsx   # 메트릭 개요
│   │   ├── ProjectSelector.tsx    # 프로젝트 선택기
│   │   └── ScheduleCalendar.tsx   # 스케줄 캘린더
│   ├── auth/                     # 인증 관련
│   │   └── AuthContext.tsx       # 인증 컨텍스트
│   ├── types/                    # TypeScript 타입 정의
│   │   └── index.ts              # 공통 타입
│   ├── hooks/                    # 커스텀 훅
│   │   └── useRealtime.ts        # WebSocket 실시간 훅
│   └── data/                     # 데이터 서비스
│
├── backend/                      # 백엔드 소스
│   ├── server.js                 # 서버 진입점 (포트 리스닝, 스케줄러 시작)
│   ├── app.js                    # Express 앱 설정
│   ├── db.js                     # 데이터베이스 연결 (레거시)
│   │
│   ├── controllers/              # 컨트롤러 (요청 처리)
│   │   ├── agents.controller.js
│   │   ├── articles.controller.js
│   │   ├── auth.controller.js
│   │   ├── categories.controller.js
│   │   ├── classification-rules.controller.js
│   │   ├── files.controller.js
│   │   ├── issues.controller.js
│   │   ├── metrics.controller.js
│   │   ├── monitoredBoards.controller.js
│   │   ├── monitoredUrls.controller.js
│   │   ├── projects.controller.js
│   │   ├── reports.controller.js
│   │   ├── schedules.controller.js
│   │   ├── sla.controller.js
│   │   └── weekly.controller.js
│   │
│   ├── services/                 # 서비스 레이어 (비즈니스 로직)
│   │   ├── agents.service.js
│   │   ├── articles.service.js
│   │   ├── audit.service.js
│   │   ├── auth.service.js
│   │   ├── boardScanner.js      # 게시판 스캐너
│   │   ├── classification-rules.service.js
│   │   ├── files.service.js
│   │   ├── issues.service.js
│   │   ├── metrics.service.js
│   │   ├── naverCafeIssues.service.js  # 네이버 카페 이슈 처리
│   │   ├── projects.service.js
│   │   ├── reports.service.js
│   │   ├── schedules.service.js
│   │   ├── sla.service.js
│   │   ├── weekly.service.js
│   │   ├── issueClassifier.js    # 이슈 분류기
│   │   ├── aiIssueClassifier.js   # AI 기반 분류기
│   │   └── scraper/              # 스크래퍼
│   │       ├── naverCafeScraper.js
│   │       └── naverCafeBoardScraper.js
│   │
│   ├── routes/                   # API 라우트 정의
│   │   ├── index.js              # 메인 라우터 (통합)
│   │   ├── agents.routes.js
│   │   ├── articles.routes.js
│   │   ├── auth.routes.js
│   │   ├── categories.routes.js
│   │   ├── classification-rules.routes.js
│   │   ├── debug.routes.js
│   │   ├── files.routes.js
│   │   ├── issues.routes.js
│   │   ├── metrics.routes.js
│   │   ├── monitoredBoards.routes.js
│   │   ├── monitoredUrls.routes.js
│   │   ├── projects.routes.js
│   │   ├── reports.routes.js
│   │   ├── schedules.routes.js
│   │   ├── sla.routes.js
│   │   └── weekly.routes.js
│   │
│   ├── middlewares/              # 미들웨어
│   │   ├── async.middleware.js  # 비동기 에러 처리
│   │   ├── auth.middleware.js    # 인증 미들웨어
│   │   ├── error.middleware.js   # 에러 처리
│   │   └── validate.middleware.js # 유효성 검사
│   │
│   ├── workers/                  # 백그라운드 워커
│   │   ├── sla.worker.js         # SLA 체커 워커
│   │   └── ingestion/            # 데이터 수집 워커
│   │       ├── discord.worker.js
│   │       └── naverCafe.worker.js
│   │
│   ├── utils/                    # 유틸리티 함수
│   │   ├── articles-parser.js
│   │   ├── dates.util.js
│   │   ├── excel.util.js
│   │   ├── http.js               # HTTP 유틸리티
│   │   ├── keyword-categorizer.js
│   │   └── logger.js            # 로깅 유틸리티
│   │
│   ├── libs/                     # 라이브러리
│   │   ├── db.js                 # Prisma 클라이언트
│   │   ├── mock.js               # Mock 데이터
│   │   └── storage.js
│   │
│   ├── realtime/                 # 실시간 통신
│   │   └── publisher.js         # WebSocket Publisher
│   │
│   ├── prisma/                   # Prisma 설정
│   │   ├── schema.prisma         # 데이터베이스 스키마
│   │   ├── migrations/          # 마이그레이션 파일
│   │   └── seed.js               # 시드 데이터
│   │
│   ├── data/                     # 데이터 파일 (Excel 등)
│   ├── uploads/                  # 업로드된 파일
│   └── __tests__/                # 테스트 파일
│
├── package.json                  # 프론트엔드 의존성
├── backend/package.json          # 백엔드 의존성
├── vite.config.ts                # Vite 설정
├── tsconfig.json                  # TypeScript 설정
├── tailwind.config.js             # Tailwind 설정
└── README.md                      # 프로젝트 README
```

---

## 데이터베이스 스키마

### 주요 모델

#### 1. Report (보고서)
- 일일 보고서 메타데이터
- 관계: Agent, ReportItemVOC, ReportItemIssue, ReportItemData

#### 2. ReportItemIssue (이슈)
- 이슈 데이터
- 관계: Report, Project, Channel, Agent (할당), CategoryGroup, Category, MonitoredUrl, MonitoredBoard
- 주요 필드:
  - `status`: OPEN, TRIAGED, IN_PROGRESS, RESOLVED, VERIFIED
  - `severity`: 1-3 (심각도)
  - `importance`: HIGH, MEDIUM, LOW
  - `checkedAt`, `checkedBy`: 확인 상태
  - `processedAt`, `processedBy`: 처리 상태
  - `slaBreachedAt`: SLA 위반 시각

#### 3. CategoryGroup / Category (카테고리)
- 동적 카테고리 시스템
- 대분류(CategoryGroup) → 중분류(Category) 계층 구조

#### 4. Agent (에이전트)
- 에이전트 정보 및 상태
- 관계: User, Project, AgentSchedule, ReportItemIssue

#### 5. AgentSchedule (스케줄)
- 에이전트 근무 스케줄
- 타입: weekly (주간 반복), specific (특정 날짜)

#### 6. Project (프로젝트)
- 프로젝트 정보
- 관계: Channel, Agent, ClassificationRule, SlaPolicy

#### 7. MonitoredUrl / MonitoredBoard (모니터링)
- 네이버 카페 모니터링 설정
- MonitoredUrl: 개별 URL 모니터링
- MonitoredBoard: 게시판 전체 스캔

#### 8. SlaPolicy (SLA 정책)
- 프로젝트별 SLA 정책
- 심각도별 응답 시간 설정
- 알림 채널: webhook, discord, slack, email

#### 9. User (사용자)
- 사용자 계정
- 역할: AGENT, LEAD, ADMIN
- 관계: Agent, AuditLog

#### 10. AuditLog (감사 로그)
- 사용자 액션 추적
- 액션 타입: LOGIN, ISSUE_STATUS_CHANGE, SLA_VIOLATION 등

#### 11. WeeklyReport (주간 보고서)
- 주간 보고서 메타데이터
- 통계 데이터는 JSON 문자열로 저장

---

## API 엔드포인트

### 인증 (Auth)
- `POST /api/auth/login` - 로그인
- `POST /api/auth/register` - 회원가입
- `GET /api/auth/me` - 현재 사용자 정보

### 에이전트 (Agents)
- `GET /api/agents` - 에이전트 목록
- `GET /api/agents/:id` - 에이전트 상세
- `POST /api/agents` - 에이전트 생성
- `PUT /api/agents/:id` - 에이전트 수정
- `DELETE /api/agents/:id` - 에이전트 삭제

### 이슈 (Issues)
- `GET /api/issues` - 이슈 목록 (필터링 지원)
- `GET /api/issues/:id` - 이슈 상세
- `POST /api/issues/:id/assign` - 에이전트 할당
- `POST /api/issues/:id/status` - 상태 변경
- `POST /api/issues/:id/check` - 확인 체크
- `POST /api/issues/:id/process` - 처리 완료
- `GET /api/issues/:id/comments` - 댓글 목록
- `POST /api/issues/:id/comments` - 댓글 추가
- `GET /api/issues/stats` - 통계

### 프로젝트 (Projects)
- `GET /api/projects` - 프로젝트 목록
- `POST /api/projects` - 프로젝트 생성
- `PUT /api/projects/:id` - 프로젝트 수정
- `DELETE /api/projects/:id` - 프로젝트 삭제

### SLA 정책
- `GET /api/projects/:projectId/sla` - SLA 정책 목록
- `POST /api/projects/:projectId/sla` - SLA 정책 생성
- `PUT /api/projects/:projectId/sla/:id` - SLA 정책 수정
- `DELETE /api/projects/:projectId/sla/:id` - SLA 정책 삭제

### 모니터링
- `GET /api/monitored-urls` - 모니터링 URL 목록
- `POST /api/monitored-urls` - 모니터링 URL 추가
- `PATCH /api/monitored-urls/:id` - 모니터링 URL 수정
- `DELETE /api/monitored-urls/:id` - 모니터링 URL 삭제
- `GET /api/monitored-boards` - 모니터링 게시판 목록
- `POST /api/monitored-boards` - 모니터링 게시판 추가
- `PATCH /api/monitored-boards/:id` - 모니터링 게시판 수정
- `DELETE /api/monitored-boards/:id` - 모니터링 게시판 삭제

### 보고서 (Reports)
- `POST /api/upload-report` - 일일 보고서 업로드 (레거시)
- `POST /api/reports` - 보고서 업로드
- `GET /api/reports/:agentId` - 에이전트별 보고서 목록
- `DELETE /api/reports/:agentId/:reportId` - 보고서 삭제

### 주간 보고서 (Weekly Reports)
- `POST /api/generate-weekly-report` - 주간 보고서 생성 (레거시)
- `POST /api/weekly-reports` - 주간 보고서 생성
- `GET /api/weekly-reports/:agentId` - 주간 보고서 목록
- `GET /api/weekly-reports/:agentId/download/:reportId` - Excel 다운로드

### 스케줄 (Schedules)
- `GET /api/schedules/agent/:agentId` - 에이전트 스케줄 목록
- `POST /api/schedules` - 스케줄 생성
- `PUT /api/schedules/:id` - 스케줄 수정
- `DELETE /api/schedules/:id` - 스케줄 삭제

### 카테고리 (Categories)
- `GET /api/categories/groups` - 카테고리 그룹 목록
- `POST /api/categories/groups` - 카테고리 그룹 생성
- `GET /api/categories` - 카테고리 목록
- `POST /api/categories` - 카테고리 생성

### 메트릭 (Metrics)
- `GET /api/metrics` - 메트릭 데이터

### 기타
- `GET /api/health` - 헬스 체크
- `GET /api/info` - API 정보
- `GET /api/data` - 레거시 데이터 (Mock)

---

## 주요 기능 모듈

### 1. 네이버 카페 크롤링
**파일**: `backend/services/boardScanner.js`, `backend/services/scraper/naverCafeBoardScraper.js`

**기능**:
- 활성화된 게시판을 60초마다 스캔
- 새로운 게시글을 감지하여 이슈로 변환
- 댓글도 함께 수집

**스케줄러**: `server.js`의 `startBoardScanner()`

### 2. 이슈 자동 분류
**파일**: `backend/services/issueClassifier.js`, `backend/services/aiIssueClassifier.js`

**기능**:
- 키워드 기반 자동 분류
- 카테고리 그룹/카테고리 할당
- 심각도 자동 설정

### 3. SLA 모니터링
**파일**: `backend/workers/sla.worker.js`, `backend/services/sla.service.js`

**기능**:
- 1분마다 SLA 정책 체크
- 위반 이슈 감지 시 웹훅 알림 전송
- WebSocket으로 실시간 알림 브로드캐스트
- 감사 로그 기록

### 4. 실시간 통신
**파일**: `backend/realtime/publisher.js`, `src/hooks/useRealtime.ts`

**기능**:
- WebSocket 서버 (포트 8081)
- 실시간 이벤트 브로드캐스트:
  - `onAgentStatusUpdate`: 에이전트 상태 업데이트
  - `onIssueCreated`: 새 이슈 생성
  - `onIssueUpdated`: 이슈 업데이트
  - `onSlaViolation`: SLA 위반

### 5. Excel 처리
**파일**: `backend/services/reports.service.js`, `backend/utils/excel.util.js`

**기능**:
- 일일 보고서 Excel 파싱 (VOC, Issue, Data 시트)
- 주간 보고서 Excel 생성
- PC/Mobile 형식 지원

### 6. 인증 및 권한
**파일**: `backend/middlewares/auth.middleware.js`, `backend/services/auth.service.js`

**기능**:
- JWT 기반 인증
- 역할 기반 접근 제어 (AGENT, LEAD, ADMIN)
- 비밀번호 해싱 (bcryptjs)

---

## 데이터 흐름

### 1. 이슈 생성 흐름
```
네이버 카페 게시판
  ↓ (60초마다 스캔)
boardScanner.js
  ↓
naverCafeBoardScraper.js (게시글/댓글 수집)
  ↓
naverCafeIssues.service.js (이슈 변환)
  ↓
issueClassifier.js (자동 분류)
  ↓
Prisma (DB 저장)
  ↓
WebSocket Publisher (실시간 알림)
  ↓
프론트엔드 (App.tsx)
```

### 2. 일일 보고서 업로드 흐름
```
프론트엔드 (Dashboard.tsx)
  ↓ (Excel 파일 업로드)
POST /api/upload-report
  ↓
reports.controller.js
  ↓
reports.service.js (Excel 파싱)
  ↓
ReportItemVOC, ReportItemIssue, ReportItemData 생성
  ↓
issueClassifier.js (이슈 자동 분류)
  ↓
Prisma (DB 저장)
```

### 3. SLA 모니터링 흐름
```
sla.worker.js (1분마다 실행)
  ↓
sla.service.js (위반 이슈 찾기)
  ↓
웹훅 알림 전송
  ↓
WebSocket Publisher (실시간 알림)
  ↓
AuditLog 기록
  ↓
slaBreachedAt 마킹 (중복 방지)
```

### 4. 주간 보고서 생성 흐름
```
프론트엔드 (WeeklyReportGenerator.tsx)
  ↓
POST /api/generate-weekly-report
  ↓
weekly.controller.js
  ↓
weekly.service.js (통계 집계)
  ↓
Excel 생성
  ↓
WeeklyReport 저장
  ↓
Excel 다운로드 제공
```

---

## 개선 사항 체크리스트

### 아키텍처 개선
- [ ] **레이어 분리 강화**
  - Controller → Service → Repository 패턴 명확화
  - 현재 일부 Controller에서 직접 Prisma 호출하는 부분 개선

- [ ] **에러 처리 통일**
  - 현재 일부는 try-catch, 일부는 async middleware 사용
  - 통일된 에러 처리 전략 수립

- [ ] **환경 변수 관리**
  - `.env.example` 파일 추가
  - 필수 환경 변수 검증 로직 추가

### 데이터베이스 개선
- [ ] **SQLite → PostgreSQL 마이그레이션 고려**
  - 현재 SQLite 사용 중 (개발용 적합)
  - 프로덕션 환경에서는 PostgreSQL 권장

- [ ] **인덱스 최적화**
  - 현재 스키마에 인덱스는 있으나, 쿼리 성능 분석 필요
  - 자주 사용되는 쿼리 패턴에 맞춘 인덱스 추가

- [ ] **트랜잭션 처리**
  - 복잡한 비즈니스 로직에 트랜잭션 적용
  - 예: 보고서 업로드 시 여러 테이블 동시 업데이트

### 코드 품질 개선
- [ ] **타입 안정성**
  - 백엔드 JavaScript → TypeScript 마이그레이션 고려
  - 또는 JSDoc 타입 주석 추가

- [ ] **코드 중복 제거**
  - 유사한 로직 통합 (예: 에러 처리, 응답 포맷팅)
  - 공통 유틸리티 함수 추출

- [ ] **테스트 커버리지 향상**
  - 현재 테스트 파일이 거의 없음
  - 단위 테스트 및 통합 테스트 추가

### 보안 개선
- [ ] **입력 검증 강화**
  - 모든 API 엔드포인트에 입력 검증 추가
  - SQL Injection 방지 (Prisma 사용으로 이미 방지되지만 추가 검증)

- [ ] **Rate Limiting**
  - API 요청 제한 추가 (예: express-rate-limit)
  - 특히 로그인, 파일 업로드 엔드포인트

- [ ] **CORS 설정 세분화**
  - 현재 모든 origin 허용 중
  - 프로덕션 환경에서는 특정 origin만 허용

### 성능 개선
- [ ] **캐싱 전략**
  - 자주 조회되는 데이터 캐싱 (Redis 고려)
  - 예: 카테고리 목록, 프로젝트 목록

- [ ] **페이지네이션 개선**
  - 현재 일부 엔드포인트에만 페이지네이션 적용
  - 모든 목록 조회 API에 페이지네이션 추가

- [ ] **배치 처리 최적화**
  - 게시판 스캔 시 배치 처리로 DB 쿼리 최소화
  - 현재는 개별 쿼리 실행 중

### 모니터링 및 로깅
- [ ] **구조화된 로깅**
  - 현재 logger.js는 있으나, 로그 레벨별 관리 강화
  - 로그 파일 저장 및 로테이션 설정

- [ ] **에러 추적**
  - Sentry 등 에러 추적 도구 도입
  - 프로덕션 환경 에러 모니터링

- [ ] **메트릭 수집**
  - API 응답 시간, 에러율 등 메트릭 수집
  - Prometheus + Grafana 고려

### 사용자 경험 개선
- [ ] **로딩 상태 표시**
  - 모든 비동기 작업에 로딩 인디케이터 추가
  - 현재 일부만 구현됨

- [ ] **에러 메시지 개선**
  - 사용자 친화적인 에러 메시지
  - 현재 일부는 기술적인 에러 메시지 표시

- [ ] **반응형 디자인**
  - 모바일 환경 최적화
  - 현재는 데스크톱 중심

### 기능 개선
- [ ] **검색 기능**
  - 이슈 검색 기능 추가 (제목, 내용, 카테고리 등)
  - 현재는 필터링만 지원

- [ ] **알림 시스템**
  - 브라우저 알림 (Notification API)
  - 이메일 알림 기능 추가

- [ ] **대시보드 커스터마이징**
  - 사용자별 대시보드 설정 저장
  - 위젯 추가/제거 기능

- [ ] **내보내기 기능**
  - 이슈 목록 CSV/Excel 내보내기
  - 필터링된 결과 내보내기

### 문서화 개선
- [ ] **API 문서**
  - Swagger/OpenAPI 문서 자동 생성
  - 현재는 코드 주석만 존재

- [ ] **개발 가이드**
  - 새로운 기능 추가 가이드
  - 코딩 컨벤션 문서

- [ ] **배포 가이드**
  - 프로덕션 배포 절차 문서화
  - 환경 설정 가이드

### 테스트 개선
- [ ] **단위 테스트**
  - Service 레이어 단위 테스트
  - 유틸리티 함수 테스트

- [ ] **통합 테스트**
  - API 엔드포인트 통합 테스트
  - E2E 테스트 (Playwright 등)

- [ ] **테스트 자동화**
  - CI/CD 파이프라인에 테스트 포함
  - PR 시 자동 테스트 실행

---

## 결론

현재 프로젝트는 기본적인 기능은 잘 구현되어 있으나, 프로덕션 환경을 위한 개선이 필요합니다. 특히 **테스트 커버리지**, **에러 처리 통일**, **보안 강화**, **성능 최적화**가 우선순위가 높습니다.

위 체크리스트를 참고하여 단계적으로 개선을 진행하시기 바랍니다.




















