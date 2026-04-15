# 이미지 불러오기 로직 현재 상황 보고서

**작성일**: 2025-12-02  
**상태**: 이미지 로딩 실패 중

---

## 1. 현재 상황

### 1.1 문제 현상
- 공지사항 상세 화면에서 이미지가 표시되지 않음
- 에러 메시지: "이미지를 불러올 수 없습니다"
- 이미지 URL: `http://127.0.0.1:8080/uploads/screenshots/2025-12-02/issue_1764649515_074059.png`

### 1.2 확인된 사항
- ✅ 이미지 파일 존재: `backend/uploads/screenshots/2025-12-02/issue_1764649515_074059.png` (52,432 바이트)
- ✅ 백엔드 서빙 정상: HTTP 200 응답 확인
- ✅ DB에 경로 저장: `screenshotPath: screenshots/2025-12-02/issue_1764649515_074059.png`
- ❌ 프론트엔드에서 이미지 로딩 실패

---

## 2. 현재 구현 상태

### 2.1 백엔드 설정

#### 정적 파일 서빙 (`backend/app.js`)
```javascript
// 정적 파일 서빙
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
```

#### CORS 설정
```javascript
app.use(cors());
```

#### Helmet CSP 설정 (최근 수정)
```javascript
app.use(helmet({ 
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "http://127.0.0.1:8080", "http://localhost:8080"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
```

**파일 경로 구조**:
```
backend/
└── uploads/
    └── screenshots/
        └── 2025-12-02/
            └── issue_1764649515_074059.png
```

**접근 URL**: `http://127.0.0.1:8080/uploads/screenshots/2025-12-02/issue_1764649515_074059.png`

---

### 2.2 프론트엔드 설정

#### Vite 프록시 설정 (`vite.config.ts`)
```typescript
proxy: {
  '/api': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
    secure: false
  },
  '/uploads': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
    secure: false
  }
}
```

#### 이미지 컴포넌트 (`src/App.tsx`)
```typescript
function NoticeScreenshotImage({ screenshotPath }: { screenshotPath: string }) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  // 절대 경로 사용 (Vite 프록시 우회)
  const imageUrl = `http://127.0.0.1:8080/uploads/${screenshotPath}`;

  // 에러 처리
  if (imageError) {
    return (
      <div className="text-xs text-slate-400 text-center py-2">
        이미지를 불러올 수 없습니다
        <br />
        <span className="text-xs text-slate-500 break-all">{imageUrl}</span>
        <br />
        <button onClick={...}>다시 시도</button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <img
        src={imageUrl}
        alt="공지 이미지"
        crossOrigin="anonymous"
        onLoad={() => {
          setImageLoading(false);
          setImageError(false);
        }}
        onError={(e) => {
          console.error('이미지 로딩 실패:', imageUrl, e);
          setImageError(true);
          setImageLoading(false);
        }}
      />
    </div>
  );
}
```

**현재 이미지 URL 형식**:
- 절대 경로: `http://127.0.0.1:8080/uploads/screenshots/2025-12-02/issue_1764649515_074059.png`
- 상대 경로 (Vite 프록시): `/uploads/screenshots/2025-12-02/issue_1764649515_074059.png` (현재 미사용)

---

### 2.3 슬랙 이미지 다운로드 로직 (`backend/workers/ingestion/slackNotice.worker.js`)

#### 이미지 파일 찾기 (`findImageFile`)
```javascript
function findImageFile(message) {
  // 1. message.files에서 이미지 찾기
  const fileImage = (message.files || []).find(
    (file) =>
      file.mimetype?.startsWith('image/') ||
      ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(file.filetype)
  );
  if (fileImage && (fileImage.url_private || fileImage.url_private_download || fileImage.url)) {
    return fileImage;
  }

  // 2. blocks에서 이미지 찾기
  if (message.blocks && Array.isArray(message.blocks)) {
    for (const block of message.blocks) {
      // image block 타입
      if (block.type === 'image' && block.image_url) {
        return { url_private: block.image_url, ... };
      }
      // section block 내부의 image element
      if (block.type === 'section' && block.accessory?.type === 'image') {
        return { url_private: block.accessory.image_url, ... };
      }
      // rich_text block 내부의 이미지 요소 (슬랙에서 붙여넣기한 이미지)
      if (block.type === 'rich_text' && block.elements && Array.isArray(block.elements)) {
        for (const element of block.elements) {
          if (element.type === 'image' && element.url) {
            return { url_private: element.url, ... };
          }
        }
      }
    }
  }

  // 3. attachments에서 이미지 찾기 (구버전 호환)
  if (message.attachments && Array.isArray(message.attachments)) {
    for (const attachment of message.attachments) {
      if (attachment.image_url || attachment.thumb_url) {
        return { url_private: attachment.image_url || attachment.thumb_url, ... };
      }
    }
  }

  return null;
}
```

#### 이미지 다운로드 (`downloadSlackImage`)
```javascript
async function downloadSlackImage(imageFile, articleId) {
  try {
    const pathInfo = generateScreenshotPath(articleId);
    await ensureScreenshotDirectory(pathInfo.uploadsDir);

    // URL 우선순위: url_private > url_private_download > url
    let downloadUrl = imageFile.url_private;
    let headers = {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`
    };

    if (!downloadUrl && imageFile.url_private_download) {
      downloadUrl = imageFile.url_private_download;
    }

    if (!downloadUrl && imageFile.url) {
      downloadUrl = imageFile.url;
      headers = {}; // 공개 URL은 인증 불필요
    }

    // axios로 이미지 다운로드
    let response;
    try {
      response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        headers,
        timeout: 60000, // 60초 타임아웃
        maxContentLength: 10 * 1024 * 1024, // 최대 10MB
        maxBodyLength: 10 * 1024 * 1024,
        validateStatus: (status) => status === 200
      });
    } catch (axiosError) {
      logger.error('[SlackNoticeWorker] Axios request failed', {
        url: downloadUrl,
        error: axiosError.message,
        statusCode: axiosError.response?.status
      });
      throw axiosError;
    }

    // 파일 확장자 확인 및 저장
    const contentType = response.headers['content-type'] || imageFile.mimetype;
    let fileExtension = 'png';
    // ... 확장자 결정 로직 ...

    const fileName = `issue_${articleId}.${fileExtension}`;
    const fullPath = path.join(pathInfo.uploadsDir, fileName);
    const relativePath = `screenshots/${pathInfo.dateFolder}/${fileName}`;

    await fs.writeFile(fullPath, response.data);

    logger.info('[SlackNoticeWorker] Image downloaded successfully', {
      screenshotPath: relativePath,
      fileSize: response.data.length
    });

    return relativePath; // DB에 저장될 경로
  } catch (error) {
    logger.error('[SlackNoticeWorker] Failed to download image', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}
```

**저장 경로**:
- 전체 경로: `backend/uploads/screenshots/2025-12-02/issue_1764649515_074059.png`
- DB 저장 경로: `screenshots/2025-12-02/issue_1764649515_074059.png`

---

## 3. 시도한 해결 방법

### 3.1 이미지 URL 절대 경로 사용
- **변경**: 상대 경로(`/uploads/...`) → 절대 경로(`http://127.0.0.1:8080/uploads/...`)
- **목적**: Vite 프록시 우회하여 직접 백엔드 서버에서 로드
- **결과**: 여전히 실패

### 3.2 Helmet CSP 설정 조정
- **변경**: `imgSrc`에 `http://127.0.0.1:8080`, `http://localhost:8080` 추가
- **목적**: Content-Security-Policy가 이미지 로딩을 차단하지 않도록
- **결과**: 여전히 실패

### 3.3 crossOrigin 속성 추가
- **변경**: `<img crossOrigin="anonymous" />` 추가
- **목적**: CORS 문제 해결
- **결과**: 여전히 실패

### 3.4 에러 로깅 강화
- **변경**: `onError` 핸들러에 `console.error` 추가
- **목적**: 브라우저 콘솔에서 에러 확인
- **결과**: 에러 메시지 확인 가능

---

## 4. 현재 문제점 분석

### 4.1 가능한 원인

1. **CORS 문제**
   - 브라우저에서 다른 포트(5173 → 8080)로 요청 시 CORS 에러 발생 가능
   - 현재 `cors()` 미들웨어 사용 중이지만, 이미지 요청에 대한 특별한 설정 없음

2. **Helmet CSP 문제**
   - Content-Security-Policy가 여전히 이미지 로딩을 차단할 수 있음
   - `imgSrc`에 추가했지만 브라우저에서 차단될 수 있음

3. **Vite 프록시 문제**
   - 절대 경로를 사용하여 프록시를 우회했지만, 브라우저 보안 정책에 의해 차단될 수 있음

4. **브라우저 캐시 문제**
   - 이전 실패한 요청이 캐시되어 있을 수 있음

5. **네트워크 요청 실패**
   - 실제 네트워크 요청이 실패하고 있을 수 있음 (브라우저 개발자 도구에서 확인 필요)

---

## 5. 확인 필요 사항

### 5.1 브라우저 개발자 도구 확인
1. **Network 탭**:
   - 이미지 요청이 실제로 전송되는지 확인
   - 요청 URL 확인
   - 응답 상태 코드 확인 (200, 404, CORS 에러 등)
   - 응답 헤더 확인 (CORS 관련 헤더)

2. **Console 탭**:
   - JavaScript 에러 메시지 확인
   - `console.error('이미지 로딩 실패:', ...)` 메시지 확인
   - CORS 에러 메시지 확인

3. **Application/Storage 탭**:
   - 캐시된 리소스 확인
   - Service Worker 등록 여부 확인

### 5.2 백엔드 로그 확인
- 이미지 요청이 백엔드에 도달하는지 확인
- 정적 파일 서빙 미들웨어가 요청을 처리하는지 확인
- 에러 로그 확인

---

## 6. 다음 단계 제안

### 6.1 즉시 확인
1. 브라우저 개발자 도구(F12) → Network 탭에서 이미지 요청 상태 확인
2. Console 탭에서 에러 메시지 확인
3. 백엔드 서버 로그에서 이미지 요청 로그 확인

### 6.2 추가 해결 방법

#### 방법 1: CORS 헤더 명시적 추가
```javascript
// backend/app.js
app.use('/uploads', express.static(path.join(__dirname, 'uploads')), (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  next();
});
```

#### 방법 2: Vite 프록시 사용 (상대 경로)
```typescript
// 프론트엔드에서 상대 경로 사용
const imageUrl = `/uploads/${screenshotPath}`;
```

#### 방법 3: 이미지 Base64 인코딩
- 이미지를 Base64로 인코딩하여 DB에 저장
- 프론트엔드에서 `data:image/png;base64,...` 형식으로 표시

#### 방법 4: 이미지 프록시 API 엔드포인트 생성
```javascript
// backend/routes/images.routes.js
router.get('/:path(*)', async (req, res) => {
  const filePath = path.join(__dirname, '../uploads', req.params.path);
  res.sendFile(filePath);
});
```

---

## 7. 현재 코드 위치

### 백엔드
- 정적 파일 서빙: `backend/app.js` (line 37)
- Helmet 설정: `backend/app.js` (line 22-35)
- 이미지 다운로드: `backend/workers/ingestion/slackNotice.worker.js` (line 389-483)
- 이미지 찾기: `backend/workers/ingestion/slackNotice.worker.js` (line 310-384)

### 프론트엔드
- 이미지 컴포넌트: `src/App.tsx` (line 23-87)
- Vite 프록시: `vite.config.ts` (line 18-22)

---

## 8. 테스트 결과

### 백엔드 직접 요청 테스트
```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:8080/uploads/screenshots/2025-12-02/issue_1764649515_074059.png" -Method Get
```
**결과**: ✅ HTTP 200, 파일 크기 52,432 바이트

### 파일 존재 확인
```powershell
Test-Path "backend\uploads\screenshots\2025-12-02\issue_1764649515_074059.png"
```
**결과**: ✅ True

---

## 9. 결론

- **백엔드 서빙**: 정상 작동
- **파일 존재**: 확인됨
- **프론트엔드 로딩**: 실패 (원인 불명)

**다음 조치**: 브라우저 개발자 도구에서 실제 네트워크 요청과 에러 메시지를 확인하여 정확한 원인 파악 필요









