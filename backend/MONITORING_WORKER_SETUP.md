# 모니터링 워커 설정 가이드

## 개요

기존의 단순 크롤링 로직을 Playwright 기반의 독립 프로세스로 교체하여 서버 안정성을 강화했습니다.

## 주요 변경사항

### 1. 모니터링 워커 프로세스
- `backend/workers/monitoring/` 폴더에 독립 프로세스 워커 추가
- Playwright 기반 Naver Cafe 크롤러
- Discord.js 기반 Discord 봇

### 2. 서버 프로세스 관리
- `child_process.spawn`으로 워커 프로세스 관리
- 자동 재시작 기능 (에러 시 5초 후 재시작)
- 우아한 종료 (SIGINT/SIGTERM 시 모든 워커 종료)

### 3. 데이터베이스 최적화
- SQLite WAL 모드 설정 (동시성 처리 최적화)

## 설치

### 1. 의존성 설치

```bash
cd backend
npm install
```

### 2. Playwright 브라우저 설치

```bash
npx playwright install chromium
```

## 환경 변수 설정

`.env` 파일에 다음 환경 변수를 추가하세요:

```env
# Naver Cafe 워커
NAVER_CAFE_SCAN_INTERVAL_MS=60000  # 스캔 간격 (밀리초)
BROWSER_HEADLESS=true              # 헤드리스 모드
NAVER_CAFE_COOKIE=...              # Naver Cafe 쿠키 (선택)

# Discord 워커
DISCORD_BOT_TOKEN=...              # Discord 봇 토큰 (필수)
DISCORD_GUILD_ID=...              # Discord 서버 ID (선택)
DISCORD_CHANNEL_IDS=...           # 모니터링할 채널 ID (쉼표로 구분, 선택)
```

## 데이터베이스 마이그레이션

새로운 테이블을 사용하기 위해 마이그레이션을 실행하세요:

```bash
cd backend
npx prisma db push
# 또는
npx prisma migrate dev --name add_monitoring_tables
```

## 실행

### 서버 시작

```bash
cd backend
npm start
```

서버가 시작되면 자동으로 모니터링 워커들이 실행됩니다.

### 로그 확인

워커 로그는 메인 서버 로그에 포함됩니다:
- `[WorkerManager]`: 워커 프로세스 관리 로그
- `[NaverCafeWorker]`: Naver Cafe 워커 로그
- `[DiscordWorker]`: Discord 워커 로그

## 워커 동작 방식

### 1. Naver Cafe 워커
1. `MonitoredBoard` 테이블에서 활성화된 게시판 조회
2. Playwright로 게시판 목록 페이지 스캔
3. `MonitoringKeyword` 테이블에서 키워드 로드
4. 키워드 필터링
5. 필터링된 게시글을 `RawLog` 테이블에 저장

### 2. Discord 워커
1. Discord 봇으로 메시지 수신
2. `MonitoringKeyword` 테이블에서 키워드 로드
3. 키워드 필터링
4. 필터링된 메시지를 `RawLog` 테이블에 저장

## 키워드 관리

`MonitoringKeyword` 테이블에 키워드를 추가하여 필터링을 설정할 수 있습니다:

```sql
INSERT INTO MonitoringKeyword (type, word, enabled) VALUES 
  ('naver', '버그', 1),
  ('naver', '오류', 1),
  ('discord', '이슈', 1);
```

또는 API를 통해 관리:
- `POST /api/monitoring-keywords` (구현 필요)

## 문제 해결

### 워커가 시작되지 않는 경우
1. 로그에서 에러 메시지 확인
2. 환경 변수 설정 확인
3. 의존성 설치 확인 (`npm install`)
4. Playwright 브라우저 설치 확인 (`npx playwright install chromium`)

### 워커가 계속 재시작되는 경우
1. 워커 로그에서 에러 원인 확인
2. 데이터베이스 연결 확인
3. 환경 변수 설정 확인
4. 권한 문제 확인 (Discord 봇 토큰 등)

### 데이터가 수집되지 않는 경우
1. `MonitoredBoard` 테이블에 활성화된 게시판이 있는지 확인
2. `MonitoringKeyword` 테이블에 키워드가 설정되어 있는지 확인
3. 키워드가 너무 제한적이면 모든 데이터가 필터링될 수 있음
4. `RawLog` 테이블에 데이터가 저장되는지 확인

## 성능 최적화

### SQLite WAL 모드
- 자동으로 설정됨 (`libs/db.js`)
- 동시 읽기/쓰기 성능 향상
- 트랜잭션 충돌 감소

### 워커 프로세스 분리
- 메인 서버와 독립적으로 실행
- 워커 크래시가 메인 서버에 영향 없음
- 자동 재시작으로 안정성 향상

## 다음 단계

1. **RawLog → Issue 승격 프로세스 구현**
   - 별도 워커 또는 스케줄러로 `RawLog`를 `ReportItemIssue`로 변환
   - 기존 `naverCafeIssues.service.js` 로직 활용

2. **모니터링 설정 API 구현**
   - `MonitoringKeyword` CRUD API
   - `MonitoringConfig` CRUD API

3. **워커 상태 모니터링**
   - 워커 상태 API 엔드포인트
   - 워커 재시작 API

## 참고

- 기존 스케줄러(`startNaverCafeScheduler`, `startBoardScanner`)는 비활성화되었습니다.
- 레거시 스크래퍼 파일은 `backend/deprecated/` 폴더에 보관되어 있습니다.




















