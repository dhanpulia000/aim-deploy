# Slack 공지사항 수집 워커 설정 가이드

## 개요

고객사 슬랙 채널의 중요한 메시지를 자동으로 수집하여 시스템의 공지사항으로 저장하는 워커입니다.

## 환경 변수 설정

`.env` 파일에 다음 환경 변수를 추가하세요:

```env
# Slack Bot Token (필수)
SLACK_BOT_TOKEN=xoxb-your-bot-token-here

# 수집할 슬랙 채널 ID (필수)
SLACK_NOTICE_CHANNEL_ID=C1234567890

# 특정 작성자만 공지로 인정할 경우, 해당 Slack user ID들을 쉼표로 구분 (선택)
SLACK_NOTICE_USER_IDS=U1234567890,U0987654321

# 작성자 ID와 이름 매핑 (선택, API 조회 실패 시 사용)
# 형식 1: 쉼표로 구분된 key:value 쌍
SLACK_NOTICE_USER_NAMES=U1234567890:홍길동,U0987654321:김철수
# 형식 2: JSON 형식
SLACK_NOTICE_USER_NAMES={"U1234567890":"홍길동","U0987654321":"김철수"}

# 수집 주기 (선택, 기본값: 10분)
SLACK_NOTICE_SCAN_INTERVAL_MS=600000
```

## Slack Bot Token 발급 방법

1. [Slack API 사이트](https://api.slack.com/apps)에 접속
2. "Create New App" 클릭
3. "From scratch" 선택
4. App 이름과 워크스페이스 선택
5. "OAuth & Permissions" 메뉴로 이동
6. "Bot Token Scopes"에 다음 권한 추가:
   - `channels:history` - 채널 메시지 읽기
   - `channels:read` - 채널 정보 읽기
   - `chat:write` - 메시지 전송 (선택)
7. "Install to Workspace" 클릭하여 워크스페이스에 설치
8. "Bot User OAuth Token" (xoxb-로 시작)을 복사하여 `SLACK_BOT_TOKEN`에 설정

## 채널 ID 확인 방법

1. Slack에서 해당 채널 열기
2. 채널 정보 보기 (채널 이름 클릭)
3. 하단의 "About" 섹션에서 채널 ID 확인
   - 또는 채널 URL에서 확인: `https://workspace.slack.com/archives/C1234567890`
   - `C1234567890` 부분이 채널 ID입니다

## 필터링 로직

워커는 다음 조건을 만족하는 메시지만 수집합니다:

1. **중복 방지**: 이미 수집된 메시지(`slackMessageTs`)는 건너뜀
2. **작성자 필터** (선택 사항):
   - `SLACK_NOTICE_USER_IDS`가 설정된 경우: 해당 ID 목록에 포함된 작성자의 메시지만 수집
   - 설정이 없으면 모든 작성자의 메시지 처리
3. **공지사항 필터** (선택 사항):
   - `SLACK_NOTICE_USER_IDS`가 설정되지 않은 경우에만 적용
   - 메시지에 "공지" 키워드가 포함된 경우
   - 또는 공지 이모지(📢, 🔔, 📣)가 포함된 경우

## 작성자 이름 매핑

`SLACK_NOTICE_USER_NAMES` 환경 변수를 설정하면 작성자 ID와 이름을 미리 매핑할 수 있습니다.

**장점:**
- Slack API 조회 실패 시에도 이름 사용 가능
- API 호출 없이 즉시 이름 사용 (성능 향상)
- 작성자명 조회 실패 시 ID 대신 매핑된 이름 사용

**설정 예시:**
```env
# 형식 1: 쉼표로 구분된 key:value 쌍
SLACK_NOTICE_USER_NAMES=U1234567890:홍길동,U0987654321:김철수

# 형식 2: JSON 형식 (여러 줄로 작성 가능)
SLACK_NOTICE_USER_NAMES={"U1234567890":"홍길동","U0987654321":"김철수"}
```

**이름 조회 우선순위:**
1. 캐시에 저장된 이름 (이전 조회 결과)
2. 환경 변수에 설정된 매핑 (`SLACK_NOTICE_USER_NAMES`)
3. Slack API로 조회 (`users.info`)
4. 모두 실패 시 "알 수 없음" 사용 (ID는 사용하지 않음)

## 수집된 데이터 구조

수집된 메시지는 `ReportItemIssue`로 저장되며:

- `source`: 'SLACK'
- `summary`: 메시지의 첫 줄
- `detail`: 메시지 전체 본문
- `severity`: 3 (Info 레벨)
- `status`: 'OPEN'
- `importance`: 'MEDIUM'
- `slackMessageTs`: 메시지 타임스탬프 (중복 방지용)
- `slackChannelId`: 수집된 채널 ID
- `sourceUrl`: 메시지 링크 (있는 경우)

## 워커 동작

1. **시작 시**: 즉시 한 번 수집 실행
2. **주기적 수집**: 설정된 주기(기본 10분)마다 최근 24시간 이내 메시지 조회
3. **자동 재시작**: 에러로 종료된 경우 자동 재시작

## 로그 확인

워커 로그는 서버 로그에 포함됩니다:

```
[SlackNoticeWorker] Starting...
[SlackNoticeWorker] Fetched messages { count: 5, channelId: 'C1234567890' }
[SlackNoticeWorker] Issue created from Slack message { issueId: '...', slackMessageTs: '...' }
[SlackNoticeWorker] Collection completed { totalMessages: 5, processedCount: 2 }
```

## 문제 해결

### 워커가 시작되지 않는 경우
- `SLACK_BOT_TOKEN`과 `SLACK_NOTICE_CHANNEL_ID`가 설정되어 있는지 확인
- 서버 로그에서 "[SlackNoticeWorker] Configuration incomplete" 메시지 확인

### 메시지가 수집되지 않는 경우
1. Bot Token에 `channels:history` 권한이 있는지 확인
2. Bot이 해당 채널에 초대되어 있는지 확인
3. 메시지가 공지사항 필터 조건을 만족하는지 확인
4. 로그에서 에러 메시지 확인

### 중복 수집이 발생하는 경우
- `slackMessageTs`가 unique constraint로 설정되어 있어 중복은 방지됩니다
- 만약 중복이 발생한다면 데이터베이스 스키마가 제대로 업데이트되지 않은 것일 수 있습니다

## 테스트

1. 슬랙 채널에 테스트 메시지 작성 (예: "공지: 테스트 메시지")
2. 워커가 실행될 때까지 대기 (최대 10분)
3. 시스템에서 해당 이슈가 생성되었는지 확인
4. 이슈 상세에서 `source: 'SLACK'`인지 확인






