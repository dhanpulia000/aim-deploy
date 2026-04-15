# 크롤러 아키텍처 문서

## 📋 목차
1. [개요](#개요)
2. [크롤러 구조](#크롤러-구조)
3. [데이터 흐름](#데이터-흐름)
4. [워커 프로세스](#워커-프로세스)
5. [서비스 레이어](#서비스-레이어)
6. [데이터베이스 스키마](#데이터베이스-스키마)
7. [누락 방지 전략](#누락-방지-전략)

---

## 개요

이 시스템은 **다중 소스 크롤러 아키텍처**를 사용하여 네이버 카페, Discord, Slack 등 다양한 소스에서 이슈를 수집합니다.

### 주요 특징
- **독립 워커 프로세스**: 각 크롤러는 별도의 Node.js 프로세스로 실행
- **자동 재시작**: 워커 프로세스가 종료되면 자동으로 재시작
- **랜덤화된 스캔**: 봇 탐지 방지를 위한 랜덤 대기 시간 및 User-Agent
- **중복 방지**: `articleId` 기반 중복 체크
- **실시간 업데이트**: WebSocket을 통한 실시간 이슈 브로드캐스트

---

## 크롤러 구조

### 1. 모니터링 워커 (Monitoring Workers)

#### 1.1 Naver Cafe 모니터링 워커
**파일**: `backend/workers/monitoring/naverCafe.worker.js`

**기능**:
- `MonitoredBoard` 테이블의 활성화된 게시판을 주기적으로 스캔
- Playwright를 사용한 브라우저 자동화
- 게시글 목록에서 새 게시글 감지
- `MonitoringKeyword`를 사용한 키워드 필터링
- `RawLog` 테이블에 수집 데이터 저장

**스캔 주기**:
- 기본: 150-240초 랜덤 대기 (환경 변수 또는 DB 설정 가능)
- 설정 우선순위: 환경 변수 > DB 설정 > 기본값

**주요 설정**:
```javascript
MIN_WAIT_MS = 150000;  // 2분 30초
MAX_WAIT_MS = 240000;  // 4분
```

**User-Agent 랜덤화**:
- 11개의 최신 브라우저 User-Agent 중 랜덤 선택
- 각 요청마다 다른 User-Agent 사용

**데이터 수집 프로세스**:
1. `MonitoredBoard`에서 `enabled = 1`인 게시판 조회
2. 각 게시판의 `listUrl` 접속
3. 게시글 목록에서 `lastArticleId` 이후의 새 게시글만 필터링
4. `MonitoringKeyword`로 키워드 매칭
5. 매칭된 게시글의 상세 내용 크롤링
6. `RawLog` 테이블에 저장

**중복 방지**:
- `articleId` 기반 중복 체크
- `lastArticleId`를 게시판별로 저장하여 이전 게시글 스킵

#### 1.2 Discord 모니터링 워커
**파일**: `backend/workers/monitoring/discord.worker.js`

**기능**:
- Discord 채널 모니터링
- 새 메시지 감지 및 이슈 변환

---

### 2. 수집 워커 (Ingestion Workers)

#### 2.1 Slack 공지 수집 워커
**파일**: `backend/workers/ingestion/slackNotice.worker.js`

**기능**:
- Slack 채널의 공지사항 자동 수집
- `CustomerFeedbackNotice` 테이블에 저장
- 이슈 큐에는 표시되지 않음 (공지 전용)

**설정**:
- `SLACK_BOT_TOKEN`: Slack Bot 토큰
- `SLACK_NOTICE_CHANNEL_ID`: 모니터링할 채널 ID
- `SLACK_NOTICE_USER_IDS`: 특정 작성자만 필터링 (선택)
- `SLACK_NOTICE_USER_NAMES`: 작성자 ID-이름 매핑 (선택)

**필터링 조건**:
- 채널 필터: `SLACK_NOTICE_CHANNEL_ID`에 지정된 채널만
- 작성자 필터: `SLACK_NOTICE_USER_IDS`가 설정된 경우 해당 작성자만
- 내용 필터: "공지" 키워드 또는 특정 이모지 포함

**스캔 주기**:
- 기본: 10분 (600초)
- 환경 변수: `SLACK_NOTICE_SCAN_INTERVAL_MS`

#### 2.2 Naver Cafe 수집 워커 (플레이스홀더)
**파일**: `backend/workers/ingestion/naverCafe.worker.js`

**현재 상태**: 플레이스홀더 (구현 예정)

---

### 3. 수동 수집 (Manual Ingest)

**파일**: `backend/services/manualIngest.service.js`

**기능**:
- 사용자가 URL을 직접 입력하여 즉시 수집
- 로그인 필요한 게시글 수집 지원 (쿠키 제공)
- 브라우저 `localStorage`에 쿠키 저장 (선택)

**프로세스**:
1. 사용자가 게시글 URL 입력
2. 선택적으로 로그인 쿠키 제공
3. Playwright로 게시글 크롤링
4. `upsertIssueFromNaverCafe`로 이슈 생성/업데이트

**API 엔드포인트**:
- `POST /api/ingestion/manual`
- Body: `{ url: string, cookies?: string }`

---

## 데이터 흐름

### Naver Cafe 크롤링 플로우

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Naver Cafe 모니터링 워커 시작                            │
│    (backend/workers/monitoring/naverCafe.worker.js)          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. MonitoredBoard 조회                                       │
│    - enabled = 1인 게시판만                                  │
│    - lastArticleId 확인                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. 게시판 목록 페이지 스캔                                   │
│    - Playwright로 브라우저 자동화                            │
│    - 랜덤 User-Agent 사용                                    │
│    - 게시글 목록 추출                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. 새 게시글 필터링                                          │
│    - lastArticleId 이후 게시글만                             │
│    - MonitoringKeyword로 키워드 매칭                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. 게시글 상세 내용 크롤링                                   │
│    - 제목, 내용, 작성자, 작성일시 추출                      │
│    - 댓글 수집 (선택)                                        │
│    - 이미지/스크린샷 캡처 (선택)                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. RawLog 테이블에 저장                                      │
│    - 수집된 원시 데이터 저장                                 │
│    - articleId, boardId, content 등                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. RawLog 처리 워커                                         │
│    (backend/workers/rawLogProcessor.worker.js)              │
│    - RawLog를 Issue로 변환                                  │
│    - AI 분류 및 카테고리 할당                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Issue 생성/업데이트                                       │
│    (backend/services/naverCafeIssues.service.js)            │
│    - 중복 체크 (articleId 기반)                              │
│    - AI 분류 실행                                            │
│    - 에이전트 자동 할당 (스케줄 기반)                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. WebSocket 브로드캐스트                                    │
│    - 실시간 이슈 업데이트 전송                               │
│    - 프론트엔드 자동 새로고침                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 워커 프로세스

### 워커 관리 시스템

**파일**: `backend/server.js`

**주요 함수**:
- `startMonitoringWorker(workerName, scriptPath)`: 워커 프로세스 시작
- `startWorker(workerName, scriptPath)`: 외부에서 호출 가능한 워커 시작 함수
- `startSlackNoticeWorker()`: Slack 공지 워커 시작

**프로세스 관리**:
- `workerProcesses` Map에 워커 프로세스 저장
- 워커 종료 시 자동 재시작 (5초 후)
- 프로세스 상태 모니터링

**현재 실행 중인 워커**:
1. `naverCafe`: Naver Cafe 모니터링 워커
2. `discord`: Discord 모니터링 워커
3. `slackNotice`: Slack 공지 수집 워커
4. `rawLogProcessor`: RawLog 처리 워커
5. `sla`: SLA 모니터링 워커

### 워커 시작 시점

**서버 시작 시 자동 시작**:
```javascript
// server.js의 startServer() 함수에서
startMonitoringWorker('naverCafe', 'workers/monitoring/naverCafe.worker.js');
startMonitoringWorker('discord', 'workers/monitoring/discord.worker.js');
startSlackNoticeWorker();
```

**수동 시작**:
- API 엔드포인트: `POST /api/monitoring/workers/:workerName/start`
- 또는 `server.js`의 `startWorker()` 함수 직접 호출

---

## 서비스 레이어

### 1. naverCafeIssues.service.js

**주요 함수**:
- `upsertIssueFromNaverCafe(data)`: Naver Cafe 게시글을 Issue로 변환
- `findAgentByWorkSchedule(targetTime, projectId)`: 스케줄 기반 에이전트 자동 할당

**처리 프로세스**:
1. `articleId` 기반 중복 체크
2. AI 분류 실행 (`classifyIssueCategory`)
3. 카테고리 중요도 → 심각도 변환
4. 에이전트 자동 할당 (스케줄 기반)
5. Issue 생성/업데이트
6. WebSocket 브로드캐스트

### 2. monitoring.service.js

**주요 함수**:
- `getWorkerStatus()`: 워커 프로세스 상태 조회
- `getKeywords(options)`: 모니터링 키워드 목록 조회
- `getBoards(options)`: 모니터링 게시판 목록 조회

### 3. manualIngest.service.js

**주요 함수**:
- `ingestByUrl(url, customCookies)`: URL 기반 수동 수집

**특징**:
- 로그인 필요한 게시글 지원 (쿠키 제공)
- 브라우저 `localStorage`에 쿠키 저장 (선택)

---

## 데이터베이스 스키마

### 주요 테이블

#### 1. MonitoredBoard
게시판 모니터링 설정

**컬럼**:
- `id`: 게시판 ID
- `label`: 게시판 이름
- `listUrl`: 게시판 목록 URL
- `cafeGame`: 게임명 (PUBG_PC, PUBG_MOBILE 등)
- `enabled`: 활성화 여부 (1/0)
- `interval`: 스캔 주기 (초)
- `lastArticleId`: 마지막 처리된 게시글 ID
- `lastScanAt`: 마지막 스캔 시간
- `projectId`: 프로젝트 ID

#### 2. MonitoringKeyword
모니터링 키워드 설정

**컬럼**:
- `id`: 키워드 ID
- `keyword`: 키워드 텍스트
- `type`: 키워드 타입 (예: 'naver_cafe')
- `enabled`: 활성화 여부 (1/0)
- `projectId`: 프로젝트 ID

#### 3. RawLog
수집된 원시 데이터

**컬럼**:
- `id`: RawLog ID
- `articleId`: 게시글 ID
- `boardId`: 게시판 ID
- `content`: 게시글 내용
- `title`: 게시글 제목
- `author`: 작성자
- `createdAt`: 작성일시
- `collectedAt`: 수집일시
- `processed`: 처리 여부 (1/0)

#### 4. ReportItemIssue
이슈 테이블

**컬럼**:
- `id`: 이슈 ID
- `externalPostId`: 외부 게시글 ID (articleId)
- `summary`: 이슈 요약
- `detail`: 이슈 상세 내용
- `severity`: 심각도 (1, 2, 3)
- `status`: 상태 (OPEN, TRIAGED, IN_PROGRESS, RESOLVED 등)
- `assignedAgentId`: 할당된 에이전트 ID
- `categoryId`: 카테고리 ID
- `sourceCreatedAt`: 원본 게시글 작성일시
- `requiresLogin`: 로그인 필요 여부 (1/0)
- `hasImages`: 이미지 포함 여부 (1/0)
- `isHotTopic`: 핫토픽 여부 (1/0)

---

## 누락 방지 전략

### 현재 구현된 방지 메커니즘

#### 1. 중복 체크
- **articleId 기반**: 동일 `articleId`의 게시글은 한 번만 처리
- **lastArticleId 추적**: 게시판별로 마지막 처리된 게시글 ID 저장

#### 2. 스캔 주기 최적화
- **랜덤 대기 시간**: 150-240초 랜덤 대기로 봇 탐지 방지
- **게시판별 interval**: 게시판마다 다른 스캔 주기 설정 가능

#### 3. 에러 복구
- **자동 재시작**: 워커 프로세스 종료 시 자동 재시작
- **재시도 로직**: `retryBrowserOperation` 유틸리티 사용

#### 4. 로그인 필요 게시글 처리
- **수동 수집**: 사용자가 쿠키를 제공하여 수동 수집 가능
- **쿠키 저장**: 브라우저 `localStorage`에 쿠키 저장 (선택)

### 개선 가능한 영역

#### 1. 추가 크롤러 전략

**문제점**:
- 단일 워커가 모든 게시판을 순차적으로 스캔
- 한 게시판에서 에러 발생 시 다른 게시판 스캔 지연 가능

**개선 방안**:
1. **게시판별 독립 워커**: 각 게시판마다 별도 워커 프로세스 실행
2. **병렬 스캔**: 여러 게시판을 동시에 스캔
3. **우선순위 큐**: 중요 게시판 우선 스캔

#### 2. 백필(Backfill) 메커니즘

**현재 상태**:
- `lastArticleId` 이후 게시글만 처리
- 서버 다운타임 중 누락된 게시글은 복구 불가

**개선 방안**:
1. **주기적 백필**: 일정 주기마다 최근 N일치 게시글 재스캔
2. **간격 기반 백필**: `lastScanAt`과 현재 시간의 간격이 크면 백필 실행
3. **수동 백필 API**: 관리자가 특정 기간의 게시글을 수동으로 재스캔

#### 3. 모니터링 및 알림

**개선 방안**:
1. **스캔 실패 알림**: 게시판 스캔 실패 시 알림 발송
2. **누락 감지**: 예상 게시글 수와 실제 수집 수 비교
3. **대시보드**: 크롤러 상태 및 통계 대시보드

#### 4. 데이터 검증

**개선 방안**:
1. **게시글 수 검증**: 게시판의 총 게시글 수와 수집된 게시글 수 비교
2. **시간 기반 검증**: 특정 시간대 게시글이 누락되었는지 확인
3. **키워드 매칭 검증**: 키워드가 포함된 게시글이 모두 수집되었는지 확인

### 권장 구현 순서

1. **게시판별 독립 워커** (우선순위: 높음)
   - 각 게시판마다 별도 워커 프로세스 실행
   - 게시판별 에러 격리

2. **백필 메커니즘** (우선순위: 높음)
   - 주기적 백필 (예: 매일 자정에 최근 24시간치 재스캔)
   - 간격 기반 백필 (스캔 간격이 1시간 이상이면 백필)

3. **모니터링 및 알림** (우선순위: 중간)
   - 스캔 실패 알림
   - 크롤러 상태 대시보드

4. **데이터 검증** (우선순위: 낮음)
   - 게시글 수 검증
   - 시간 기반 검증

---

## 파일 구조

```
backend/
├── workers/
│   ├── monitoring/          # 모니터링 워커
│   │   ├── naverCafe.worker.js
│   │   ├── discord.worker.js
│   │   └── README.md
│   ├── ingestion/           # 수집 워커
│   │   ├── naverCafe.worker.js (플레이스홀더)
│   │   ├── slackNotice.worker.js
│   │   └── discord.worker.js
│   ├── rawLogProcessor.worker.js
│   └── sla.worker.js
├── services/
│   ├── naverCafeIssues.service.js
│   ├── monitoring.service.js
│   ├── manualIngest.service.js
│   ├── boardScanner.js (DEPRECATED)
│   └── scraper/
│       ├── naverCafeScraper.js
│       └── naverCafeBoardScraper.js
├── server.js                # 워커 프로세스 관리
└── routes/
    └── monitoring.routes.js
```

---

## 환경 변수

### Naver Cafe 워커
- `NAVER_CAFE_SCAN_INTERVAL_MS`: 스캔 주기 (밀리초)
- `BROWSER_HEADLESS`: 브라우저 헤드리스 모드 (true/false)
- `NAVER_CAFE_WATCH_AUTHORS`: 주시할 작성자 목록 (쉼표 구분)
- `NAVER_CAFE_HOT_TOPIC_THRESHOLD`: 핫토픽 댓글 수 임계값

### Slack 공지 워커
- `SLACK_BOT_TOKEN`: Slack Bot 토큰
- `SLACK_NOTICE_CHANNEL_ID`: 모니터링할 채널 ID
- `SLACK_NOTICE_USER_IDS`: 특정 작성자만 필터링 (선택)
- `SLACK_NOTICE_USER_NAMES`: 작성자 ID-이름 매핑 (선택)
- `SLACK_NOTICE_SCAN_INTERVAL_MS`: 스캔 주기 (밀리초)

---

## API 엔드포인트

### 모니터링
- `GET /api/monitoring/workers/status`: 워커 상태 조회
- `POST /api/monitoring/workers/:workerName/start`: 워커 시작
- `POST /api/monitoring/workers/:workerName/stop`: 워커 중지
- `GET /api/monitoring/boards`: 모니터링 게시판 목록
- `GET /api/monitoring/keywords`: 모니터링 키워드 목록

### 수동 수집
- `POST /api/ingestion/manual`: URL 기반 수동 수집

---

## 로그 및 디버깅

### 로그 위치
- `logs/application-YYYY-MM-DD.log`: 일일 로그 파일
- `logs/error-YYYY-MM-DD.log`: 에러 로그 파일

### 주요 로그 메시지
- `[NaverCafeWorker]`: Naver Cafe 워커 관련 로그
- `[SlackNoticeWorker]`: Slack 공지 워커 관련 로그
- `[WorkerManager]`: 워커 프로세스 관리 로그
- `[NaverCafeIssues]`: 이슈 변환 관련 로그

---

## 문제 해결

### 워커가 시작되지 않는 경우
1. 환경 변수 확인
2. 포트 충돌 확인
3. 로그 파일 확인

### 게시글이 누락되는 경우
1. `lastArticleId` 확인
2. `MonitoringKeyword` 필터 확인
3. 게시판 `enabled` 상태 확인
4. 로그인 필요 게시글인지 확인

### 성능 문제
1. 스캔 주기 조정
2. 게시판별 독립 워커로 분리
3. 병렬 스캔 구현

---

## 참고 문서

- `backend/workers/monitoring/README.md`: 모니터링 워커 상세 문서
- `backend/MONITORING_WORKER_SETUP.md`: 모니터링 워커 설정 가이드
- `backend/DATA_COLLECTION_GUIDE.md`: 데이터 수집 가이드







