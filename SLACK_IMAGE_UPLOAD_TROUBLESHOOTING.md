# 슬랙 이미지 업로드 실패 원인 분석

## 현재 상황
- ✅ 슬랙 메시지는 정상적으로 전송됨 (텍스트 메시지)
- ✅ 원문 링크는 포함됨
- ❌ 캡처 이미지는 업로드되지 않음

## 가능한 원인 및 확인 방법

### 1. 서버 로그 확인 (가장 중요)

슬랙 공유 시도 후 서버 로그에서 다음을 확인하세요:

#### 성공 케이스
```
[SlackService] shareIssue called { hasScreenshot: true, screenshotPath: 'screenshots/...' }
[SlackService] sendViaBotAPI called { hasScreenshot: true, ... }
[SlackService] Checking screenshot file { exists: true }
[SlackService] Screenshot file found, proceeding with upload
[SlackService] Uploading file to Slack
[SlackService] File upload response { ok: true, fileId: 'F...' }
[SlackService] File uploaded successfully
```

#### 실패 케이스별 확인

**케이스 1: 파일이 없는 경우**
```
[SlackService] Checking screenshot file { exists: false }
Screenshot file not found, sending text message only
```
→ **원인**: 파일 경로가 잘못되었거나 파일이 삭제됨
→ **해결**: 파일 경로 확인 및 파일 존재 여부 확인

**케이스 2: 파일 업로드 실패**
```
[SlackService] File upload response { ok: false, error: '...' }
[SlackService] Slack file upload failed { error: '...', ... }
```
→ **원인**: Slack API 에러 (아래 에러별 해결 방법 참고)

**케이스 3: screenshotPath가 없는 경우**
```
[SlackService] shareIssue called { hasScreenshot: false }
[SlackService] sendViaBotAPI called { hasScreenshot: false }
```
→ **원인**: 이슈에 screenshotPath가 저장되지 않음
→ **해결**: 스크린샷 캡처 후 공유

### 2. Slack API 에러별 원인 및 해결

#### `channel_not_found` 또는 `not_in_channel`
**원인:**
- 채널 ID가 잘못됨
- 봇이 해당 채널에 초대되지 않음

**해결:**
1. 슬랙 채널 목록에서 올바른 채널 ID 선택 확인
2. 슬랙에서 해당 채널에 봇 초대:
   - 채널에서 `/invite @봇이름` 또는
   - 채널 설정 → 통합 → 앱 추가

#### `missing_scope`
**원인:**
- Slack 앱에 `files:write` 권한이 없음

**해결:**
1. [Slack API 사이트](https://api.slack.com/apps) 접속
2. 앱 선택 → OAuth & Permissions
3. Bot Token Scopes에 `files:write` 추가
4. **중요**: "Install to Workspace" 다시 클릭하여 재설치
5. 새로운 Bot Token 복사하여 `.env`에 업데이트

#### `invalid_auth`
**원인:**
- Bot Token이 잘못되었거나 만료됨

**해결:**
1. `.env` 파일의 `SLACK_BOT_TOKEN` 확인
2. Slack API 사이트에서 새로운 Bot Token 발급
3. 서버 재시작

#### `file_too_large`
**원인:**
- 이미지 파일이 너무 큼 (Slack은 최대 1GB까지 지원하지만 권장은 더 작음)

**해결:**
- 이미지 파일 크기 확인
- 필요시 이미지 압축

#### 기타 에러
**확인 사항:**
- 서버 로그의 `error`, `warning`, `needed`, `provided` 필드 확인
- Slack API 문서 참고: https://api.slack.com/methods/files.upload

### 3. 파일 경로 문제

**확인 방법:**
1. 서버 로그에서 `fullPath` 확인
2. 실제 파일 존재 여부 확인:
   ```bash
   # Windows PowerShell
   Test-Path "backend\uploads\screenshots\2025-11-28\issue_XXX.png"
   ```

**일반적인 경로 형식:**
- DB 저장: `screenshots/2025-11-28/issue_XXX.png`
- 실제 파일: `backend/uploads/screenshots/2025-11-28/issue_XXX.png`

### 4. 채널 ID 형식 문제

**확인 사항:**
- 채널 목록에서 선택한 값이 채널 ID (C1234567890)인지 확인
- 채널 이름 (#general)이 아닌 채널 ID를 사용해야 함

**확인 방법:**
- 서버 로그에서 `channel`, `channelId` 값 확인
- 채널 ID는 `C`로 시작하는 긴 문자열

### 5. 환경 변수 확인

**필수 환경 변수:**
```env
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
```

**확인 방법:**
```bash
# .env 파일 확인
cat backend/.env | grep SLACK_BOT_TOKEN
```

**주의:**
- `SLACK_WEBHOOK_URL`만 설정되어 있으면 이미지 업로드 불가
- Bot Token이 설정되어 있어야 이미지 업로드 가능

### 6. 코드 흐름 확인

**정상 흐름:**
1. `shareIssue` 호출 → `screenshotPath` 확인
2. `sendViaBotAPI` 호출 → 파일 존재 확인
3. `files.upload` API 호출 → 파일 업로드
4. 업로드 성공 → 스레드 메시지 전송

**문제 발생 지점:**
- 각 단계에서 로그 확인
- 어느 단계에서 실패하는지 파악

## 디버깅 체크리스트

슬랙 공유 시도 후 다음을 확인하세요:

- [ ] 서버 로그에서 `[SlackService] shareIssue called` 확인
  - `hasScreenshot: true`인지 확인
  - `screenshotPath` 값 확인

- [ ] 서버 로그에서 `[SlackService] Checking screenshot file` 확인
  - `exists: true`인지 확인
  - `fullPath` 값 확인

- [ ] 서버 로그에서 `[SlackService] File upload response` 확인
  - `ok: true`인지 확인
  - `error` 필드가 있는지 확인

- [ ] Slack 앱 권한 확인
  - `files:write` 권한 있는지 확인
  - 권한 추가 후 재설치했는지 확인

- [ ] 봇이 채널에 초대되었는지 확인
  - 슬랙 채널에서 봇 멤버 확인

- [ ] 채널 ID 형식 확인
  - 채널 ID (C1234567890)인지 확인
  - 채널 이름 (#general)이 아닌지 확인

## 즉시 확인할 수 있는 방법

1. **서버 로그 확인**
   - 슬랙 공유 시도 직후 서버 로그 확인
   - `[SlackService]`로 시작하는 모든 로그 확인
   - 특히 `error` 필드가 있는 로그 확인

2. **파일 존재 확인**
   - 서버 로그의 `fullPath` 값 확인
   - 해당 경로에 파일이 실제로 존재하는지 확인

3. **Slack 앱 권한 확인**
   - Slack API 사이트에서 앱 권한 확인
   - `files:write` 권한이 있는지 확인

## 예상되는 가장 가능성 높은 원인

1. **Slack 앱 권한 문제** (가장 가능성 높음)
   - `files:write` 권한이 없거나
   - 권한 추가 후 재설치하지 않음

2. **봇이 채널에 초대되지 않음**
   - 채널에 봇이 멤버로 추가되지 않음

3. **채널 ID 형식 문제**
   - 채널 이름을 채널 ID로 사용

4. **파일 경로 문제**
   - 파일이 실제로 존재하지 않음

## 다음 단계

서버 로그를 확인하여 위의 어떤 케이스에 해당하는지 파악한 후, 해당 원인에 대한 해결 방법을 적용하세요.

특히 다음 로그를 확인하세요:
- `[SlackService] File upload response { ok: false, error: '...' }`
- 이 로그의 `error` 필드가 정확한 원인을 알려줍니다.









