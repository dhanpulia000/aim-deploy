# 슬랙 캡처 이미지 전송 로직 상세 정리

## 📋 목차
1. [전체 흐름 개요](#전체-흐름-개요)
2. [단계별 상세 로직](#단계별-상세-로직)
3. [파일 경로 구조](#파일-경로-구조)
4. [Slack API 호출 상세](#slack-api-호출-상세)
5. [에러 처리](#에러-처리)
6. [로그 포인트](#로그-포인트)

---

## 전체 흐름 개요

```
[프론트엔드] 슬랙 공유 버튼 클릭
    ↓
[백엔드] POST /api/issues/:id/share
    ↓
[Controller] 이슈 정보 조회 (screenshotPath 포함)
    ↓
[SlackService] shareIssue() 호출
    ↓
[SlackService] Bot Token 확인 → sendViaBotAPI() 호출
    ↓
[SlackService] screenshotPath 확인 및 파일 존재 검증
    ↓
[SlackService] FormData 생성 및 파일 준비
    ↓
[Slack API] files.upload API 호출
    ↓
[SlackService] fileTs 추출 및 스레드 메시지 전송
    ↓
[Controller] 공유 로그 저장
    ↓
[프론트엔드] 성공 응답 수신
```

---

## 단계별 상세 로직

### 1단계: 프론트엔드에서 슬랙 공유 요청

**위치**: `src/components/IssueDetailPanel.tsx`

```typescript
const handleShareToSlack = async () => {
  const res = await fetch(`/api/issues/${ticket.issueId}/share`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      target: shareTarget,
      customMessage: shareMessage.trim() || undefined,
      channel: selectedChannel || undefined,
      shareForm: shareForm // 구조화된 폼 데이터
    })
  });
}
```

**전송 데이터:**
- `target`: 공유 대상 ('Client_Channel', 'Internal_Channel')
- `customMessage`: 사용자 지정 메시지 (선택)
- `channel`: Slack 채널 ID (선택, Bot API 사용 시)
- `shareForm`: 구조화된 폼 데이터 (보내는 사람, 받는 사람, 날짜, 시간, 제목, 내용 등)

---

### 2단계: 백엔드 Controller에서 이슈 정보 조회

**위치**: `backend/controllers/issues.controller.js`

```javascript
// 1. 이슈 정보 조회 (screenshotPath 포함)
const issue = await prisma.reportItemIssue.findUnique({
  where: { id: issueId },
  include: {
    categoryGroup: true,
    category: true,
    assignedAgent: true
  },
  // screenshotPath는 기본 필드이므로 자동으로 포함됨
});

// 2. 디버깅 로그
logger.info('Sharing issue to Slack', {
  issueId,
  screenshotPath: issue.screenshotPath,
  hasScreenshot: !!issue.screenshotPath,
  channel
});

// 3. SlackService 호출
shareResult = await slackService.shareIssue(issue, {
  target: target || 'Client_Channel',
  customMessage,
  channel,
  shareForm: req.body.shareForm
});
```

**중요 포인트:**
- `screenshotPath`는 DB의 `ReportItemIssue` 테이블에 저장된 상대 경로
- 형식: `screenshots/YYYY-MM-DD/issue_{issueId}.png`
- 예: `screenshots/2025-11-28/issue_clx1234567890.png`

---

### 3단계: SlackService.shareIssue() - 메시지 포맷팅 및 경로 추출

**위치**: `backend/services/slack.service.js`

```javascript
async shareIssue(issue, options = {}) {
  const { target, customMessage, channel, shareForm } = options;
  
  // 1. 메시지 포맷팅
  const message = this.formatIssueMessage(issue, { customMessage, shareForm });
  
  // 2. 스크린샷 경로 가져오기
  const screenshotPath = issue.screenshotPath || null;
  
  // 3. 디버깅 로그
  logger.info('[SlackService] shareIssue called', {
    hasScreenshot: !!screenshotPath,
    screenshotPath,
    channel,
    hasWebhook: !!this.getWebhookUrl(),
    hasBotToken: !!this.getBotToken(),
    issueId: issue.id
  });
  
  // 4. Bot Token 확인 (이미지 업로드를 위해 필수)
  const botToken = this.getBotToken();
  if (botToken) {
    const targetChannel = channel || process.env.SLACK_CHANNEL || '#general';
    return await this.sendViaBotAPI(message, targetChannel, botToken, screenshotPath);
  }
  
  // 5. Webhook 사용 시 (이미지 업로드 불가)
  const webhookUrl = this.getWebhookUrl();
  if (webhookUrl) {
    logger.warn('Screenshot available but webhook does not support file upload');
    return await this.sendViaWebhook(message, webhookUrl);
  }
}
```

**중요 포인트:**
- `screenshotPath`가 `null`이면 이미지 없이 텍스트 메시지만 전송
- Bot Token이 있으면 `sendViaBotAPI()` 호출 (이미지 업로드 가능)
- Webhook만 있으면 이미지 업로드 불가 (텍스트 메시지만)

---

### 4단계: SlackService.sendViaBotAPI() - 파일 업로드 처리

**위치**: `backend/services/slack.service.js`

#### 4-1. screenshotPath 확인 및 파일 존재 검증

```javascript
async sendViaBotAPI(message, channel, botToken, screenshotPath = null) {
  // 이미지가 있으면 파일 업로드 API 사용
  if (screenshotPath) {
    // 상대 경로를 절대 경로로 변환
    const fullPath = path.join(__dirname, '../uploads', screenshotPath);
    // 예: backend/uploads/screenshots/2025-11-28/issue_clx1234567890.png
    
    // 파일 존재 확인
    if (!fs.existsSync(fullPath)) {
      logger.warn('Screenshot file not found, sending text message only');
      return await this.sendViaBotAPITextOnly(message, channel, botToken);
    }
  }
}
```

**경로 변환:**
- DB 저장 경로: `screenshots/2025-11-28/issue_clx1234567890.png`
- 실제 파일 경로: `backend/uploads/screenshots/2025-11-28/issue_clx1234567890.png`

#### 4-2. FormData 생성 및 파일 준비

```javascript
// FormData를 사용하여 파일 업로드
const FormData = require('form-data');
const form = new FormData();

// 채널 ID 정규화 (# 제거)
let channelId = channel;
if (channel && channel.startsWith('#')) {
  channelId = channel.substring(1); // # 제거
}

// 파일 추가
form.append('file', fs.createReadStream(fullPath));
form.append('channels', channelId); // 채널 ID 사용 (예: C1234567890)

// initial_comment에 간단한 메시지 포함
const initialComment = message.text || 
                      (message.blocks && message.blocks[0]?.text?.text) || 
                      '이슈 공유';
form.append('initial_comment', initialComment);
form.append('filename', path.basename(fullPath));
```

**FormData 필드:**
- `file`: 파일 스트림 (fs.createReadStream)
- `channels`: 채널 ID (C로 시작하는 문자열)
- `initial_comment`: 파일과 함께 표시될 초기 댓글
- `filename`: 파일명

#### 4-3. Slack API files.upload 호출

```javascript
const uploadResponse = await axios.post('https://slack.com/api/files.upload', form, {
  headers: {
    'Authorization': `Bearer ${botToken}`,
    ...form.getHeaders() // Content-Type: multipart/form-data; boundary=...
  },
  timeout: 30000, // 30초 타임아웃
  maxContentLength: Infinity,
  maxBodyLength: Infinity
});
```

**API 엔드포인트:**
- URL: `https://slack.com/api/files.upload`
- Method: POST
- Content-Type: `multipart/form-data`
- Authorization: `Bearer {botToken}`

**요청 헤더:**
```
Authorization: Bearer xoxb-...
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...
```

#### 4-4. 업로드 응답 처리

```javascript
if (uploadResponse.data.ok) {
  const fileInfo = uploadResponse.data.file;
  
  // fileTs 추출 (스레드 메시지 전송용)
  const fileTs = fileInfo?.shares?.public?.[channelId]?.[0]?.ts || 
                fileInfo?.shares?.private?.[channelId]?.[0]?.ts;
  
  // 스레드로 상세 메시지 전송
  if (fileTs) {
    await axios.post('https://slack.com/api/chat.postMessage', {
      channel: channelId,
      thread_ts: fileTs,
      text: message.text,
      blocks: message.blocks,
      attachments: message.attachments
    });
  }
}
```

**응답 구조:**
```json
{
  "ok": true,
  "file": {
    "id": "F1234567890",
    "name": "issue_clx1234567890.png",
    "size": 123456,
    "shares": {
      "public": {
        "C1234567890": [
          {
            "ts": "1234567890.123456"
          }
        ]
      }
    }
  }
}
```

**중요 포인트:**
- `file.shares.public[channelId][0].ts` 또는 `file.shares.private[channelId][0].ts`에서 `fileTs` 추출
- `fileTs`를 사용하여 스레드로 상세 메시지 전송
- `fileTs`가 없으면 파일만 업로드되고 스레드 메시지는 전송되지 않음

---

## 파일 경로 구조

### 스크린샷 저장 경로

**DB 저장 경로 (상대 경로):**
```
screenshots/YYYY-MM-DD/issue_{issueId}.png
```

**실제 파일 경로 (절대 경로):**
```
backend/uploads/screenshots/YYYY-MM-DD/issue_{issueId}.png
```

**경로 생성 로직:**
```javascript
// backend/utils/fileUtils.js
function generateScreenshotPath(articleId) {
  const today = new Date();
  const dateFolder = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const fileName = `issue_${articleId}.png`;
  const relativePath = `screenshots/${dateFolder}/${fileName}`;
  const fullPath = path.join(backendDir, 'uploads', 'screenshots', dateFolder, fileName);
  
  return { fullPath, relativePath, fileName, dateFolder, uploadsDir };
}
```

**예시:**
- DB: `screenshots/2025-11-28/issue_clx1234567890.png`
- 파일: `C:\Users\...\WallboardV2\backend\uploads\screenshots\2025-11-28\issue_clx1234567890.png`

---

## Slack API 호출 상세

### files.upload API

**엔드포인트:**
```
POST https://slack.com/api/files.upload
```

**요청 형식:**
```
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="file"; filename="issue_clx1234567890.png"
Content-Type: image/png

[파일 바이너리 데이터]
--boundary
Content-Disposition: form-data; name="channels"

C1234567890
--boundary
Content-Disposition: form-data; name="initial_comment"

이슈 공유
--boundary
Content-Disposition: form-data; name="filename"

issue_clx1234567890.png
--boundary--
```

**필수 파라미터:**
- `file`: 업로드할 파일 (이미지)
- `channels`: 파일을 공유할 채널 ID (C로 시작)

**선택 파라미터:**
- `initial_comment`: 파일과 함께 표시될 초기 댓글
- `filename`: 파일명

**필수 권한:**
- `files:write`: 파일 업로드 권한
- `chat:write`: 메시지 전송 권한 (스레드 메시지용)

### chat.postMessage API (스레드 메시지)

**엔드포인트:**
```
POST https://slack.com/api/chat.postMessage
```

**요청 본문:**
```json
{
  "channel": "C1234567890",
  "thread_ts": "1234567890.123456",
  "text": "이슈 공유",
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "제목"
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": "*보내는 사람:*\n홍길동"
        }
      ]
    }
  ]
}
```

**중요 포인트:**
- `thread_ts`: 파일 업로드 응답에서 받은 `fileTs` 사용
- `blocks`: 구조화된 메시지 (Block Kit 형식)

---

## 에러 처리

### 파일이 없는 경우

```javascript
if (!fs.existsSync(fullPath)) {
  logger.warn('Screenshot file not found, sending text message only');
  return await this.sendViaBotAPITextOnly(message, channel, botToken);
}
```

**처리:**
- 텍스트 메시지만 전송
- 에러를 throw하지 않고 정상 처리

### 파일 업로드 실패

```javascript
if (!uploadResponse.data.ok) {
  const errorDetail = uploadResponse.data;
  
  // 특정 에러에 따라 처리
  if (errorDetail.error === 'channel_not_found' || errorDetail.error === 'not_in_channel') {
    throw new Error('Slack 채널을 찾을 수 없거나 봇이 채널에 초대되지 않았습니다.');
  } else if (errorDetail.error === 'missing_scope') {
    throw new Error('Slack 앱에 필요한 권한이 없습니다.');
  } else if (errorDetail.error === 'invalid_auth') {
    throw new Error('Slack 인증 실패. Bot Token을 확인해주세요.');
  } else {
    // 기타 에러는 텍스트 메시지로 fallback
    return await this.sendViaBotAPITextOnly(message, channelId || channel, botToken);
  }
}
```

**에러 코드별 처리:**
- `channel_not_found` / `not_in_channel`: 에러 throw (사용자에게 알림)
- `missing_scope`: 에러 throw (권한 문제)
- `invalid_auth`: 에러 throw (인증 문제)
- 기타 에러: 텍스트 메시지로 fallback

### 스레드 메시지 전송 실패

```javascript
try {
  messageResponse = await axios.post('https://slack.com/api/chat.postMessage', {
    channel: channelId,
    thread_ts: actualFileTs,
    text: message.text,
    blocks: message.blocks
  });
} catch (threadError) {
  logger.warn('Failed to send thread message, but file uploaded successfully');
  // 파일은 이미 업로드되었으므로 에러를 throw하지 않음
}
```

**처리:**
- 파일 업로드는 성공했으므로 에러를 throw하지 않음
- 경고 로그만 기록

---

## 로그 포인트

### 주요 로그 위치

1. **Controller 레벨**
   ```javascript
   logger.info('Sharing issue to Slack', {
     issueId,
     screenshotPath: issue.screenshotPath,
     hasScreenshot: !!issue.screenshotPath,
     channel
   });
   ```

2. **SlackService.shareIssue()**
   ```javascript
   logger.info('[SlackService] shareIssue called', {
     hasScreenshot: !!screenshotPath,
     screenshotPath,
     channel,
     hasWebhook: !!this.getWebhookUrl(),
     hasBotToken: !!this.getBotToken()
   });
   ```

3. **파일 존재 확인**
   ```javascript
   logger.info('[SlackService] Checking screenshot file', {
     screenshotPath,
     fullPath,
     exists: fs.existsSync(fullPath)
   });
   ```

4. **파일 업로드 준비**
   ```javascript
   logger.info('[SlackService] Form data prepared', {
     channelId,
     initialComment: initialComment.substring(0, 100),
     filename: path.basename(fullPath),
     fileSize: fs.statSync(fullPath).size
   });
   ```

5. **파일 업로드 응답**
   ```javascript
   logger.info('[SlackService] File upload response', {
     ok: uploadResponse.data.ok,
     error: uploadResponse.data.error,
     fileId: uploadResponse.data.file?.id
   });
   ```

6. **파일 업로드 성공**
   ```javascript
   logger.info('[SlackService] File uploaded successfully', {
     fileId: fileInfo?.id,
     fileTs,
     channelId,
     channel
   });
   ```

7. **파일 업로드 실패 (상세)**
   ```javascript
   logger.error('[SlackService] Slack file upload failed - DETAILED ERROR', {
     error: errorDetail.error,
     warning: errorDetail.warning,
     needed: errorDetail.needed,
     provided: errorDetail.provided,
     fileExists: fs.existsSync(fullPath),
     fileSize: fs.existsSync(fullPath) ? fs.statSync(fullPath).size : null,
     botTokenExists: !!botToken
   });
   ```

---

## 요약

### 핵심 로직 흐름

1. **이슈 정보 조회** → `screenshotPath` 추출
2. **파일 경로 변환** → 상대 경로 → 절대 경로
3. **파일 존재 확인** → 없으면 텍스트 메시지만 전송
4. **FormData 생성** → 파일 + 채널 ID + 초기 댓글
5. **Slack API 호출** → `files.upload` API
6. **fileTs 추출** → 스레드 메시지 전송용
7. **스레드 메시지 전송** → `chat.postMessage` API (선택)

### 필수 조건

- ✅ Bot Token 설정 (`SLACK_BOT_TOKEN`)
- ✅ `files:write` 권한
- ✅ 봇이 채널에 초대됨
- ✅ 파일이 실제로 존재함
- ✅ 채널 ID 형식 (C로 시작)

### 실패 시 처리

- 파일 없음 → 텍스트 메시지만 전송
- 권한 문제 → 에러 throw
- 채널 문제 → 에러 throw
- 기타 에러 → 텍스트 메시지로 fallback









