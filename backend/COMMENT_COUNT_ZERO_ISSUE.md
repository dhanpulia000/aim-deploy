# 댓글 수가 0으로 표시되는 문제 분석

## 현재 상황

- **전체 이슈**: 854개
- **댓글이 있는 이슈**: 0개 (모든 이슈의 `commentCount = 0`)
- **문제**: 기존 크롤링된 이슈들의 댓글 수가 모두 0으로 저장됨

## 가능한 원인

### 1. HTML 구조 변경
네이버 카페의 HTML 구조가 변경되어 기존 셀렉터가 작동하지 않았을 수 있습니다.

### 2. 셀렉터 부족
기존 셀렉터가 너무 제한적이어서 실제 댓글 수가 표시된 요소를 찾지 못했을 수 있습니다.

### 3. 크롤링 시점
크롤링 당시 실제로 댓글이 없었을 가능성도 있습니다.

## 해결 방안

### ✅ 1. 셀렉터 개선 (완료)

**개선 전:**
```javascript
const commentElement = row.querySelector(
  '.comment_count, .reply_count, .cmt_count, ' +
  '[class*="comment"], [class*="reply"], .comment, .reply'
);
```

**개선 후:**
```javascript
// 1차 시도: 명확한 클래스명
let commentElement = row.querySelector(
  '.comment_count, .reply_count, .cmt_count, .td_comment, .td_reply'
);

// 2차 시도: 부분 매칭
if (!commentElement) {
  commentElement = row.querySelector(
    '[class*="comment"], [class*="reply"], [class*="Comment"], [class*="Reply"]'
  );
}

// 3차 시도: td 요소 중 숫자만 있는 셀 찾기
if (!commentElement) {
  const cells = row.querySelectorAll('td');
  for (const cell of cells) {
    const text = cell.textContent?.trim() || '';
    if (text.match(/^\d+$/) || text.match(/댓글\s*\d+|답글\s*\d+/i)) {
      commentElement = cell;
      break;
    }
  }
}
```

**개선 사항:**
- 더 많은 클래스명 시도 (`.td_comment`, `.td_reply` 등)
- td 요소 전체를 검색하여 숫자만 있는 셀 찾기
- "댓글 N" 형식도 인식

### 2. 기존 이슈 업데이트

**옵션 A: 백필 크롤링**
- `naverCafeBackfill.worker.js`를 사용하여 기존 이슈들을 다시 크롤링
- 개선된 셀렉터로 댓글 수를 다시 추출

**옵션 B: 수동 테스트 후 결정**
- 실제 네이버 카페 페이지에서 테스트하여 셀렉터가 작동하는지 확인
- 작동 확인 후 백필 진행

### 3. 테스트 스크립트 실행

테스트 스크립트가 준비되어 있습니다:
```bash
node backend/scripts/check-comment-extraction.js
```

이 스크립트는:
- 실제 네이버 카페 리스트 페이지를 방문
- 현재 셀렉터로 댓글 수 추출 시도
- 각 게시글의 HTML 구조와 추출 결과를 출력
- 문제점 파악에 도움

## 다음 단계

1. ✅ **셀렉터 개선 완료** (naverCafe.worker.js, naverCafeBackfill.worker.js)
2. **테스트 스크립트 실행** (선택사항, 실제 구조 확인용)
3. **새로운 크롤링 실행** (개선된 셀렉터로 댓글 수 정상 추출 확인)
4. **기존 이슈 백필** (필요한 경우)

## 참고사항

- 새로운 크롤링에서는 개선된 셀렉터가 사용됩니다
- 기존 이슈들은 다음 크롤링 시 자동으로 업데이트됩니다
- 또는 백필 워커를 사용하여 기존 이슈들을 재크롤링할 수 있습니다





