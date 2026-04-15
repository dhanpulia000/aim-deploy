# 댓글 카운팅 로직 상세 설명

## 개요

댓글 카운팅은 **두 단계**로 이루어집니다:
1. **리스트 페이지에서 댓글 수 추출** (빠르고 안전)
2. **상세 페이지에서 실제 댓글 요소 카운팅** (핫토픽인 경우에만)

---

## 1. 리스트 페이지에서 댓글 수 추출

### 위치
`backend/workers/monitoring/naverCafe.worker.js` (라인 898-907)

### 로직

```javascript
// 댓글 수 추출 (다양한 셀렉터 시도)
let commentCount = 0;
const commentElement = row.querySelector(
  '.comment_count, .reply_count, .cmt_count, ' +
  '[class*="comment"], [class*="reply"], .comment, .reply'
);

if (commentElement) {
  const commentText = commentElement.textContent?.trim() || '';
  const match = commentText.match(/(\d+)/);  // 숫자만 추출
  if (match) {
    commentCount = parseInt(match[1], 10) || 0;
  }
}
```

### 동작 방식

1. **CSS 셀렉터로 댓글 수 요소 찾기**
   - 네이버 카페는 리스트 페이지의 각 게시글 행에 댓글 수를 표시
   - 다양한 클래스명을 시도: `.comment_count`, `.reply_count`, `.cmt_count` 등
   - `[class*="comment"]` 같은 부분 매칭도 시도

2. **텍스트에서 숫자 추출**
   - `textContent`로 요소의 텍스트 가져오기 (예: "댓글 15", "15", "15개")
   - 정규식 `/(\d+)/`으로 숫자만 추출
   - `parseInt()`로 정수로 변환

### 예시

네이버 카페 HTML 구조:
```html
<tr class="article-list-item">
  <td class="td_title">
    <a href="/articles/123456">게시글 제목</a>
  </td>
  <td class="td_comment">
    <span class="comment_count">15</span>
  </td>
</tr>
```

결과: `commentCount = 15`

### 장점
- ✅ **추가 페이지 방문 불필요** (리스트 페이지만 방문하면 됨)
- ✅ **빠름** (DOM 파싱만 수행)
- ✅ **봇 차단 위험 낮음** (리스트 페이지는 이미 방문해야 함)
- ✅ **모든 게시글의 댓글 수를 한 번에 수집 가능**

### 단점
- ⚠️ 셀렉터가 변경되면 실패할 수 있음 (다양한 셀렉터로 대응)
- ⚠️ HTML 구조가 변경되면 수정 필요

---

## 2. 상세 페이지에서 실제 댓글 요소 카운팅

### 위치
`backend/workers/monitoring/naverCafe.worker.js` (라인 1569-1630)

### 실행 조건
- **핫토픽인 경우에만** 실행 (댓글 수 >= 10개 또는 특정 작성자)
- 상세 페이지 방문 필요

### 로직

```javascript
const comments = await page.evaluate(() => {
  const comments = [];
  
  // 다양한 댓글 셀렉터 시도
  const commentSelectors = [
    '.CommentItem',
    '.comment_item',
    '.CommentBox .comment',
    '.comment_area .comment',
    'li[class*="comment"]',
    '.comment_list li',
    '[class*="Comment"]'
  ];
  
  for (const selector of commentSelectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      elements.forEach((el, index) => {
        const text = el.textContent?.trim() || '';
        const author = el.querySelector('.nickname, .nick, .author, [class*="nick"]')?.textContent?.trim() || '';
        
        if (text && text.length > 0) {
          comments.push({
            index: index + 1,
            author: author || '익명',
            text: text,
            date: ''
          });
        }
      });
      
      if (comments.length > 0) break; // 첫 번째 성공한 셀렉터 사용
    }
  }
  
  return comments;
});

// 실제 수집된 댓글 수로 업데이트
commentCount = comments.length;
```

### 동작 방식

1. **다양한 댓글 셀렉터 시도**
   - 네이버 카페의 다양한 댓글 HTML 구조에 대응
   - `.CommentItem`, `.comment_item`, `.CommentBox .comment` 등 여러 셀렉터 시도

2. **댓글 요소 개수 카운팅**
   - `querySelectorAll()`로 모든 댓글 요소 찾기
   - 찾은 요소들의 개수가 실제 댓글 수
   - 각 댓글의 내용도 함께 수집 (작성자, 텍스트 등)

3. **정확도**
   - 리스트 페이지의 숫자보다 **더 정확함**
   - 실제 DOM에 존재하는 댓글 개수를 카운팅
   - 삭제된 댓글 등은 카운트되지 않음

### 예시

네이버 카페 댓글 HTML 구조:
```html
<div class="CommentBox">
  <div class="CommentItem">
    <span class="nickname">작성자1</span>
    <div class="text">댓글 내용 1</div>
  </div>
  <div class="CommentItem">
    <span class="nickname">작성자2</span>
    <div class="text">댓글 내용 2</div>
  </div>
  <!-- ... 총 15개의 CommentItem -->
</div>
```

결과: `comments.length = 15` (실제 댓글 개수)

### 장점
- ✅ **정확함** (실제 DOM 요소 개수를 카운팅)
- ✅ **댓글 내용도 함께 수집** (작성자, 텍스트 등)
- ✅ **리스트 페이지 숫자와 검증 가능**

### 단점
- ⚠️ **상세 페이지 방문 필요** (추가 HTTP 요청)
- ⚠️ **느림** (페이지 로딩 시간 필요)
- ⚠️ **봇 차단 위험** (너무 많이 방문하면 차단 가능)

---

## 전체 흐름

```
1. 리스트 페이지 방문
   ↓
2. 각 게시글 행에서 댓글 수 추출 (DOM 파싱)
   - 예: "15" → commentCount = 15
   ↓
3. 핫토픽 판단
   - commentCount >= 10? → isHotTopic = true
   ↓
4. 핫토픽인 경우에만
   ↓
5. 상세 페이지 방문
   ↓
6. 실제 댓글 요소 카운팅
   - querySelectorAll('.CommentItem').length
   - 예: 15개 요소 → commentCount = 15 (업데이트)
   ↓
7. 댓글 내용 수집 (scrapedComments)
```

---

## 왜 이렇게 설계했나?

### 리스트 페이지 추출 (1단계)
- **모든 게시글**의 댓글 수를 빠르게 확인
- 추가 페이지 방문 없이 한 번에 처리
- 핫토픽 판단에 사용

### 상세 페이지 카운팅 (2단계)
- **핫토픽인 경우에만** 실행
- 실제 댓글 수 확인 및 댓글 내용 수집
- 정확도 향상

### 최적화
- 불필요한 상세 페이지 방문 최소화
- 봇 차단 위험 감소
- 효율적인 리소스 사용

---

## 실제 사용 예시

### 시나리오: 100개 게시글 스캔

1. **리스트 페이지 1회 방문**
   - 100개 게시글의 댓글 수 모두 추출
   - 예: [0, 3, 15, 8, 0, 25, ...]

2. **핫토픽 판단**
   - 10개 이상: 약 2-5개 게시글
   - 예: [15, 25, 30, 12] → 4개

3. **상세 페이지 방문**
   - 4개 게시글만 상세 페이지 방문
   - 실제 댓글 수 확인 및 내용 수집

**결과**: 총 5회 페이지 방문 (리스트 1회 + 상세 4회)

---

## 기술적 세부사항

### 정규식 패턴
```javascript
/(\d+)/  // 숫자가 하나 이상 연속으로 나타나는 패턴
```
- "댓글 15" → "15" 추출
- "15개" → "15" 추출
- "15" → "15" 추출

### 셀렉터 우선순위
1. 구체적인 클래스명 시도 (`.comment_count`)
2. 부분 매칭 시도 (`[class*="comment"]`)
3. 여러 셀렉터를 OR로 결합 (`,` 사용)

### 오류 처리
- 셀렉터 실패 시 다음 셀렉터 시도
- 댓글 영역을 찾지 못하면 `commentCount = 0`으로 설정
- 실패해도 전체 프로세스 중단하지 않음





