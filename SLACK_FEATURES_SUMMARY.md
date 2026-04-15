# Slack 기능 구현 현황 및 적용 가이드

## 📋 목차
1. [구현된 기능 목록](#구현된-기능-목록)
2. [기능 상세 설명](#기능-상세-설명)
3. [실제 적용을 위한 준비사항](#실제-적용을-위한-준비사항)
4. [환경 변수 설정](#환경-변수-설정)
5. [Slack 앱 설정](#slack-앱-설정)
6. [테스트 방법](#테스트-방법)
7. [문제 해결](#문제-해결)

---

## 구현된 기능 목록

### ✅ 1. 이슈 슬랙 공유 기능
- **위치**: `backend/services/slack.service.js`, `backend/controllers/issues.controller.js`
- **프론트엔드**: `src/components/IssueDetailPanel.tsx`
- **기능**: 이슈 정보를 슬랙 채널로 공유
- **특징**:
  - 스크린샷 이미지 업로드 지원
  - Block Kit 형식의 메시지 포맷
  - Webhook 또는 Bot API 지원
  - 공유 로그 저장

### ✅ 2. 슬랙 공지사항 자동 수집 워커
- **위치**: `backend/workers/ingestion/slackNotice.worker.js`
- **기능**: 슬랙 채널의 공지사항을 자동으로 수집하여 이슈로 변환
- **특징**:
  - 주기적 자동 수집 (기본 10분)
  - 중복 방지 (slackMessageTs 기반)
  - 공지사항 필터링 (키워드/이모지 기반)
  - 메시지 링크 자동 생성

---

## 기능 상세 설명

### 1. 이슈 슬랙 공유 기능

#### 1.1 API 엔드포인트
```
POST /api/issues/:id/share
```

#### 1.2 요청 파라미터
```json
{
  "target": "Client_Channel" | "Internal_Channel",
  "customMessage": "사용자 지정 메시지 (선택)",
  "channel": "슬랙 채널 ID 또는 이름 (선택, Bot API 사용 시)"
}
```

#### 1.3 메시지 포맷
- **Block Kit 형식** 사용
- 포함 정보:
  - 이슈 제목 (중요도 표시)
  - 심각도, 분류, 담당자, 발생 시간
  - 상세 내용
  - 사용자 지정 메시지 (있는 경우)
  - 원문 링크
  - 스크린샷 이미지 (있는 경우)

#### 1.4 전송 방식
1. **Webhook 방식** (`SLACK_WEBHOOK_URL` 설정 시)
   - 텍스트 메시지만 전송 가능
   - 이미지 업로드 불가

2. **Bot API 방식** (`SLACK_BOT_TOKEN` 설정 시)
   - 텍스트 메시지 전송
   - 이미지 파일 업로드 지원 (`files.upload` API)
   - 스레드로 상세 메시지 전송

#### 1.5 공유 로그
- 모든 공유 시도는 `IssueShareLog` 테이블에 기록됨
- 성공/실패 상태, 메시지 스냅샷, 에러 메시지 저장

### 2. 슬랙 공지사항 자동 수집 워커

#### 2.1 수집 주기
- 기본: 10분마다 실행
- 환경 변수로 조정 가능: `SLACK_NOTICE_SCAN_INTERVAL_MS`

#### 2.2 수집 범위
- 최근 24시간 이내 메시지
- 최대 100개 메시지 처리

#### 2.3 필터링 조건
다음 조건을 만족하는 메시지만 수집:
- "공지" 키워드 포함
- 또는 공지 이모지 포함 (📢, 🔔, 📣)
- 봇 메시지 제외
- 이미 수집된 메시지 제외 (중복 방지)

#### 2.4 데이터 변환
슬랙 메시지 → `ReportItemIssue`:
- `source`: 'SLACK'
- `summary`: 메시지 첫 줄
- `detail`: 메시지 전체 본문
- `severity`: 3 (Info 레벨)
- `status`: 'OPEN'
- `importance`: 'MEDIUM'
- `slackMessageTs`: 메시지 타임스탬프 (중복 방지)
- `slackChannelId`: 채널 ID
- `sourceUrl`: 메시지 링크

#### 2.5 자동 카테고리 매칭
- "공지" 또는 "NOTICE" 카테고리 그룹 자동 찾기
- 매칭되는 카테고리가 있으면 자동 할당

---

## 실제 적용을 위한 준비사항

### 1. 필수 준비사항

#### 1.1 Slack 워크스페이스
- 슬랙 워크스페이스 접근 권한
- 공유할 채널 생성 또는 접근 권한
- 공지사항을 수집할 채널 접근 권한

#### 1.2 Slack 앱 생성
- Slack API 사이트에서 앱 생성 필요
- Bot Token 발급 필요
- 필요한 권한 설정 필요

#### 1.3 환경 변수 설정
- `.env` 파일에 필요한 환경 변수 추가
- 서버 재시작 필요

### 2. 선택적 준비사항

#### 2.1 Webhook URL (선택)
- Incoming Webhook 설정 (이미지 업로드 불가)
- 또는 Bot API만 사용 가능

#### 2.2 채널 설정
- 공유할 기본 채널 결정
- 공지사항 수집할 채널 결정

---

## 환경 변수 설정

### 필수 환경 변수

#### 이슈 공유 기능용
```env
# 방법 1: Webhook 사용 (이미지 업로드 불가)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# 방법 2: Bot API 사용 (이미지 업로드 가능, 권장)
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_CHANNEL=#general  # 기본 채널 (선택, 없으면 '#general' 사용)
```

#### 공지사항 수집 워커용
```env
# Bot Token (이슈 공유와 동일한 토큰 사용 가능)
SLACK_BOT_TOKEN=xoxb-your-bot-token-here

# 수집할 슬랙 채널 ID (필수)
SLACK_NOTICE_CHANNEL_ID=C1234567890

# 수집 주기 (선택, 기본값: 10분 = 600000ms)
SLACK_NOTICE_SCAN_INTERVAL_MS=600000
```

### 환경 변수 우선순위
1. **이슈 공유**: `SLACK_WEBHOOK_URL`이 있으면 Webhook 사용, 없으면 `SLACK_BOT_TOKEN` 사용
2. **Bot API 권장**: 이미지 업로드를 위해 `SLACK_BOT_TOKEN` 사용 권장

---

## Slack 앱 설정

### 1. Slack 앱 생성

1. [Slack API 사이트](https://api.slack.com/apps) 접속
2. "Create New App" 클릭
3. "From scratch" 선택
4. App 이름과 워크스페이스 선택
5. "Create App" 클릭

### 2. Bot Token Scopes 설정

**OAuth & Permissions** 메뉴로 이동하여 다음 권한 추가:

#### 이슈 공유 기능용 권한
- `chat:write` - 메시지 전송 (필수)
- `files:write` - 파일 업로드 (이미지 업로드용, 필수)
- `channels:read` - 채널 정보 읽기 (선택)

#### 공지사항 수집 워커용 권한
- `channels:history` - 채널 메시지 읽기 (필수)
- `channels:read` - 채널 정보 읽기 (필수)
- `chat:write` - 메시지 전송 (선택, 링크 생성용)

### 3. 워크스페이스에 설치

1. "OAuth & Permissions" 페이지에서
2. "Install to Workspace" 클릭
3. 권한 승인
4. **"Bot User OAuth Token"** (xoxb-로 시작) 복사
5. `.env` 파일의 `SLACK_BOT_TOKEN`에 설정

### 4. 채널에 봇 초대

#### 공유 기능용
- 메시지를 전송할 채널에 봇 초대
- 또는 채널 설정에서 봇 추가

#### 공지사항 수집용
- 메시지를 수집할 채널에 봇 초대
- 봇이 채널 멤버여야 `channels:history` 권한으로 메시지 읽기 가능

### 5. 채널 ID 확인 방법

1. Slack에서 해당 채널 열기
2. 채널 이름 클릭하여 채널 정보 보기
3. 하단 "About" 섹션에서 채널 ID 확인
   - 또는 채널 URL에서 확인: `https://workspace.slack.com/archives/C1234567890`
   - `C1234567890` 부분이 채널 ID

---

## 테스트 방법

### 1. 이슈 공유 기능 테스트

#### 1.1 환경 변수 확인
```bash
# .env 파일 확인
cat backend/.env | grep SLACK
```

#### 1.2 프론트엔드에서 테스트
1. 이슈 상세 패널 열기
2. "슬랙 공유" 버튼 클릭
3. 공유 대상 선택 (Client_Channel / Internal_Channel)
4. 사용자 지정 메시지 입력 (선택)
5. "공유" 버튼 클릭
6. 슬랙 채널에서 메시지 확인

#### 1.3 API 직접 테스트
```bash
curl -X POST http://localhost:8080/api/issues/{issueId}/share \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "target": "Client_Channel",
    "customMessage": "테스트 메시지"
  }'
```

#### 1.4 로그 확인
서버 로그에서 다음 메시지 확인:
- `Slack message sent via webhook` (Webhook 사용 시)
- `Slack message sent via Bot API` (Bot API 사용 시)
- `Slack message with screenshot sent via Bot API` (이미지 포함 시)

### 2. 공지사항 수집 워커 테스트

#### 2.1 환경 변수 확인
```bash
# .env 파일 확인
cat backend/.env | grep SLACK_NOTICE
```

#### 2.2 워커 시작 확인
서버 로그에서 다음 메시지 확인:
```
[SlackNoticeWorker] Starting...
[SlackNoticeWorker] Started { intervalMs: 600000, intervalMin: 10, channelId: 'C1234567890' }
```

#### 2.3 테스트 메시지 작성
1. 슬랙 채널에 테스트 메시지 작성
   - 예: "공지: 테스트 메시지"
   - 또는 공지 이모지 포함: "📢 테스트 메시지"
2. 워커 실행 대기 (최대 10분)
3. 시스템에서 이슈 생성 확인

#### 2.4 수집 확인
- 이슈 목록에서 `source: 'SLACK'` 필터링
- 이슈 상세에서 슬랙 메시지 정보 확인
- `slackMessageTs`, `slackChannelId` 필드 확인

#### 2.5 로그 확인
서버 로그에서 다음 메시지 확인:
```
[SlackNoticeWorker] Starting message collection { channelId: 'C1234567890' }
[SlackNoticeWorker] Fetched messages { count: 5, channelId: 'C1234567890' }
[SlackNoticeWorker] Issue created from Slack message { issueId: '...', slackMessageTs: '...' }
[SlackNoticeWorker] Collection completed { totalMessages: 5, processedCount: 2 }
```

---

## 문제 해결

### 1. 이슈 공유 기능 문제

#### 문제: 메시지가 전송되지 않음
**해결 방법:**
1. 환경 변수 확인
   - `SLACK_WEBHOOK_URL` 또는 `SLACK_BOT_TOKEN` 설정 확인
2. Slack 앱 권한 확인
   - `chat:write` 권한 있는지 확인
3. 봇이 채널에 초대되었는지 확인
4. 서버 로그에서 에러 메시지 확인

#### 문제: 이미지가 업로드되지 않음
**해결 방법:**
1. `SLACK_BOT_TOKEN` 사용 확인 (Webhook은 이미지 업로드 불가)
2. Slack 앱 권한 확인
   - `files:write` 권한 있는지 확인
3. 파일 경로 확인
   - `backend/uploads/screenshots/...` 경로에 파일 존재 확인
4. 파일 크기 확인 (Slack은 최대 1GB까지 지원)
5. 서버 로그 확인:
   - `Screenshot file not found` - 파일 없음
   - `Slack file upload failed` - 업로드 실패

#### 문제: "Slack Webhook URL or Bot Token is not configured" 에러
**해결 방법:**
- `.env` 파일에 `SLACK_WEBHOOK_URL` 또는 `SLACK_BOT_TOKEN` 설정
- 서버 재시작

### 2. 공지사항 수집 워커 문제

#### 문제: 워커가 시작되지 않음
**해결 방법:**
1. 환경 변수 확인
   ```bash
   # .env 파일 확인
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_NOTICE_CHANNEL_ID=C1234567890
   ```
2. 서버 로그 확인
   - `[SlackNoticeWorker] Configuration incomplete` 메시지 확인
3. 서버 재시작

#### 문제: 메시지가 수집되지 않음
**해결 방법:**
1. Bot Token 권한 확인
   - `channels:history` 권한 있는지 확인
2. 봇이 채널에 초대되었는지 확인
3. 메시지가 필터링 조건을 만족하는지 확인
   - "공지" 키워드 또는 공지 이모지 포함 여부
4. 메시지가 최근 24시간 이내인지 확인
5. 서버 로그에서 에러 메시지 확인

#### 문제: 중복 수집 발생
**해결 방법:**
- `slackMessageTs`가 unique constraint로 설정되어 있어 중복 방지됨
- 중복이 발생한다면 데이터베이스 스키마 확인
- Prisma 마이그레이션 실행 확인

### 3. 일반적인 문제

#### 문제: "invalid_auth" 에러
**해결 방법:**
- Bot Token이 올바른지 확인
- 토큰이 만료되지 않았는지 확인
- 워크스페이스에 앱이 제대로 설치되었는지 확인

#### 문제: "channel_not_found" 에러
**해결 방법:**
- 채널 ID가 올바른지 확인
- 봇이 해당 채널에 초대되었는지 확인
- 채널이 존재하는지 확인

#### 문제: "missing_scope" 에러
**해결 방법:**
- Slack 앱에 필요한 권한이 추가되었는지 확인
- 워크스페이스에 앱을 재설치 (권한 추가 후)

---

## 추가 참고 자료

- [Slack API 문서](https://api.slack.com/)
- [Slack Block Kit](https://api.slack.com/block-kit)
- [backend/SLACK_NOTICE_WORKER_SETUP.md](./backend/SLACK_NOTICE_WORKER_SETUP.md)
- [backend/SLACK_IMAGE_UPLOAD_CHECKLIST.md](./backend/SLACK_IMAGE_UPLOAD_CHECKLIST.md)

---

## 요약 체크리스트

### 이슈 공유 기능 활성화
- [ ] Slack 앱 생성 및 Bot Token 발급
- [ ] `chat:write`, `files:write` 권한 추가
- [ ] 워크스페이스에 앱 설치
- [ ] 공유할 채널에 봇 초대
- [ ] `.env`에 `SLACK_BOT_TOKEN` 설정
- [ ] 서버 재시작
- [ ] 테스트 메시지 전송

### 공지사항 수집 워커 활성화
- [ ] Slack 앱 생성 및 Bot Token 발급 (공유 기능과 동일 사용 가능)
- [ ] `channels:history`, `channels:read` 권한 추가
- [ ] 워크스페이스에 앱 설치
- [ ] 수집할 채널에 봇 초대
- [ ] 채널 ID 확인
- [ ] `.env`에 `SLACK_BOT_TOKEN`, `SLACK_NOTICE_CHANNEL_ID` 설정
- [ ] 서버 재시작
- [ ] 테스트 메시지 작성 및 수집 확인










