# Wallboard V2 - 구현 문서

> **버전**: 2.0  
> **최종 업데이트**: 2025-11-25  
> **목적**: 기능 개선 및 추가를 위한 전체 시스템 구현 내용 정리

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택](#2-기술-스택)
3. [시스템 아키텍처](#3-시스템-아키텍처)
4. [데이터베이스 스키마](#4-데이터베이스-스키마)
5. [주요 기능 모듈](#5-주요-기능-모듈)
6. [API 엔드포인트](#6-api-엔드포인트)
7. [프론트엔드 구조](#7-프론트엔드-구조)
8. [백엔드 구조](#8-백엔드-구조)
9. [모니터링 시스템](#9-모니터링-시스템)
10. [AI 분류 시스템](#10-ai-분류-시스템)
11. [실시간 통신](#11-실시간-통신)
12. [인증 및 권한](#12-인증-및-권한)
13. [배포 및 설정](#13-배포-및-설정)
14. [향후 개선 사항](#14-향후-개선-사항)

---

## 1. 프로젝트 개요

### 1.1 프로젝트 목적

**Agent Ops Wallboard V2**는 게임 운영팀을 위한 실시간 이슈 모니터링 및 관리 시스템입니다. Discord, 네이버 카페 등 다양한 소스에서 발생하는 이슈를 자동으로 수집, 분류, 추적하여 효율적인 이슈 처리를 지원합니다.

### 1.2 핵심 가치

- **실시간 모니터링**: 다양한 소스에서 발생하는 이슈를 실시간으로 감지
- **자동화**: 크롤링, 분류, 알림 등 자동화된 워크플로우
- **지능형 분류**: AI 기반 이슈 자동 분류 및 우선순위 설정
- **SLA 관리**: SLA 정책 기반 자동 알림 및 위반 감지
- **데이터 분석**: 일일/주간 보고서 자동 생성 및 Excel 다운로드

### 1.3 주요 사용자

- **AGENT**: 이슈 처리 담당자
- **LEAD**: 팀 리더, 이슈 관리 및 모니터링
- **ADMIN**: 시스템 관리자, 설정 및 사용자 관리

---

## 2. 기술 스택

### 2.1 프론트엔드

| 기술 | 버전 | 용도 |
|------|------|------|
| React | 18.2.0 | UI 라이브러리 |
| TypeScript | 5.2.2 | 정적 타입 언어 |
| Vite | 5.0.8 | 빌드 도구 및 개발 서버 |
| Tailwind CSS | 3.3.6 | 유틸리티 기반 CSS |
| Recharts | 2.10.0 | 차트 라이브러리 |
| Vitest | 1.0.0 | 테스트 프레임워크 |

### 2.2 백엔드

| 기술 | 버전 | 용도 |
|------|------|------|
| Node.js | - | 서버 런타임 |
| Express.js | 4.18.2 | 웹 프레임워크 |
| Prisma | 5.7.1 | ORM |
| SQLite | - | 데이터베이스 |
| WebSocket (ws) | 8.14.2 | 실시간 통신 |
| Playwright | 1.40.0 | 브라우저 자동화 (크롤링) |
| Discord.js | 14.14.1 | Discord 봇 |
| OpenAI API | - | AI 분류 |

### 2.3 주요 라이브러리

- **인증**: `jsonwebtoken`, `bcryptjs`
- **파일 처리**: `multer`, `xlsx`
- **HTTP 클라이언트**: `axios`
- **HTML 파싱**: `cheerio`
- **보안**: `helmet`, `cors`
- **프로세스 관리**: `tree-kill`
- **Google Sheets**: `google-spreadsheet`

---

## 3. 시스템 아키텍처

### 3.1 전체 구조

```
┌─────────────────────────────────────────────────────────┐
│                    프론트엔드 (React)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │  App.tsx │  │ Dashboard│  │  Admin   │  │ Monitoring│ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
│       │             │             │             │         │
│       └─────────────┴─────────────┴─────────────┘         │
│                          │                                 │
│                    WebSocket (ws://:8081)                  │
│                    REST API (http://:8080)                 │
└──────────────────────────┼─────────────────────────────────┘
                           │
┌──────────────────────────┼─────────────────────────────────┐
│                    백엔드 (Express)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │  Routes  │  │Controllers│  │ Services │  │Middleware│ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
│       │             │             │             │         │
│       └─────────────┴─────────────┴─────────────┘         │
│                          │                                 │
│                    Prisma ORM                              │
│                          │                                 │
└──────────────────────────┼─────────────────────────────────┘
                           │
┌──────────────────────────┼─────────────────────────────────┐
│                    데이터베이스 (SQLite)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │  Issues │  │  Agents  │  │ Projects │  │  Reports │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└───────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              모니터링 워커 프로세스 (독립 실행)           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Naver Cafe   │  │   Discord    │  │ RawLog       │ │
│  │   Worker     │  │    Worker    │  │  Processor   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│         │                  │                  │          │
│         └──────────────────┴──────────────────┘          │
│                          │                              │
│                    RawLog (임시 저장)                    │
│                          │                              │
│                    Issue (이슈 승격)                     │
└─────────────────────────────────────────────────────────┘
```

### 3.2 데이터 흐름

#### 이슈 생성 흐름

```
1. 외부 소스 (Naver Cafe / Discord)
   ↓
2. 모니터링 워커 (Playwright / Discord.js)
   ↓
3. RawLog 테이블 (임시 저장)
   ↓
4. RawLog Processor (주기적 스캔)
   ↓
5. Issue Classifier (AI 또는 규칙 기반 분류)
   ↓
6. ReportItemIssue 테이블 (이슈 저장)
   ↓
7. WebSocket Publisher (실시간 알림)
   ↓
8. 프론트엔드 (UI 업데이트)
```

#### 일일 보고서 업로드 흐름

```
1. 프론트엔드 (Excel 파일 업로드)
   ↓
2. Files Controller (파일 수신)
   ↓
3. Reports Service (Excel 파싱)
   ↓
4. ReportItemVOC / ReportItemIssue / ReportItemData (저장)
   ↓
5. WebSocket Publisher (업데이트 알림)
```

---

## 4. 데이터베이스 스키마

### 4.1 핵심 모델

#### ReportItemIssue (이슈)
- **목적**: 모든 이슈의 메인 테이블
- **주요 필드**:
  - `id`: 고유 ID
  - `summary`, `detail`: 이슈 내용
  - `severity`: 심각도 (1-3)
  - `status`: 상태 (OPEN, TRIAGED, IN_PROGRESS, RESOLVED, VERIFIED)
  - `source`: 소스 (discord, naver, system)
  - `sentiment`: 감정 분석 (neg, neu, pos)
  - `categoryGroupId`, `categoryId`: 동적 카테고리
  - `aiClassificationReason`, `aiClassificationMethod`: AI 분류 정보
  - `assignedAgentId`: 담당 에이전트
  - `monitoredUrlId`, `monitoredBoardId`: 모니터링 소스 추적

#### Agent (에이전트)
- **목적**: 이슈 처리 담당자 정보
- **주요 필드**:
  - `id`, `name`: 에이전트 식별
  - `status`: 상태 (available, busy, away, offline)
  - `handling`: 현재 처리 중인 이슈 수
  - `todayResolved`: 오늘 처리한 이슈 수
  - `avgHandleSec`: 평균 처리 시간
  - `projectId`: 소속 프로젝트

#### Project (프로젝트)
- **목적**: 다중 프로젝트 지원
- **주요 필드**:
  - `id`, `name`, `description`
  - **관계**: channels, agents, issues, rules, slaPolicies

#### CategoryGroup / Category (카테고리)
- **목적**: 동적 카테고리 시스템
- **구조**:
  - `CategoryGroup`: 대분류 (예: "서버", "퍼포먼스")
  - `Category`: 중분류 (예: "접속 불가", "프레임 드랍")
  - `importance`: 중요도 (HIGH, MEDIUM, LOW)

#### MonitoringKeyword (모니터링 키워드)
- **목적**: 크롤링 시 필터링용 키워드
- **주요 필드**:
  - `type`: 소스 타입 (discord, naver, system)
  - `word`: 키워드
  - `enabled`: 활성화 여부

#### RawLog (원본 로그)
- **목적**: 이슈로 승격되기 전 임시 저장
- **주요 필드**:
  - `source`: 소스 (discord, naver, system)
  - `content`: 원본 내용
  - `isProcessed`: 처리 여부
  - `metadata`: 추가 메타데이터 (JSON)

#### MonitoringConfig (모니터링 설정)
- **목적**: 크롤링 주기, 쿨타임 등 설정
- **주요 필드**:
  - `key`: 설정 키 (예: 'crawler.interval', 'naverCafeCookie')
  - `value`: 설정 값
  - `description`: 설명

### 4.2 관계도

```
Project
  ├── Channel[]
  ├── Agent[]
  ├── ReportItemIssue[]
  ├── ClassificationRule[]
  └── SlaPolicy[]

Agent
  ├── Report[]
  ├── ReportItemIssue[] (assignedIssues)
  ├── IssueComment[]
  ├── AgentSchedule[]
  ├── Project?
  └── User?

ReportItemIssue
  ├── Report
  ├── Project?
  ├── Channel?
  ├── Agent? (assignedAgent)
  ├── CategoryGroup?
  ├── Category?
  ├── MonitoredUrl?
  ├── MonitoredBoard?
  └── IssueComment[]

CategoryGroup
  ├── Category[]
  └── ReportItemIssue[]
```

---

## 5. 주요 기능 모듈

### 5.1 모니터링 시스템

#### Naver Cafe 크롤러
- **파일**: `backend/workers/monitoring/naverCafe.worker.js`
- **기술**: Playwright (브라우저 자동화)
- **기능**:
  - `MonitoredBoard` 테이블의 활성화된 게시판 스캔
  - `MonitoringKeyword`를 사용한 필터링
  - 새로운 게시글을 `RawLog`에 저장
  - 쿠키 기반 인증 지원 (로그인 필요 게시글 접근)
  - 정책 회피 기법:
    - User-Agent 위장
    - 요청 간 딜레이 (1초)
    - 스캔 간격 제어 (기본 60초)
    - Network Idle 대기

#### Discord 봇
- **파일**: `backend/workers/monitoring/discord.worker.js`
- **기술**: Discord.js
- **기능**:
  - Discord 채널 메시지 모니터링
  - `MonitoringKeyword`를 사용한 필터링
  - 메시지를 `RawLog`에 저장

#### RawLog Processor
- **파일**: `backend/workers/rawLogProcessor.worker.js`
- **기능**:
  - `isProcessed=false`인 RawLog 주기적 스캔
  - Naver Cafe RawLog → `upsertIssueFromNaverCafe` → Issue
  - Discord RawLog → 기본 Issue 생성
  - 처리 완료 후 `isProcessed=true`로 업데이트

### 5.2 이슈 분류 시스템

#### AI 기반 분류
- **파일**: `backend/services/aiIssueClassifier.js`
- **기술**: OpenAI API
- **기능**:
  - 이슈 내용을 AI에 전달하여 자동 분류
  - 카테고리 그룹/카테고리 할당
  - 심각도 자동 설정
  - 분류 이유 저장 (`aiClassificationReason`)
  - 분류 방법 저장 (`aiClassificationMethod: 'AI'`)

#### 규칙 기반 분류
- **파일**: `backend/services/issueClassifier.js`
- **기능**:
  - `ClassificationRule` 테이블의 키워드 기반 분류
  - AI 분류 실패 시 자동 폴백
  - 분류 방법 저장 (`aiClassificationMethod: 'RULE'`)

#### 하이브리드 분류
- **전략**: AI 우선, 실패 시 규칙 기반
- **프로세스**:
  1. AI 분류 시도 (API 키가 있는 경우)
  2. 실패 시 규칙 기반 분류
  3. 분류 방법 저장

### 5.3 SLA 모니터링

- **파일**: `backend/workers/sla.worker.js`
- **기능**:
  - 1분마다 SLA 정책 체크
  - 위반 이슈 감지 시 웹훅 알림 전송
  - WebSocket으로 실시간 알림 브로드캐스트
  - 감사 로그 기록 (`AuditLog`)

### 5.4 실시간 통신

- **파일**: `backend/realtime/publisher.js`, `src/hooks/useRealtime.ts`
- **기술**: WebSocket (ws)
- **포트**: 8081
- **이벤트**:
  - `onAgentStatusUpdate`: 에이전트 상태 업데이트
  - `onIssueCreated`: 새 이슈 생성
  - `onIssueUpdated`: 이슈 업데이트
  - `onSlaViolation`: SLA 위반

### 5.5 보고서 생성

#### 일일 보고서
- **파일**: `backend/services/reports.service.js`
- **기능**:
  - Excel 파일 업로드 및 파싱
  - VOC, Issue, Data 시트 처리
  - 데이터베이스 저장

#### 주간 보고서
- **파일**: `backend/services/weekly.service.js`
- **기능**:
  - 기간 선택 (시작일 ~ 종료일)
  - 통계 데이터 생성
  - Excel 파일 생성 및 다운로드

---

## 6. API 엔드포인트

### 6.1 인증 (`/api/auth`)

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| POST | `/login` | 로그인 | Public |
| GET | `/me` | 현재 사용자 정보 | Authenticated |

### 6.2 이슈 (`/api/issues`)

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | `/` | 이슈 목록 조회 | Authenticated |
| GET | `/:id` | 이슈 상세 조회 | Authenticated |
| PATCH | `/:id/status` | 이슈 상태 변경 | Authenticated |
| PATCH | `/:id/assign` | 이슈 할당 | Authenticated |
| POST | `/:id/comments` | 댓글 추가 | Authenticated |

### 6.3 모니터링 (`/api/monitoring`)

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | `/status` | 워커 상태 조회 | Authenticated |
| GET | `/keywords` | 키워드 목록 | Authenticated |
| POST | `/keywords` | 키워드 추가 | ADMIN, LEAD |
| DELETE | `/keywords/:id` | 키워드 삭제 | ADMIN, LEAD |
| GET | `/logs` | 최근 수집 로그 | Authenticated |
| GET | `/config/:key` | 설정 조회 | Authenticated |
| PUT | `/config/:key` | 설정 저장 | ADMIN, LEAD |

### 6.4 에이전트 (`/api/agents`)

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | `/` | 에이전트 목록 | Authenticated |
| POST | `/` | 에이전트 생성 | ADMIN |
| PATCH | `/:id` | 에이전트 수정 | ADMIN |
| DELETE | `/:id` | 에이전트 삭제 | ADMIN |

### 6.5 프로젝트 (`/api/projects`)

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | `/` | 프로젝트 목록 | Authenticated |
| POST | `/` | 프로젝트 생성 | ADMIN |
| GET | `/:id` | 프로젝트 상세 | Authenticated |

### 6.6 보고서 (`/api/reports`)

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| POST | `/upload-report` | 일일 보고서 업로드 | Authenticated |
| GET | `/` | 보고서 목록 | Authenticated |
| GET | `/:id` | 보고서 상세 | Authenticated |

### 6.7 주간 보고서 (`/api/weekly-reports`)

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| POST | `/generate` | 주간 보고서 생성 | Authenticated |
| GET | `/:agentId` | 에이전트별 주간 보고서 목록 | Authenticated |
| GET | `/:agentId/download/:reportId` | 주간 보고서 다운로드 | Authenticated |

---

## 7. 프론트엔드 구조

### 7.1 주요 페이지

#### App.tsx (메인 현황판)
- **경로**: `/`
- **기능**:
  - 실시간 이슈 목록 표시
  - 에이전트 상태 표시
  - KPI 대시보드 (열린 이슈, Sev1, SLA 임박 등)
  - 필터링 (소스, 심각도, 카테고리)
  - 이슈 상세 패널 열기
  - WebSocket 실시간 업데이트

#### Dashboard.tsx (일일 보고서)
- **경로**: `/dashboard`
- **기능**:
  - Excel 파일 업로드
  - 업로드된 보고서 목록
  - 보고서 상세 조회

#### Admin.tsx (관리자 페이지)
- **경로**: `/admin`
- **기능**:
  - 에이전트 관리 (CRUD)
  - 스케줄 관리
  - SLA 정책 관리
  - 프로젝트 관리
  - 카테고리 관리
  - 모니터링 URL 관리

#### MonitoringControl.tsx (모니터링 제어)
- **경로**: `/admin/monitoring`
- **기능**:
  - 워커 상태 표시 (Naver/Discord)
  - 키워드 관리 (추가/삭제)
  - 최근 수집 로그 조회
  - 게시판 관리 (MonitoredBoard)
  - 설정 관리 (크롤링 주기, 쿨타임, 쿠키)

#### WeeklyReportGenerator.tsx (주간 보고서)
- **경로**: `/weekly-report`
- **기능**:
  - 기간 선택
  - 주간 보고서 생성
  - Excel 다운로드

### 7.2 주요 컴포넌트

#### IssueDetailPanel.tsx
- **기능**: 이슈 상세 정보 표시
- **표시 내용**:
  - 기본 정보 (소스, 심각도, 카테고리, 생성 시각)
  - **AI 분류 결과** (보라색/파란색 박스)
    - 분류 방법 (AI 또는 규칙 기반)
    - AI 분류 이유
  - 상태 변경
  - 담당 에이전트 할당
  - 댓글 목록 및 추가

#### MetricsOverview.tsx
- **기능**: KPI 메트릭 표시
- **메트릭**:
  - 열린 이슈 수
  - Sev1 이슈 수
  - SLA 임박 이슈 수
  - 평균 처리 시간

#### ProjectSelector.tsx
- **기능**: 프로젝트 선택 드롭다운

#### ScheduleCalendar.tsx
- **기능**: 에이전트 스케줄 캘린더 표시

### 7.3 상태 관리

- **인증**: `AuthContext.tsx` (Context API)
- **실시간**: `useRealtime.ts` (WebSocket 훅)
- **로컬 상태**: React Hooks (useState, useEffect)

---

## 8. 백엔드 구조

### 8.1 디렉토리 구조

```
backend/
├── server.js              # 서버 진입점 (포트 리스닝, 워커 시작)
├── app.js                 # Express 앱 설정
├── controllers/           # 컨트롤러 (요청 처리)
├── services/             # 서비스 레이어 (비즈니스 로직)
├── routes/               # API 라우트 정의
├── middlewares/          # 미들웨어 (인증, 에러 처리 등)
├── workers/              # 워커 프로세스
│   ├── monitoring/       # 모니터링 워커
│   └── sla.worker.js     # SLA 모니터링 워커
├── utils/                # 유틸리티 함수
├── prisma/               # Prisma 스키마 및 마이그레이션
└── realtime/             # WebSocket 실시간 통신
```

### 8.2 주요 서비스

#### issueClassifier.js
- **기능**: 이슈 자동 분류 (AI + 규칙 하이브리드)
- **프로세스**:
  1. AI 분류 시도
  2. 실패 시 규칙 기반 분류
  3. 분류 결과 저장

#### aiIssueClassifier.js
- **기능**: OpenAI API를 사용한 AI 분류
- **환경 변수**: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`

#### naverCafeIssues.service.js
- **기능**: Naver Cafe 데이터를 이슈로 변환
- **함수**: `upsertIssueFromNaverCafe`

#### monitoring.service.js
- **기능**: 모니터링 관련 비즈니스 로직
- **함수**:
  - `getWorkerStatus`: 워커 상태 조회
  - `getKeywords`: 키워드 목록
  - `createKeyword`: 키워드 생성
  - `getRecentLogs`: 최근 로그 조회
  - `getConfig`, `setConfig`: 설정 관리

#### reports.service.js
- **기능**: 일일 보고서 처리
- **함수**: Excel 파싱, 데이터 저장

#### weekly.service.js
- **기능**: 주간 보고서 생성
- **함수**: 통계 계산, Excel 생성

### 8.3 프로세스 관리

#### server.js의 워커 관리
- **기능**:
  - `child_process.spawn`으로 워커 프로세스 시작
  - 자동 재시작 (5초 딜레이)
  - 우아한 종료 (`tree-kill`)
- **워커**:
  - `naverCafe.worker.js`
  - `discord.worker.js`
  - `rawLogProcessor.worker.js`
  - `sla.worker.js`

---

## 9. 모니터링 시스템

### 9.1 워커 프로세스

#### Naver Cafe Worker
- **파일**: `backend/workers/monitoring/naverCafe.worker.js`
- **기술**: Playwright
- **설정**:
  - `SCAN_INTERVAL_MS`: 스캔 간격 (기본 60초)
  - `BROWSER_HEADLESS`: 헤드리스 모드
- **프로세스**:
  1. `MonitoredBoard`에서 활성화된 게시판 조회
  2. 각 게시판 스캔 (간격 체크)
  3. 새로운 게시글 감지
  4. `MonitoringKeyword`로 필터링
  5. `RawLog`에 저장

#### Discord Worker
- **파일**: `backend/workers/monitoring/discord.worker.js`
- **기술**: Discord.js
- **프로세스**:
  1. Discord 봇 로그인
  2. 채널 메시지 모니터링
  3. `MonitoringKeyword`로 필터링
  4. `RawLog`에 저장

#### RawLog Processor
- **파일**: `backend/workers/rawLogProcessor.worker.js`
- **프로세스**:
  1. `isProcessed=false`인 RawLog 주기적 스캔
  2. Naver Cafe RawLog → Issue 변환
  3. Discord RawLog → Issue 변환
  4. `isProcessed=true`로 업데이트

### 9.2 정책 회피 기법

#### 현재 구현
- Playwright 브라우저 자동화
- User-Agent 위장
- 쿠키 기반 인증
- 요청 간 딜레이 (1초)
- 스캔 간격 제어 (60초)
- Network Idle 대기

#### 미구현
- 프록시 로테이션
- Fingerprint 스푸핑
- Stealth 플러그인
- 랜덤 딜레이
- 마우스/키보드 이벤트 시뮬레이션

---

## 10. AI 분류 시스템

### 10.1 AI 분류 프로세스

1. **이슈 생성 시**:
   - `issueClassifier.js` 호출
   - AI 분류 시도 (API 키가 있는 경우)
   - 실패 시 규칙 기반 분류

2. **AI 분류**:
   - `aiIssueClassifier.js` 호출
   - OpenAI API에 이슈 내용 전달
   - 카테고리 그룹/카테고리, 심각도, 분류 이유 반환
   - `aiClassificationMethod: 'AI'` 저장
   - `aiClassificationReason` 저장

3. **규칙 기반 분류**:
   - `ClassificationRule` 테이블의 키워드 매칭
   - `aiClassificationMethod: 'RULE'` 저장

### 10.2 UI 표시

- **위치**: 이슈 상세 패널 (`IssueDetailPanel.tsx`)
- **디자인**: 보라색/파란색 그라데이션 박스
- **표시 내용**:
  - 분류 방법 배지 (🤖 AI 분류 또는 📋 규칙 기반 분류)
  - AI 분류 이유 (`aiClassificationReason`)

### 10.3 설정

- **환경 변수**:
  - `OPENAI_API_KEY`: OpenAI API 키
  - `OPENAI_BASE_URL`: API 베이스 URL (선택)
  - `OPENAI_MODEL`: 모델 이름 (선택, 기본: gpt-4)

---

## 11. 실시간 통신

### 11.1 WebSocket 서버

- **포트**: 8081
- **파일**: `backend/realtime/publisher.js`
- **기능**: 이벤트 브로드캐스트

### 11.2 이벤트 타입

- `onAgentStatusUpdate`: 에이전트 상태 업데이트
- `onIssueCreated`: 새 이슈 생성
- `onIssueUpdated`: 이슈 업데이트
- `onSlaViolation`: SLA 위반

### 11.3 프론트엔드 연동

- **파일**: `src/hooks/useRealtime.ts`
- **기능**: WebSocket 연결 및 이벤트 수신
- **사용**: `App.tsx`에서 실시간 업데이트

---

## 12. 인증 및 권한

### 12.1 인증 방식

- **JWT (JSON Web Token)**
- **미들웨어**: `backend/middlewares/auth.middleware.js`
- **함수**: `authenticate`, `requireRole`

### 12.2 역할 (Role)

- **AGENT**: 일반 사용자
- **LEAD**: 팀 리더
- **ADMIN**: 관리자

### 12.3 권한 매트릭스

| 기능 | AGENT | LEAD | ADMIN |
|------|-------|------|-------|
| 이슈 조회 | ✅ | ✅ | ✅ |
| 이슈 상태 변경 | ✅ | ✅ | ✅ |
| 이슈 할당 | ✅ | ✅ | ✅ |
| 키워드 관리 | ❌ | ✅ | ✅ |
| 설정 관리 | ❌ | ✅ | ✅ |
| 에이전트 관리 | ❌ | ❌ | ✅ |
| 프로젝트 관리 | ❌ | ❌ | ✅ |

---

## 13. 배포 및 설정

### 13.1 환경 변수

#### 백엔드 (`.env`)

```env
# 데이터베이스
DATABASE_URL="file:./prisma/dev.db"

# 서버
PORT=8080
WS_PORT=8081
NODE_ENV=development

# JWT
JWT_SECRET=your-secret-key

# OpenAI (AI 분류)
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4

# Naver Cafe (크롤링)
NAVER_CAFE_COOKIE=your-cookie-string
BROWSER_HEADLESS=true
NAVER_CAFE_SCAN_INTERVAL_MS=60000

# Discord (봇)
DISCORD_BOT_TOKEN=your-bot-token
```

### 13.2 데이터베이스 설정

```bash
# Prisma 클라이언트 생성
cd backend
npx prisma generate

# 마이그레이션 적용
npx prisma migrate dev

# 또는 스키마 푸시 (개발용)
npx prisma db push
```

### 13.3 서버 실행

#### 백엔드
```bash
cd backend
npm install
npm start
```

#### 프론트엔드
```bash
npm install
npm run dev
```

### 13.4 프로덕션 빌드

#### 프론트엔드
```bash
npm run build
# dist/ 폴더에 빌드된 파일 생성
```

---

## 14. 향후 개선 사항

### 14.1 모니터링 시스템

- [ ] 프록시 로테이션 구현
- [ ] Fingerprint 스푸핑 추가
- [ ] Stealth 플러그인 통합
- [ ] 랜덤 딜레이 적용
- [ ] robots.txt 확인 기능

### 14.2 AI 분류

- [ ] 분류 정확도 개선
- [ ] 분류 히스토리 추적
- [ ] 분류 피드백 시스템
- [ ] 커스텀 프롬프트 설정

### 14.3 성능 최적화

- [ ] 데이터베이스 인덱스 최적화
- [ ] 쿼리 최적화
- [ ] 캐싱 시스템 도입
- [ ] 페이지네이션 개선

### 14.4 사용자 경험

- [ ] 다크 모드 완전 지원
- [ ] 반응형 디자인 개선
- [ ] 키보드 단축키
- [ ] 알림 시스템 개선

### 14.5 테스트

- [ ] 단위 테스트 확대
- [ ] 통합 테스트 추가
- [ ] E2E 테스트 도입
- [ ] 성능 테스트

### 14.6 문서화

- [ ] API 문서 자동 생성 (Swagger)
- [ ] 사용자 가이드 작성
- [ ] 개발자 가이드 보완
- [ ] 배포 가이드 작성

---

## 부록

### A. 주요 파일 목록

#### 프론트엔드
- `src/App.tsx`: 메인 현황판
- `src/Dashboard.tsx`: 일일 보고서
- `src/Admin.tsx`: 관리자 페이지
- `src/pages/Admin/MonitoringControl.tsx`: 모니터링 제어
- `src/components/IssueDetailPanel.tsx`: 이슈 상세 패널

#### 백엔드
- `backend/server.js`: 서버 진입점
- `backend/app.js`: Express 앱 설정
- `backend/services/issueClassifier.js`: 이슈 분류
- `backend/services/aiIssueClassifier.js`: AI 분류
- `backend/workers/monitoring/naverCafe.worker.js`: Naver 크롤러
- `backend/workers/monitoring/discord.worker.js`: Discord 봇
- `backend/workers/rawLogProcessor.worker.js`: RawLog 처리

### B. 참고 문서

- `PROJECT_STRUCTURE.md`: 프로젝트 구조 상세
- `AI_CLASSIFICATION_UI_GUIDE.md`: AI 분류 UI 가이드
- `NAVER_CRAWLING_TECHNIQUES.md`: 네이버 크롤링 기법
- `DATA_COLLECTION_GUIDE.md`: 데이터 수집 가이드
- `AI_ANALYSIS_STATUS.md`: AI 분석 상태

---

**문서 버전**: 2.0  
**최종 업데이트**: 2025-11-25  
**작성자**: AI Assistant




















