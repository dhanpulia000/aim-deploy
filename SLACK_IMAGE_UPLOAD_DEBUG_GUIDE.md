# 슬랙 이미지 업로드 실패 원인 디버깅 가이드

## 🔍 체계적인 원인 확인 방법

### 1단계: 서버 로그 확인 (가장 중요)

슬랙 공유 시도 후 서버 로그에서 다음 순서로 확인하세요:

#### ✅ 정상 흐름 로그
```
[SlackService] shareIssue called { hasScreenshot: true, screenshotPath: 'screenshots/...' }
[SlackService] sendViaBotAPI called { hasScreenshot: true, ... }
[SlackService] Checking screenshot file { exists: true }
[SlackService] Screenshot file found, proceeding with upload
[SlackService] Uploading file to Slack
[SlackService] Form data prepared { channelId: 'C...', fileSize: ... }
[SlackService] File upload response { ok: true, fileId: 'F...' }
[SlackService] File uploaded successfully
```

#### ❌ 문제 발생 시 확인할 로그

**케이스 1: screenshotPath가 없는 경우**
```
[SlackService] shareIssue called { hasScreenshot: false, screenshotPath: null }
```
→ **원인**: 이슈에 스크린샷이 캡처되지 않음
→ **해결**: 먼저 스크린샷 캡처 버튼으로 캡처

**케이스 2: 파일이 존재하지 않는 경우**
```
[SlackService] Checking screenshot file { exists: false }
Screenshot file not found, sending text message only
```
→ **원인**: DB에는 경로가 있지만 실제 파일이 없음
→ **해결**: 
  - 파일 경로 확인: `backend/uploads/screenshots/YYYY-MM-DD/issue_XXX.png`
  - 파일이 삭제되었는지 확인
  - 스크린샷을 다시 캡처

**케이스 3: 파일 업로드 실패**
```
[SlackService] File upload response { ok: false, error: '...' }
[SlackService] Slack file upload failed - DETAILED ERROR { ... }
```
→ **원인**: Slack API 에러 (아래 에러별 해결 방법 참고)

### 2단계: 에러 코드별 원인 및 해결

#### `channel_not_found` 또는 `not_in_channel`
**원인:**
- 채널 ID가 잘못됨
- 봇이 해당 채널에 초대되지 않음

**확인 방법:**
1. 서버 로그의 `channelId` 값 확인
2. 슬랙에서 해당 채널 ID 확인:
   - 채널 정보 → About → Channel ID
   - 또는 URL에서 확인: `https://workspace.slack.com/archives/C1234567890`

**해결:**
1. 슬랙 채널에서 봇 초대: `/invite @봇이름`
2. 또는 채널 설정 → 통합 → 앱 추가

#### `missing_scope`
**원인:**
- Slack 앱에 `files:write` 권한이 없음

**확인 방법:**
- 서버 로그의 `needed` 필드 확인
- 예: `needed: 'files:write'`

**해결:**
1. [Slack API 사이트](https://api.slack.com/apps) 접속
2. 앱 선택 → OAuth & Permissions
3. Bot Token Scopes에 `files:write` 추가
4. **중요**: "Install to Workspace" 다시 클릭 (재설치 필수!)
5. 새로운 Bot Token 복사하여 `.env`에 업데이트
6. 서버 재시작

#### `invalid_auth`
**원인:**
- Bot Token이 잘못되었거나 만료됨

**확인 방법:**
- 서버 로그의 `botTokenPrefix` 확인
- Bot Token이 `xoxb-`로 시작하는지 확인

**해결:**
1. `.env` 파일의 `SLACK_BOT_TOKEN` 확인
2. Slack API 사이트에서 새로운 Bot Token 발급
3. 서버 재시작

#### `file_too_large`
**원인:**
- 이미지 파일이 너무 큼

**확인 방법:**
- 서버 로그의 `fileSize` 확인
- Slack은 최대 1GB까지 지원하지만 권장은 더 작음

**해결:**
- 이미지 파일 크기 확인
- 필요시 이미지 압축

#### `invalid_arguments`
**원인:**
- API 호출 파라미터가 잘못됨

**확인 방법:**
- 서버 로그의 `provided` 필드 확인
- 채널 ID 형식 확인

**해결:**
- 채널 ID가 `C`로 시작하는지 확인
- 채널 이름(`#general`)이 아닌 채널 ID 사용

### 3단계: 파일 경로 확인

**확인 방법:**
1. 서버 로그의 `fullPath` 값 확인
2. 실제 파일 존재 여부 확인:
   ```powershell
   # Windows PowerShell
   Test-Path "backend\uploads\screenshots\2025-11-28\issue_XXX.png"
   ```

**일반적인 경로 형식:**
- DB 저장: `screenshots/2025-11-28/issue_XXX.png`
- 실제 파일: `backend/uploads/screenshots/2025-11-28/issue_XXX.png`

**경로 문제 해결:**
- 상대 경로가 올바른지 확인
- `backend/uploads` 디렉토리가 존재하는지 확인
- 파일 권한 확인

### 4단계: 환경 변수 확인

**필수 환경 변수:**
```env
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
```

**확인 방법:**
```powershell
# .env 파일 확인
Get-Content backend\.env | Select-String "SLACK_BOT_TOKEN"
```

**주의:**
- `SLACK_WEBHOOK_URL`만 설정되어 있으면 이미지 업로드 불가
- Bot Token이 설정되어 있어야 이미지 업로드 가능

### 5단계: Slack 앱 권한 확인

**필수 권한:**
- `files:write` - 파일 업로드 권한
- `chat:write` - 메시지 전송 권한

**확인 방법:**
1. [Slack API 사이트](https://api.slack.com/apps) 접속
2. 앱 선택 → OAuth & Permissions
3. Bot Token Scopes 확인

**권한 추가 후:**
1. "Install to Workspace" 다시 클릭 (재설치 필수!)
2. 새로운 Bot Token 복사
3. `.env` 파일 업데이트
4. 서버 재시작

### 6단계: 채널 ID 형식 확인

**올바른 형식:**
- 채널 ID: `C1234567890` (C로 시작하는 긴 문자열)
- 채널 이름: `#general` (사용 불가)

**확인 방법:**
- 서버 로그의 `channel`, `channelId` 값 확인
- 슬랙 채널 목록에서 선택한 값이 채널 ID인지 확인

**해결:**
- 채널 목록 API가 올바른 채널 ID를 반환하는지 확인
- 프론트엔드에서 채널 ID를 올바르게 전달하는지 확인

## 📋 디버깅 체크리스트

슬랙 공유 시도 후 다음을 순서대로 확인하세요:

- [ ] **서버 로그 확인**
  - `[SlackService] shareIssue called` → `hasScreenshot: true`인지 확인
  - `[SlackService] Checking screenshot file` → `exists: true`인지 확인
  - `[SlackService] File upload response` → `ok: true`인지 확인

- [ ] **screenshotPath 확인**
  - 이슈에 `screenshotPath`가 저장되어 있는지 확인
  - DB에서 직접 확인: `SELECT screenshotPath FROM ReportItemIssue WHERE id = '...'`

- [ ] **파일 존재 확인**
  - 서버 로그의 `fullPath` 값 확인
  - 해당 경로에 파일이 실제로 존재하는지 확인

- [ ] **Slack 앱 권한 확인**
  - `files:write` 권한 있는지 확인
  - 권한 추가 후 재설치했는지 확인

- [ ] **봇이 채널에 초대되었는지 확인**
  - 슬랙 채널에서 봇 멤버 확인
  - 없으면 `/invite @봇이름` 실행

- [ ] **채널 ID 형식 확인**
  - 채널 ID (C1234567890)인지 확인
  - 채널 이름 (#general)이 아닌지 확인

- [ ] **Bot Token 확인**
  - `.env` 파일에 `SLACK_BOT_TOKEN` 설정되어 있는지 확인
  - Bot Token이 `xoxb-`로 시작하는지 확인

## 🚨 즉시 확인할 수 있는 방법

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

## 💡 예상되는 가장 가능성 높은 원인

1. **Slack 앱 권한 문제** (가장 가능성 높음)
   - `files:write` 권한이 없거나
   - 권한 추가 후 재설치하지 않음

2. **봇이 채널에 초대되지 않음**
   - 채널에 봇이 멤버로 추가되지 않음

3. **채널 ID 형식 문제**
   - 채널 이름을 채널 ID로 사용

4. **파일 경로 문제**
   - 파일이 실제로 존재하지 않음

## 📝 다음 단계

서버 로그를 확인하여 위의 어떤 케이스에 해당하는지 파악한 후, 해당 원인에 대한 해결 방법을 적용하세요.

특히 다음 로그를 확인하세요:
- `[SlackService] File upload response { ok: false, error: '...' }`
- 이 로그의 `error` 필드가 정확한 원인을 알려줍니다.









