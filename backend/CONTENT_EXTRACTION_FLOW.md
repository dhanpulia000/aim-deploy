# 본문 추출 과정 (최근 게시글 기준)

## 현재 문제점
- 최근 게시글들의 RawLog content가 비어있음
- Issue의 detail에는 제목이 저장됨 (본문 추출 실패로 제목을 본문으로 사용)

## 본문 추출 과정

### 1단계: 페이지 로드 및 팝업 감지
- 상세 페이지 진입
- JavaScript 다이얼로그 감지 (`page.on('dialog')`)
- 모달/팝업 요소 감지 (`.layer_login`, `.login_layer` 등)
- **결과**: `detectedLoginDialog` 또는 `detectedLoginModal` 플래그 설정

### 2단계: 로그인 필요 여부 판단
- **팝업/다이얼로그 감지에만 의존** (최근 수정)
- 팝업이 감지되면 `requiresLogin = true`
- 팝업이 감지되지 않으면 `requiresLogin = false`

### 3단계: 본문 추출 (requiresLogin이 false이거나 쿠키가 있는 경우)
- iframe 컨텍스트 확인
- `postData = await contextToUse.evaluate(...)` 실행

#### 3-1. 제목 추출
```javascript
const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
             document.querySelector('.title_text, .article_title, .ArticleTitle')?.textContent?.trim() ||
             document.title;
const cleanTitle = title.replace(/\s*:\s*네이버\s*카페\s*$/i, '').trim();
```

#### 3-2. 본문 추출 (우선순위 순)
1. **`.se-main-container` 내부 텍스트 수집**
   - `elementTextsArray` 사용 (Playwright에서 수집)
   - 또는 DOM에서 직접 수집 (`.se-text`, `.se-component-text` 등)
   - 중복 제거 후 `join('\n')`

2. **제목 제거 로직** (본문 추출 단계)
   - 본문이 제목으로 시작하는 경우
   - 제거 후 남은 본문이 **3자 이상**일 때만 제거
   - 제거 후 남은 본문이 3자 미만이면 제거하지 않음

3. **최소 길이 체크**
   - `collectedText.length >= 3`이면 `content`에 저장
   - 제목과 동일한 경우는 나중에 처리하므로 여기서는 길이만 확인

4. **Fallback 셀렉터 시도** (`.se-main-container`가 실패한 경우)
   - `.article_view .se-main-container`
   - `.ContentRenderer`
   - `#articleBodyContents`
   - `.ArticleContent`
   - 등등...

5. **Legacy fallback** (iframe 전체 텍스트)
   - iframe 컨텍스트를 사용하지 않은 경우에만 시도

6. **Aggressive fallback** (더 많은 셀렉터 시도)
   - 공개 게시글인 경우에만 시도

### 4단계: 제목 제거 로직 (본문 추출 후)
- 원본 본문 백업 (`originalContent`)
- 제목과 본문이 동일한 경우 본문 제거
- **단, 이미지가 있는 경우에는 본문 보존**
- 본문이 제목으로 시작하는 경우 제목 부분 제거
- 제거 후 남은 본문이 3자 미만이면 빈 문자열

### 5단계: 본문이 비어있을 때 처리
- `requiresLogin = true`인 경우: 본문 비워둠
- `requiresLogin = false`인 경우:
  - 이미지가 있는 경우: 제목을 본문으로 사용 또는 `[이미지/미디어 포함]`
  - 이미지가 없는 경우: 제목을 본문으로 사용 또는 `[이미지/미디어 포함]`

## 문제점 분석

### 문제 1: 로그인 필요로 잘못 판단
- 팝업이 감지되지 않았는데도 로그인 필요로 판단되는 경우
- **해결**: 팝업 감지에만 의존하도록 수정 완료

### 문제 2: 본문 추출 실패
- `.se-main-container`를 찾지 못하거나
- 본문이 제목과 동일해서 제거되거나
- 제목 제거 후 남은 본문이 3자 미만이어서 제거됨

### 문제 3: 제목 제거가 너무 적극적
- 본문 추출 단계에서 제목 제거
- 본문 추출 후에도 제목 제거
- 두 단계 모두에서 제거되어 본문이 비워짐

## 개선 방안

1. **본문 추출 단계에서 제목 제거 완화**
   - 제거 후 남은 본문이 3자 이상일 때만 제거 (현재 적용됨)
   - 이미지가 있는 경우 본문 보존 (현재 적용됨)

2. **본문 추출 후 제목 제거 로직 개선**
   - 이미지가 있는 경우 본문 보존 (현재 적용됨)
   - 원본 본문 백업 및 복원 (현재 적용됨)

3. **로그인 필요 판단 개선**
   - 팝업 감지에만 의존 (현재 적용됨)





