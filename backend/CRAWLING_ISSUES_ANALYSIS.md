# 크롤링 본문 추출 실패 및 시스템 오류 분석 보고서

## 📋 문제 요약

**핵심 문제**: 최근 수집된 모든 RawLog의 본문(content)이 비어있음 (0자)

**영향 범위**: 
- 최근 10개 이상의 게시글 본문 추출 실패
- Issue의 detail 필드가 비어있음
- 사용자에게 "(내용 없음)"으로 표시됨

---

## 🔍 문제 분석

### 1. 본문 추출 실패 원인

#### 1.1 DOM 셀렉터 문제
- **현상**: `se-main-container`를 찾지 못하거나, 찾았지만 내용이 비어있음
- **가능한 원인**:
  - 네이버 카페 페이지 구조 변경
  - JavaScript 동적 로딩 지연
  - 로그인 상태/권한 문제로 본문이 로드되지 않음
  - 쿠키 만료 또는 무효화

#### 1.2 제목 제거 로직 과도
- **현상**: 제목 제거 로직이 너무 강력하여 본문까지 제거됨
- **코드 위치**: `backend/workers/monitoring/naverCafe.worker.js:320-345`
- **문제점**:
  ```javascript
  // 2. 본문에 제목이 포함되어 있는 경우 (시작 부분이 아닌 경우도)
  if (collectedText.includes(cleanTitle)) {
    // 제목을 빈 문자열로 치환
    collectedText = collectedText.replace(cleanTitle, '').trim();
    // ...
  }
  ```
  - 본문에 제목이 포함되어 있으면 전체 제목을 제거하는데, 이때 본문의 일부가 제목과 유사하면 본문까지 제거될 수 있음

#### 1.3 최소 길이 조건
- **현상**: 최소 길이 조건이 1자로 완화되어 있지만, 실제로는 빈 문자열이 저장됨
- **코드 위치**: `backend/workers/monitoring/naverCafe.worker.js:352-356`
- **문제점**: 
  - `collectedText.length > 0` 조건이 있지만, 제목 제거 로직 후에 빈 문자열이 될 수 있음

#### 1.4 대기 시간 부족
- **현상**: `waitForSelector`와 `waitForTimeout(2000)`만으로는 동적 콘텐츠 로드를 보장하지 못할 수 있음
- **코드 위치**: `backend/workers/monitoring/naverCafe.worker.js:270-280`
- **문제점**:
  - 네이버 카페는 JavaScript로 본문을 동적으로 로드할 수 있음
  - 2초 대기만으로는 충분하지 않을 수 있음

### 2. 데이터 흐름 문제

#### 2.1 RawLog 저장 단계
- **위치**: `backend/workers/monitoring/naverCafe.worker.js:489-502`
- **문제**: 빈 content가 그대로 RawLog에 저장됨
  ```javascript
  const content = postData.content || ''; // 본문만 저장
  await saveRawLog({
    content: content, // 빈 문자열이 저장됨
    // ...
  });
  ```

#### 2.2 RawLog → Issue 변환 단계
- **위치**: `backend/workers/rawLogProcessor.worker.js:44-105`
- **문제**: 빈 content가 그대로 Issue의 detail로 저장됨
  ```javascript
  let content = rawLog.content || ''; // 이미 비어있음
  // 제목 제거 로직 실행 (하지만 content가 이미 비어있음)
  // ...
  detail: post.content || '', // 빈 문자열이 저장됨
  ```

### 3. 시스템 전체 오류

#### 3.1 크롤러 오류
- ✅ **에러 핸들링**: 개별 게시글 실패 시에도 계속 진행 (정상)
- ❌ **본문 추출 실패**: 최근 10개 이상 게시글 본문 추출 실패
- ⚠️ **로깅**: 본문이 비어있을 때 경고 로그는 있지만, 실제 원인 파악이 어려움

#### 3.2 RawLog Processor 오류
- ✅ **에러 핸들링**: 개별 RawLog 실패 시에도 계속 진행 (정상)
- ❌ **빈 content 처리**: 빈 content를 그대로 Issue로 변환
- ⚠️ **검증 부재**: content가 비어있는지 확인하는 로직 없음

#### 3.3 Issue 서비스 오류
- ✅ **에러 핸들링**: 분류 실패 시 기본값 사용 (정상)
- ❌ **빈 detail 저장**: 빈 detail을 그대로 저장
- ⚠️ **검증 부재**: detail이 비어있는지 확인하는 로직 없음

---

## 🐛 발견된 구체적 오류

### 오류 1: 본문 추출 실패 (최우선)
- **위치**: `backend/workers/monitoring/naverCafe.worker.js:283-431`
- **증상**: 최근 10개 이상 RawLog의 content가 모두 비어있음
- **영향**: 사용자가 게시글 본문을 볼 수 없음

### 오류 2: 제목 제거 로직 과도
- **위치**: `backend/workers/monitoring/naverCafe.worker.js:320-345`
- **증상**: 본문에 제목이 포함되어 있으면 전체 제목을 제거하는데, 이때 본문의 일부가 제목과 유사하면 본문까지 제거될 수 있음
- **영향**: 본문이 제목과 유사한 경우 본문이 비어버림

### 오류 3: 대기 시간 부족
- **위치**: `backend/workers/monitoring/naverCafe.worker.js:270-280`
- **증상**: `waitForSelector`와 `waitForTimeout(2000)`만으로는 동적 콘텐츠 로드를 보장하지 못할 수 있음
- **영향**: 본문이 로드되기 전에 추출 시도

### 오류 4: 빈 content 검증 부재
- **위치**: `backend/workers/monitoring/naverCafe.worker.js:489-502`
- **증상**: 빈 content를 그대로 RawLog에 저장
- **영향**: 빈 content가 Issue로 변환됨

### 오류 5: 디버깅 정보 부족
- **위치**: `backend/workers/monitoring/naverCafe.worker.js:444-467`
- **증상**: 본문이 비어있을 때 경고 로그는 있지만, 실제 원인 파악이 어려움
- **영향**: 문제 해결이 어려움

---

## 🔧 해결 방안

### 방안 1: 본문 추출 로직 개선 (최우선)

#### 1.1 대기 시간 증가 및 재시도 로직 추가
```javascript
// se-main-container가 나타날 때까지 대기 (최대 15초, 재시도 3회)
let seMainContainer = null;
for (let retry = 0; retry < 3; retry++) {
  try {
    await page.waitForSelector('.se-main-container', { timeout: 15000 });
    seMainContainer = await page.$('.se-main-container');
    if (seMainContainer) break;
  } catch (e) {
    if (retry < 2) {
      await page.waitForTimeout(3000); // 3초 대기 후 재시도
    }
  }
}

// 추가 대기: 동적 콘텐츠 로드를 위해 (5초로 증가)
await page.waitForTimeout(5000);
```

#### 1.2 본문 추출 로직 개선
```javascript
// 방법 1: se-main-container 내부의 텍스트 요소들을 직접 수집
const seMainContainer = document.querySelector('.se-main-container');
if (seMainContainer) {
  // 전체 텍스트를 먼저 가져옴
  let collectedText = seMainContainer.textContent?.trim() || '';
  
  // 텍스트 요소들을 개별적으로 수집 (더 정확한 추출)
  const textElements = seMainContainer.querySelectorAll('.se-text, .se-component-text, .se-section-text, p, div[class*="se-"]');
  let elementTexts = [];
  
  textElements.forEach(el => {
    const text = el.textContent?.trim() || '';
    if (text && text.length > 1 && !text.match(/^[\s\n\r:]+$/)) {
      elementTexts.push(text);
    }
  });
  
  // 요소별 텍스트가 있으면 사용, 없으면 전체 텍스트 사용
  if (elementTexts.length > 0) {
    collectedText = elementTexts.join('\n');
  }
  
  // 제목 제거 로직 개선 (더 보수적으로)
  if (cleanTitle && cleanTitle.length > 0) {
    // 1. 본문이 제목으로 시작하는 경우만 제거
    if (collectedText.startsWith(cleanTitle)) {
      collectedText = collectedText.substring(cleanTitle.length).trim();
      collectedText = collectedText.replace(/^[\s\n\r:]+/, '').trim();
    }
    
    // 2. 본문이 제목과 완전히 동일한 경우만 제거
    if (collectedText === cleanTitle || collectedText.trim() === cleanTitle.trim()) {
      collectedText = '';
    }
    
    // 3. 본문이 제목의 일부만 포함하는 경우 (제목이 더 긴 경우)만 제거
    if (cleanTitle.length > collectedText.length && cleanTitle.includes(collectedText)) {
      collectedText = '';
    }
    
    // ⚠️ 본문에 제목이 포함되어 있는 경우는 제거하지 않음 (과도한 제거 방지)
  }
  
  // ": 네이버 카페" 제거
  collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
  collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*\n/g, '\n').trim();
  collectedText = collectedText.replace(/\s*:\s*네이버\s*카페\s*/g, '').trim();
  
  // 최소 길이 조건: 5자 이상이어야 저장 (1자 → 5자로 증가)
  if (collectedText.length >= 5) {
    content = collectedText;
    usedSelector = '.se-main-container (internal)';
  }
}
```

#### 1.3 빈 content 검증 추가
```javascript
// 본문이 비어있으면 RawLog에 저장하지 않음
if (!postData.content || postData.content.length < 5) {
  logger.warn('[NaverCafeWorker] Skipping post with empty content', {
    articleId,
    title: postData.title?.substring(0, 50),
    url: articleUrl
  });
  continue; // 이 게시글은 건너뛰기
}
```

### 방안 2: 디버깅 정보 강화

#### 2.1 상세 디버깅 로그 추가
```javascript
// 본문이 비어있으면 상세 디버깅 정보 로그
if (!postData.content || postData.content.length < 5) {
  const debugInfo = await page.evaluate(() => {
    const seMain = document.querySelector('.se-main-container');
    const articleView = document.querySelector('.article_view');
    const allSeElements = document.querySelectorAll('[class*="se-"]');
    
    return {
      hasSeMainContainer: !!seMain,
      seMainTextLength: seMain?.textContent?.trim().length || 0,
      seMainTextPreview: seMain?.textContent?.trim().substring(0, 200) || '(none)',
      hasArticleView: !!articleView,
      articleViewTextLength: articleView?.textContent?.trim().length || 0,
      allSeElementsCount: allSeElements.length,
      seElementsTexts: Array.from(allSeElements).slice(0, 5).map(el => ({
        className: el.className,
        textLength: el.textContent?.trim().length || 0,
        textPreview: el.textContent?.trim().substring(0, 100) || '(none)'
      })),
      pageTitle: document.title,
      pageUrl: window.location.href
    };
  });
  
  logger.error('[NaverCafeWorker] Content extraction failed - Detailed debug info', {
    articleId,
    title: postData.title?.substring(0, 50),
    contentLength: postData.content?.length || 0,
    usedSelector: postData.usedSelector || 'none',
    url: articleUrl,
    debugInfo
  });
}
```

### 방안 3: RawLog Processor 개선

#### 3.1 빈 content 검증 추가
```javascript
// content가 비어있으면 Issue로 변환하지 않음
if (!content || content.length < 5) {
  logger.warn('[RawLogProcessor] Skipping RawLog with empty content', {
    rawLogId: rawLog.id,
    title: title || '(no title)'
  });
  
  // isProcessed 플래그만 업데이트 (처리 완료로 표시하되 Issue로 변환하지 않음)
  await prisma.rawLog.update({
    where: { id: rawLog.id },
    data: { isProcessed: true }
  });
  
  return; // 이 RawLog는 건너뛰기
}
```

---

## 📊 우선순위

1. **최우선 (P0)**: 본문 추출 로직 개선
   - 대기 시간 증가 및 재시도 로직 추가
   - 본문 추출 로직 개선 (제목 제거 로직 보수적으로 변경)
   - 빈 content 검증 추가

2. **높음 (P1)**: 디버깅 정보 강화
   - 상세 디버깅 로그 추가
   - 문제 원인 파악을 위한 정보 수집

3. **중간 (P2)**: RawLog Processor 개선
   - 빈 content 검증 추가
   - 빈 content를 Issue로 변환하지 않도록 수정

---

## 🧪 테스트 계획

1. **단위 테스트**: 본문 추출 로직 개선 후 실제 네이버 카페 페이지에서 테스트
2. **통합 테스트**: 크롤러 재시작 후 최근 게시글 수집 확인
3. **검증**: RawLog의 content가 비어있지 않은지 확인

---

## 📝 참고 사항

- 네이버 카페 페이지 구조가 변경될 수 있으므로, 주기적으로 셀렉터 확인 필요
- 쿠키 만료 시 본문 추출이 실패할 수 있으므로, 쿠키 갱신 프로세스 필요
- 로그인 상태/권한 문제로 본문이 로드되지 않을 수 있으므로, 쿠키 유효성 확인 필요


















