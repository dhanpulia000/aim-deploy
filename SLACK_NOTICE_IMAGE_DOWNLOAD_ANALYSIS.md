# 슬랙 공지사항 이미지 다운로드 로직 상세 분석

## 📋 개요

슬랙에서 이미지를 포함한 메시지를 공지사항으로 가져올 때 이미지가 불러와지지 않는 문제를 해결하기 위한 상세 분석 문서입니다.

---

## 1. 현재 구현 로직

### 1.1 이미지 파일 감지 및 다운로드 (`slackNotice.worker.js`)

**위치**: `backend/workers/ingestion/slackNotice.worker.js` (line 301-354)

```javascript
// 메시지에 포함된 이미지 파일 처리 (있으면 첫 번째 이미지를 스크린샷으로 사용)
let screenshotPath = null;
let hasImages = false;

try {
  // 1. message.files 배열에서 이미지 파일 찾기
  const imageFile =
    (message.files || []).find(
      (file) =>
        file.mimetype?.startsWith('image/') ||
        file.filetype === 'png' ||
        file.filetype === 'jpg' ||
        file.filetype === 'jpeg' ||
        file.filetype === 'gif' ||
        file.filetype === 'webp'
    ) || null;

  // 2. 이미지 파일이 있고 url_private가 있는 경우에만 다운로드
  if (imageFile && imageFile.url_private) {
    // 3. 파일 경로 생성
    const articleId = message.ts?.replace('.', '_') || String(Date.now());
    const pathInfo = generateScreenshotPath(articleId);

    // 4. 디렉토리 생성
    await ensureScreenshotDirectory(pathInfo.uploadsDir);

    logger.info('[SlackNoticeWorker] Downloading image for notice', {
      ts: message.ts,
      fileId: imageFile.id,
      url: imageFile.url_private,
      targetPath: pathInfo.fullPath
    });

    // 5. 이미지 다운로드 (axios 사용)
    const response = await axios.get(imageFile.url_private, {
      responseType: 'arraybuffer',
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`
      },
      timeout: 30000
    });

    // 6. 파일 저장
    await fs.writeFile(pathInfo.fullPath, response.data);

    // 7. 상대 경로 저장 (DB에 저장될 경로)
    screenshotPath = pathInfo.relativePath;
    hasImages = true;

    logger.info('[SlackNoticeWorker] Image downloaded for notice', {
      ts: message.ts,
      screenshotPath,
      fileSize: response.data?.length
    });
  }
} catch (imageError) {
  // 에러 발생 시 경고만 로그하고 계속 진행
  logger.warn('[SlackNoticeWorker] Failed to download image for notice', {
    ts: message.ts,
    error: imageError.message
  });
}
```

### 1.2 파일 경로 생성 (`fileUtils.js`)

**위치**: `backend/utils/fileUtils.js`

```javascript
function generateScreenshotPath(articleId) {
  // 날짜별 폴더 생성
  const today = new Date();
  const dateFolder = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  // 파일명: issue_{articleId}.png
  const fileName = `issue_${articleId}.png`;
  
  // 상대 경로 (DB 저장용)
  const relativePath = `screenshots/${dateFolder}/${fileName}`;
  
  // 절대 경로 (파일 저장용)
  const backendDir = path.resolve(__dirname, '..');
  const uploadsDir = path.join(backendDir, 'uploads', 'screenshots', dateFolder);
  const fullPath = path.join(uploadsDir, fileName);
  
  return {
    fullPath,
    relativePath,
    fileName,
    dateFolder,
    uploadsDir
  };
}
```

**경로 예시**:
- **상대 경로 (DB)**: `screenshots/2025-12-02/issue_1234567890_12345.png`
- **절대 경로 (파일)**: `C:\Users\...\WallboardV2\backend\uploads\screenshots\2025-12-02\issue_1234567890_12345.png`

### 1.3 DB 저장 (`slackNotice.worker.js`)

**위치**: `backend/workers/ingestion/slackNotice.worker.js` (line 472-483)

```javascript
const feedbackNotice = await prisma.customerFeedbackNotice.create({
  data: {
    gameName: gameName,
    managerName: managerName,
    category: noticeCategory,
    content: messageText,
    noticeDate: createdAt,
    screenshotPath: screenshotPath, // 이미지 경로 저장
    createdBy: 'slack_worker',
    isActive: true,
  },
});
```

### 1.4 프론트엔드 이미지 표시 (`App.tsx`)

**위치**: `src/App.tsx` (line 23-82)

```typescript
function NoticeScreenshotImage({ screenshotPath }: { screenshotPath: string }) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const imageUrl = `/uploads/${screenshotPath}`; // 상대 경로를 /uploads/로 매핑

  return (
    <img
      src={imageUrl}
      alt="공지 이미지"
      onError={() => {
        setImageError(true);
        setImageLoading(false);
      }}
    />
  );
}
```

**이미지 URL 예시**: `/uploads/screenshots/2025-12-02/issue_1234567890_12345.png`

---

## 2. 문제점 분석

### 2.1 이미지 파일 감지 실패 가능성

#### 문제 1: `message.files`가 없는 경우
- 슬랙 메시지에 이미지를 직접 업로드하지 않고, 링크로 공유한 경우
- 또는 이미지가 `blocks` 또는 `attachments`에 포함된 경우

**슬랙 메시지 구조**:
```javascript
{
  text: "메시지 텍스트",
  files: [...],        // 직접 업로드한 파일
  blocks: [...],       // 리치 텍스트 블록 (이미지 포함 가능)
  attachments: [...]   // 첨부 파일 (구버전)
}
```

#### 문제 2: `url_private`가 없는 경우
- 파일이 공개 URL만 있는 경우
- 또는 파일 접근 권한이 없는 경우

#### 문제 3: 이미지 파일 타입 감지 실패
- 현재 로직은 `mimetype` 또는 `filetype`으로만 확인
- 일부 슬랙 파일은 다른 형식으로 제공될 수 있음

### 2.2 다운로드 실패 가능성

#### 문제 1: 인증 실패
- `SLACK_BOT_TOKEN`이 유효하지 않거나 만료된 경우
- 봇에 `files:read` 권한이 없는 경우

#### 문제 2: 네트워크 타임아웃
- 현재 타임아웃: 30초
- 큰 이미지 파일의 경우 타임아웃 발생 가능

#### 문제 3: 파일 저장 실패
- 디렉토리 권한 문제
- 디스크 공간 부족
- 경로 생성 실패

### 2.3 경로 매핑 문제

#### 문제 1: 프론트엔드 경로 불일치
- DB에 저장된 경로: `screenshots/2025-12-02/issue_xxx.png`
- 프론트엔드 요청 경로: `/uploads/screenshots/2025-12-02/issue_xxx.png`
- 서버 정적 파일 서빙 경로 확인 필요

#### 문제 2: 정적 파일 서빙 미설정
- Express에서 `/uploads` 경로를 정적 파일로 서빙하는지 확인 필요

---

## 3. 개선 방안

### 3.1 이미지 파일 감지 강화

```javascript
// 개선된 이미지 파일 감지 로직
function findImageFile(message) {
  // 1. message.files에서 이미지 찾기 (기존 로직)
  const fileImage = (message.files || []).find(
    (file) =>
      file.mimetype?.startsWith('image/') ||
      ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(file.filetype)
  );

  if (fileImage && fileImage.url_private) {
    return fileImage;
  }

  // 2. blocks에서 이미지 찾기
  if (message.blocks && Array.isArray(message.blocks)) {
    for (const block of message.blocks) {
      // image block 타입
      if (block.type === 'image' && block.image_url) {
        return {
          url_private: block.image_url,
          mimetype: 'image/png', // 기본값
          filetype: 'png'
        };
      }
      
      // section block 내부의 image element
      if (block.type === 'section' && block.accessory?.type === 'image') {
        return {
          url_private: block.accessory.image_url,
          mimetype: 'image/png',
          filetype: 'png'
        };
      }
    }
  }

  // 3. attachments에서 이미지 찾기 (구버전 호환)
  if (message.attachments && Array.isArray(message.attachments)) {
    for (const attachment of message.attachments) {
      if (attachment.image_url || attachment.thumb_url) {
        return {
          url_private: attachment.image_url || attachment.thumb_url,
          mimetype: 'image/png',
          filetype: 'png'
        };
      }
    }
  }

  return null;
}
```

### 3.2 다운로드 로직 강화

```javascript
async function downloadSlackImage(imageFile, articleId) {
  try {
    const pathInfo = generateScreenshotPath(articleId);
    await ensureScreenshotDirectory(pathInfo.uploadsDir);

    // 1. url_private 우선 시도
    let downloadUrl = imageFile.url_private;
    let headers = {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`
    };

    // 2. url_private가 없으면 url_private_download 시도
    if (!downloadUrl && imageFile.url_private_download) {
      downloadUrl = imageFile.url_private_download;
    }

    // 3. 공개 URL 시도 (마지막 수단)
    if (!downloadUrl && imageFile.url) {
      downloadUrl = imageFile.url;
      headers = {}; // 공개 URL은 인증 불필요
    }

    if (!downloadUrl) {
      throw new Error('No valid image URL found');
    }

    logger.info('[SlackNoticeWorker] Downloading image', {
      articleId,
      url: downloadUrl,
      targetPath: pathInfo.fullPath
    });

    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      headers,
      timeout: 60000, // 타임아웃 증가 (60초)
      maxContentLength: 10 * 1024 * 1024, // 최대 10MB
      validateStatus: (status) => status === 200
    });

    // 파일 확장자 확인 및 조정
    const contentType = response.headers['content-type'] || imageFile.mimetype;
    let fileExtension = 'png';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      fileExtension = 'jpg';
    } else if (contentType.includes('gif')) {
      fileExtension = 'gif';
    } else if (contentType.includes('webp')) {
      fileExtension = 'webp';
    }

    // 파일명에 확장자 반영
    const fileName = `issue_${articleId}.${fileExtension}`;
    const fullPath = path.join(pathInfo.uploadsDir, fileName);
    const relativePath = `screenshots/${pathInfo.dateFolder}/${fileName}`;

    await fs.writeFile(fullPath, response.data);

    logger.info('[SlackNoticeWorker] Image downloaded successfully', {
      articleId,
      screenshotPath: relativePath,
      fileSize: response.data.length,
      contentType
    });

    return relativePath;
  } catch (error) {
    logger.error('[SlackNoticeWorker] Failed to download image', {
      articleId,
      error: error.message,
      stack: error.stack,
      imageFile: {
        id: imageFile.id,
        name: imageFile.name,
        mimetype: imageFile.mimetype,
        hasUrlPrivate: !!imageFile.url_private,
        hasUrlPrivateDownload: !!imageFile.url_private_download,
        hasUrl: !!imageFile.url
      }
    });
    throw error;
  }
}
```

### 3.3 정적 파일 서빙 확인

**확인 사항**: `backend/app.js` 또는 `backend/server.js`에서 정적 파일 서빙 설정

```javascript
// Express 정적 파일 서빙 설정 예시
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
```

**확인 방법**:
1. `backend/app.js` 또는 `backend/server.js` 파일 확인
2. `express.static` 미들웨어가 `/uploads` 경로에 설정되어 있는지 확인

### 3.4 로깅 강화

```javascript
// 이미지 다운로드 전 상세 로깅
logger.info('[SlackNoticeWorker] Processing message with files', {
  ts: message.ts,
  filesCount: message.files?.length || 0,
  files: message.files?.map(f => ({
    id: f.id,
    name: f.name,
    mimetype: f.mimetype,
    filetype: f.filetype,
    size: f.size,
    hasUrlPrivate: !!f.url_private,
    hasUrlPrivateDownload: !!f.url_private_download,
    hasUrl: !!f.url
  })) || [],
  blocksCount: message.blocks?.length || 0,
  attachmentsCount: message.attachments?.length || 0
});
```

---

## 4. 디버깅 체크리스트

### 4.1 이미지 파일 감지 확인

- [ ] 슬랙 메시지에 `message.files` 배열이 있는지 확인
- [ ] `message.files`에 이미지 파일이 포함되어 있는지 확인
- [ ] 이미지 파일에 `url_private` 속성이 있는지 확인
- [ ] `message.blocks`에 이미지가 포함되어 있는지 확인
- [ ] `message.attachments`에 이미지가 포함되어 있는지 확인

### 4.2 다운로드 확인

- [ ] `SLACK_BOT_TOKEN`이 유효한지 확인
- [ ] 봇에 `files:read` 권한이 있는지 확인
- [ ] 네트워크 연결이 정상인지 확인
- [ ] 다운로드 로그에서 에러 메시지 확인

### 4.3 파일 저장 확인

- [ ] `backend/uploads/screenshots/YYYY-MM-DD/` 디렉토리가 생성되는지 확인
- [ ] 파일이 실제로 저장되는지 확인
- [ ] 파일 크기가 0이 아닌지 확인
- [ ] 파일 권한이 올바른지 확인

### 4.4 프론트엔드 표시 확인

- [ ] 브라우저 개발자 도구에서 이미지 URL 확인
- [ ] 네트워크 탭에서 이미지 요청 상태 확인 (404, 403 등)
- [ ] 서버 로그에서 정적 파일 요청 확인
- [ ] Express 정적 파일 서빙 설정 확인

---

## 5. 즉시 확인 사항

### 5.1 서버 로그 확인

```bash
# 백엔드 서버 로그에서 다음 메시지 확인
[SlackNoticeWorker] Downloading image for notice
[SlackNoticeWorker] Image downloaded for notice
[SlackNoticeWorker] Failed to download image for notice
```

### 5.2 파일 시스템 확인

```bash
# Windows PowerShell
cd backend
dir uploads\screenshots\2025-12-02

# 파일이 있는지 확인
Test-Path "uploads\screenshots\2025-12-02\issue_*.png"
```

### 5.3 브라우저 개발자 도구 확인

1. **Network 탭**:
   - 이미지 요청 URL 확인
   - HTTP 상태 코드 확인 (200, 404, 403 등)
   - 응답 헤더 확인

2. **Console 탭**:
   - 이미지 로드 에러 메시지 확인

---

## 6. 예상되는 문제와 해결책

### 문제 1: 이미지 파일이 감지되지 않음

**증상**: 로그에 "Downloading image for notice" 메시지가 없음

**원인**:
- `message.files`가 비어있음
- 이미지가 `blocks` 또는 `attachments`에만 있음

**해결책**:
- 3.1의 개선된 이미지 파일 감지 로직 적용

### 문제 2: 다운로드 실패

**증상**: 로그에 "Failed to download image for notice" 메시지

**원인**:
- 인증 실패 (토큰 만료 또는 권한 부족)
- 네트워크 타임아웃
- 파일 크기 초과

**해결책**:
- `SLACK_BOT_TOKEN` 재발급
- 봇 권한 확인 (`files:read` 필요)
- 타임아웃 증가 (3.2 참조)

### 문제 3: 파일은 저장되지만 프론트엔드에서 표시 안 됨

**증상**: 파일은 존재하지만 브라우저에서 404 에러

**원인**:
- Express 정적 파일 서빙 미설정
- 경로 매핑 불일치

**해결책**:
- `app.js` 또는 `server.js`에서 정적 파일 서빙 설정 확인
- 경로 매핑 확인

---

## 7. 다음 단계

1. **현재 상태 확인**:
   - 서버 로그에서 이미지 다운로드 관련 메시지 확인
   - 파일 시스템에서 실제 저장된 파일 확인
   - 브라우저 개발자 도구에서 이미지 요청 상태 확인

2. **개선 로직 적용**:
   - 3.1의 이미지 파일 감지 강화 로직 적용
   - 3.2의 다운로드 로직 강화 적용
   - 3.4의 로깅 강화 적용

3. **테스트**:
   - 슬랙에서 이미지 포함 메시지 전송
   - 공지사항으로 수집되는지 확인
   - 이미지가 표시되는지 확인









