# 모니터링 워커

이 폴더에는 독립 프로세스로 실행되는 모니터링 워커들이 있습니다.

## 워커 목록

### naverCafe.worker.js
- **기술**: Playwright
- **기능**: Naver Cafe 게시판 스캔 및 RawLog 저장 (주 워커)
- **특징**: `lastArticleId` 기반 증분 스캔
- **설정**:
  - `NAVER_CAFE_SCAN_INTERVAL_MS`: 스캔 간격 (기본: 300000ms = 5분)
  - `BROWSER_HEADLESS`: 헤드리스 모드 (기본: true)
  - `NAVER_CAFE_COOKIE`: Naver Cafe 쿠키 (선택)

### naverCafeBackfill.worker.js
- **기술**: Playwright
- **기능**: Naver Cafe 게시판 백필 스캔 (보조 워커)
- **특징**: 
  - 누락 방지를 위한 겹침 스캔
  - `lastArticleId`에 의존하지 않음 (최근 N페이지 스캔)
  - DB 레벨 중복 방지 (boardId, articleId 유니크 인덱스)
  - 절대 `lastArticleId`를 업데이트하지 않음
- **설정**:
  - `NAVER_CAFE_BACKFILL_PAGES`: 스캔할 페이지 수 (기본: 5)
  - `NAVER_CAFE_BACKFILL_MIN_WAIT_MS`: 최소 대기 시간 (기본: 900000ms = 15분)
  - `NAVER_CAFE_BACKFILL_MAX_WAIT_MS`: 최대 대기 시간 (기본: 1800000ms = 30분)
  - `BROWSER_HEADLESS`: 헤드리스 모드 (기본: true)
  - `NAVER_CAFE_COOKIE`: Naver Cafe 쿠키 (선택)

### discord.worker.js
- **기술**: Discord.js
- **기능**: Discord 메시지 수집 및 RawLog 저장
- **설정**:
  - `DISCORD_BOT_TOKEN`: Discord 봇 토큰 (필수)
  - `DISCORD_GUILD_ID`: Discord 서버 ID (선택)
  - `DISCORD_CHANNEL_IDS`: 모니터링할 채널 ID 목록 (쉼표로 구분, 선택)

## 동작 방식

1. 각 워커는 독립 프로세스로 실행됩니다.
2. `MonitoringKeyword` 테이블에서 활성화된 키워드를 로드하여 필터링합니다.
3. 필터링된 데이터는 `RawLog` 테이블에 저장됩니다.
4. 메인 서버는 `child_process.spawn`으로 워커를 관리합니다.
5. 워커가 에러로 종료되면 5초 후 자동으로 재시작됩니다.

## 데이터 흐름

```
워커 프로세스
  ↓
MonitoringKeyword 로드 (필터링)
  ↓
데이터 수집 (Naver Cafe / Discord)
  ↓
키워드 필터링
  ↓
RawLog 테이블 저장
  ↓
(나중에 별도 프로세스가 RawLog를 Issue로 승격)
```

## 실행

워커는 메인 서버(`server.js`)가 시작될 때 자동으로 실행됩니다.

수동 실행:
```bash
node workers/monitoring/naverCafe.worker.js
node workers/monitoring/naverCafeBackfill.worker.js
node workers/monitoring/discord.worker.js
```

## 백필 워커 설정

백필 워커는 주 워커와 병렬로 실행되어 누락 방지를 담당합니다.

### 데이터베이스 마이그레이션

백필 워커를 사용하기 전에 다음 마이그레이션을 실행해야 합니다:

```bash
# SQLite의 경우
sqlite3 backend/prisma/dev.db < backend/migrations/002_add_rawlog_board_article_columns.sql

# 또는 Node.js 스크립트로 실행
node -e "const {execute}=require('./libs/db');const fs=require('fs');const sql=fs.readFileSync('backend/migrations/002_add_rawlog_board_article_columns.sql','utf8');sql.split(';').forEach(s=>s.trim()&&execute(s+';'));"
```

### 동작 방식

1. **주 워커** (`naverCafe.worker.js`): `lastArticleId` 기반 증분 스캔
2. **백필 워커** (`naverCafeBackfill.worker.js`): 최근 N페이지 전체 스캔 (겹침)
3. **중복 방지**: DB 레벨 유니크 인덱스 (`boardId`, `articleId`)로 자동 처리
4. **결과**: 주 워커가 놓친 게시글도 백필 워커가 수집

### 성능 최적화

- 백필 워커는 게시판별로 병렬 스캔 (동시성: 2개)
- 각 게시판은 최대 N페이지만 스캔하여 리소스 사용 최소화

## 문제 해결

### Playwright 브라우저 설치
```bash
npx playwright install chromium
```

### Discord 봇 토큰 설정
1. Discord Developer Portal에서 봇 생성
2. 봇에 필요한 권한 부여:
   - Read Messages
   - View Channels
   - Read Message History
3. `.env` 파일에 `DISCORD_BOT_TOKEN` 설정

### 워커가 재시작되지 않는 경우
- 로그 확인: `[WorkerManager]` 태그로 검색
- 프로세스 상태 확인: `ps aux | grep worker`
- 수동 재시작: 서버 재시작




















