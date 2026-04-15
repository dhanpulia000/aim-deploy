# 스크린샷 캡처 로직 상세 문서

## 개요
이슈의 원본 URL에서 스크린샷을 자동으로 캡처하는 기능입니다. Playwright를 사용하여 브라우저를 제어하고, 네이버 카페 게시글의 본문 영역을 캡처합니다.

## 전체 흐름

### 1. 프론트엔드 요청 (IssueDetailPanel.tsx)

**위치**: `src/components/IssueDetailPanel.tsx` (195-235줄)

**트리거**:
- 사용자가 "스크린샷 캡처" 버튼 클릭
- 이슈에 `link` 또는 `sourceUrl`이 있어야 함

**요청 형식**:
```typescript
POST /api/issues/:issueId/capture-screenshot
Headers: {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json'
}
```

**전처리 검증**:
1. `ticket.issueId` 존재 확인
2. `token` 존재 확인 (로그인 상태)
3. `ticket.link` 또는 `ticket.sourceUrl` 존재 확인
4. 사용자 확인 다이얼로그

**응답 처리**:
- 성공: `{ success: true, data: { screenshotPath, message } }`
- 실패: `{ success: false, error: '...' }` 또는 `{ success: false, message: '...' }`
- 성공 시 페이지 새로고침 (`window.location.reload()`)

---

### 2. 백엔드 라우트 (issues.routes.js)

**위치**: `backend/routes/issues.routes.js` (117-122줄)

```javascript
router.post('/:issueId/capture-screenshot', authenticate, screenshotController.captureScreenshot);
```

**인증**: `authenticate` 미들웨어 필요 (Private 엔드포인트)

---

### 3. 스크린샷 컨트롤러 (screenshot.controller.js)

**위치**: `backend/controllers/screenshot.controller.js`

#### 3.1 초기 검증 단계

```javascript
// 1. Issue ID 검증
if (!issueId) {
  return sendError(res, 'Issue ID is required', HTTP_STATUS.BAD_REQUEST);
}

// 2. 이슈 존재 확인
const issue = await prisma.reportItemIssue.findUnique({
  where: { id: issueId }
});

if (!issue) {
  return sendError(res, 'Issue not found', HTTP_STATUS.NOT_FOUND);
}

// 3. sourceUrl 존재 확인
if (!issue.sourceUrl) {
  return sendError(res, 'Issue does not have sourceUrl', HTTP_STATUS.BAD_REQUEST);
}
```

#### 3.2 기존 스크린샷 확인

```javascript
// 이미 스크린샷이 있고 파일이 존재하면 재캡처하지 않음
if (issue.screenshotPath) {
  const existingPath = path.join(__dirname, '../uploads', issue.screenshotPath);
  if (await fs.access(existingPath).then(() => true).catch(() => false)) {
    return sendSuccess(res, {
      screenshotPath: issue.screenshotPath,
      message: 'Screenshot already exists'
    });
  }
}
```

**문제점**: 파일이 없어도 DB에 경로가 있으면 재캡처하지 않음. 파일이 삭제되었을 때 문제 발생 가능.

#### 3.3 브라우저 실행

```javascript
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
```

**설정**:
- `headless: true`: 브라우저 UI 없이 실행
- `--no-sandbox`: Linux 환경에서 권한 문제 해결
- `--disable-setuid-sandbox`: 보안 샌드박스 비활성화

**주의사항**: 
- Playwright 브라우저가 설치되어 있어야 함 (`npx playwright install chromium`)
- 서버 환경에 Chromium이 설치되어 있어야 함

#### 3.4 페이지 로드

```javascript
await page.goto(issue.sourceUrl, {
  waitUntil: 'networkidle',
  timeout: 30000
});
```

**설정**:
- `waitUntil: 'networkidle'`: 네트워크 요청이 완료될 때까지 대기
- `timeout: 30000`: 30초 타임아웃

**문제점**: 
- 네이버 카페 로그인이 필요한 경우 실패할 수 있음
- 페이지 로드가 30초 이상 걸리면 실패
- JavaScript 에러가 발생하면 로드 실패 가능

#### 3.5 본문 컨테이너 대기

```javascript
await page.waitForSelector('.se-main-container', { timeout: 15000 }).catch(() => {
  logger.warn('[Screenshot] .se-main-container not found, trying alternative selectors');
});
```

**문제점**:
- `.se-main-container`가 없어도 에러를 무시하고 계속 진행
- 대체 선택자를 시도하지 않음 (로깅만 함)
- 15초 타임아웃 후에도 계속 진행

#### 3.6 렌더링 대기

```javascript
await page.waitForTimeout(4000);
```

**설명**: 고정 4초 대기 (이미지 로딩 완료 대기)

**문제점**: 
- 이미지가 4초 내에 로드되지 않으면 실패 가능
- 동적 로딩 이미지의 경우 실패 가능

#### 3.7 이미지 존재 확인

```javascript
const hasImages = await page.evaluate(() => {
  const mainContainer = document.querySelector('.se-main-container');
  if (!mainContainer) return false;
  const images = mainContainer.querySelectorAll('img');
  return images.length > 0;
});

if (!hasImages) {
  await browser.close();
  return sendError(res, 'No images found in the article', HTTP_STATUS.BAD_REQUEST);
}
```

**문제점**:
- `.se-main-container`가 없으면 `hasImages = false`
- 이미지가 없으면 스크린샷 캡처 실패 (텍스트만 있는 게시글은 캡처 불가)

#### 3.8 파일 경로 생성

```javascript
// 날짜별 폴더 생성
const today = new Date();
const dateFolder = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const screenshotsDir = path.join(__dirname, '../uploads/screenshots', dateFolder);

await fs.mkdir(screenshotsDir, { recursive: true });

// 파일명: issue_{issueId}.png (externalPostId가 있으면 사용)
const articleId = issue.externalPostId || issueId;
const filename = `issue_${articleId}.png`;
const filePath = path.join(screenshotsDir, filename);
```

**경로 구조**:
```
backend/uploads/screenshots/
  └── YYYY-MM-DD/
      └── issue_{articleId}.png
```

**DB 저장 경로**: `screenshots/YYYY-MM-DD/issue_{articleId}.png`

#### 3.9 스크린샷 캡처

```javascript
const mainContainer = page.locator('.se-main-container');
await mainContainer.screenshot({ 
  path: filePath,
  fullPage: false
});
```

**설정**:
- `fullPage: false`: 컨테이너 영역만 캡처 (전체 페이지가 아님)

**문제점**:
- `.se-main-container`가 없으면 에러 발생
- 컨테이너가 뷰포트 밖에 있으면 캡처 실패 가능

#### 3.10 DB 업데이트

```javascript
const screenshotPath = `screenshots/${dateFolder}/${filename}`;

await prisma.reportItemIssue.update({
  where: { id: issueId },
  data: { screenshotPath }
});
```

#### 3.11 정리 및 응답

```javascript
await browser.close();

return sendSuccess(res, {
  screenshotPath,
  message: 'Screenshot captured successfully'
});
```

**에러 처리**:
```javascript
catch (captureError) {
  await browser.close(); // 브라우저는 항상 닫아야 함
  logger.error('[Screenshot] Capture failed', {
    issueId,
    error: captureError.message
  });
  throw captureError;
}
```

---

## 잠재적 문제점 및 개선 사항

### 1. 선택자 의존성
- **문제**: `.se-main-container`에 강하게 의존
- **영향**: 네이버 카페 UI 변경 시 실패
- **개선**: 대체 선택자 로직 추가 필요

### 2. 이미지 필수 요구사항
- **문제**: 이미지가 없으면 캡처 실패
- **영향**: 텍스트만 있는 게시글은 캡처 불가
- **개선**: 이미지 없어도 캡처하도록 변경 고려

### 3. 타임아웃 설정
- **문제**: 고정 타임아웃 (30초, 15초, 4초)
- **영향**: 느린 네트워크에서 실패 가능
- **개선**: 동적 타임아웃 또는 재시도 로직

### 4. 브라우저 리소스 관리
- **문제**: 에러 발생 시 브라우저가 닫히지 않을 수 있음
- **개선**: `try-finally` 블록으로 보장 필요

### 5. 로그인 상태
- **문제**: 로그인이 필요한 게시글은 캡처 불가
- **영향**: 비공개 게시글 처리 불가
- **개선**: 쿠키 설정 기능 추가 고려

### 6. 파일 시스템 권한
- **문제**: `uploads/screenshots` 폴더 생성 권한 필요
- **영향**: 권한 없으면 실패
- **개선**: 권한 확인 및 에러 처리

### 7. 중복 캡처 방지
- **문제**: 파일이 삭제되어도 DB에 경로가 있으면 재캡처 안 함
- **개선**: 파일 존재 여부 확인 후 재캡처 로직 개선

---

## 디버깅 체크리스트

### 프론트엔드
- [ ] 브라우저 콘솔에서 네트워크 요청 확인
- [ ] 응답 상태 코드 확인 (200, 400, 404, 500)
- [ ] 응답 본문 확인 (`data.success`, `data.error`, `data.message`)

### 백엔드
- [ ] 서버 로그 확인 (`[Screenshot]` 태그)
- [ ] Playwright 브라우저 설치 확인 (`npx playwright install chromium`)
- [ ] `uploads/screenshots` 폴더 권한 확인
- [ ] 이슈의 `sourceUrl` 필드 확인
- [ ] 네이버 카페 접근 가능 여부 확인

### 환경
- [ ] Node.js 버전 확인 (Playwright 요구사항)
- [ ] 시스템 리소스 확인 (메모리, 디스크)
- [ ] 네트워크 연결 확인

---

## 테스트 시나리오

### 성공 케이스
1. 이미지가 있는 네이버 카페 게시글
2. `.se-main-container`가 존재하는 경우
3. 네트워크가 정상인 경우

### 실패 케이스
1. `sourceUrl`이 없는 이슈
2. 이미지가 없는 게시글
3. `.se-main-container`가 없는 페이지
4. 네트워크 타임아웃
5. 브라우저 실행 실패
6. 파일 시스템 권한 오류

---

## 관련 파일

- **프론트엔드**: `src/components/IssueDetailPanel.tsx`
- **백엔드 컨트롤러**: `backend/controllers/screenshot.controller.js`
- **라우트**: `backend/routes/issues.routes.js`
- **자동 캡처**: `backend/workers/monitoring/naverCafe.worker.js` (310-356줄)
- **정리 스케줄러**: `backend/services/screenshotCleanup.service.js`

---

## 개선 제안

1. **재시도 로직 추가**: 네트워크 오류 시 3회 재시도
2. **대체 선택자**: `.se-main-container` 실패 시 다른 선택자 시도
3. **이미지 없이 캡처**: 텍스트만 있어도 캡처 가능하도록
4. **진행 상황 알림**: WebSocket으로 진행 상황 전송
5. **캐시 무효화**: 파일이 없으면 DB 경로 삭제 후 재캡처
6. **로깅 강화**: 각 단계별 상세 로그 추가














