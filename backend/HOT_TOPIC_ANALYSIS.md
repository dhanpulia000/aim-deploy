# 댓글 수 불꽃 표기 기능 분석 결과

## 현재 구현 상태

### 1. 백엔드 로직

**파일**: `backend/workers/monitoring/naverCafe.worker.js`

```javascript
// 라인 90: 댓글 수 임계값 설정
const HOT_TOPIC_THRESHOLD = parseInt(process.env.NAVER_CAFE_HOT_TOPIC_THRESHOLD) || 30;

// 라인 1495-1498: 핫토픽 판단 로직
const isWatchedAuthor = postInfo.author && WATCH_AUTHORS.includes(postInfo.author);
const isHighCommentCount = commentCount >= HOT_TOPIC_THRESHOLD;
isHotTopic = isWatchedAuthor || isHighCommentCount;
```

**동작 방식**:
- 기본값: 30개 이상의 댓글이 있으면 `isHotTopic = true`
- 환경 변수 `NAVER_CAFE_HOT_TOPIC_THRESHOLD`로 변경 가능
- 특정 작성자(`WATCH_AUTHORS`)의 글도 자동으로 핫토픽 처리
- DB의 `ReportItemIssue.isHotTopic` 필드에 저장

### 2. 프론트엔드 로직

**파일**: 
- `src/components/TicketCard.tsx` (라인 138)
- `src/components/TicketListRow.tsx` (라인 79)

```typescript
const isHot = ticket.isHotTopic || (ticket.commentsCount && ticket.commentsCount >= 30);
```

**표시 방식**:
- `isHot === true`: 🔥 아이콘 + 빨간색 배경 (`bg-red-100 text-red-700 border-red-300`)
- `isHot === false`: 💬 아이콘 + 보라색 배경 (`bg-purple-100 text-purple-700`)

### 3. 데이터베이스 스키마

**필드**: 
- `ReportItemIssue.commentCount` (INTEGER): 댓글 개수
- `ReportItemIssue.isHotTopic` (INTEGER/Boolean): 핫토픽 여부

### 4. API 응답

**파일**: `backend/services/issues.service.js` (라인 398-400)

```javascript
commentsCount: issue.commentCount || commentCounts[issue.id] || 0,
scrapedComments: issue.scrapedComments || null,
isHotTopic: Boolean(issue.isHotTopic),
```

## 발견된 문제점

### ⚠️ 임계값 불일치 가능성

1. **현재 임계값**: 30개 (기본값)
2. **사용자 요구사항**: 5개 이상
3. **코드 일관성**: 
   - 백엔드: `HOT_TOPIC_THRESHOLD = 30`
   - 프론트엔드: 하드코딩된 `>= 30`

### 🔍 확인 필요 사항

1. **환경 변수 설정 확인**
   - `NAVER_CAFE_HOT_TOPIC_THRESHOLD` 환경 변수가 설정되어 있는지
   - 실제 운영 환경에서 어떤 값이 사용되고 있는지

2. **데이터 일관성**
   - DB에 저장된 `isHotTopic` 값과 실제 `commentCount`가 일치하는지
   - 5-29개 댓글을 가진 이슈들이 잘못 표시되지 않는지

3. **프론트엔드/백엔드 동기화**
   - 프론트엔드에 하드코딩된 `>= 30` 조건이 백엔드 설정과 일치하는지

## 권장 수정 사항

### 1. 5개 이상으로 변경하려는 경우

**백엔드** (`naverCafe.worker.js`):
```javascript
const HOT_TOPIC_THRESHOLD = parseInt(process.env.NAVER_CAFE_HOT_TOPIC_THRESHOLD) || 5; // 30 → 5로 변경
```

**프론트엔드** (`TicketCard.tsx`, `TicketListRow.tsx`):
```typescript
const isHot = ticket.isHotTopic || (ticket.commentsCount && ticket.commentsCount >= 5); // 30 → 5로 변경
```

**또는 환경 변수로 관리** (더 권장):
- 백엔드: 환경 변수 사용 (이미 구현됨)
- 프론트엔드: API에서 임계값을 응답에 포함시켜 동적으로 사용

### 2. 기존 데이터 업데이트 (선택사항)

5개 이상의 댓글을 가진 기존 이슈들의 `isHotTopic` 필드를 업데이트하려면:
```sql
UPDATE ReportItemIssue 
SET isHotTopic = 1 
WHERE commentCount >= 5 AND isHotTopic = 0;
```

## 현재 코드 상태 평가

✅ **정상 작동 가능한 부분**:
- 로직 구조는 일관성 있게 구현됨
- 백엔드에서 `isHotTopic` 설정 및 저장
- 프론트엔드에서 불꽃 표기 렌더링
- API에서 필요한 데이터 전달

⚠️ **주의 필요**:
- 임계값이 30으로 하드코딩되어 있음 (5개 이상 요구사항과 불일치)
- 프론트엔드와 백엔드의 임계값이 분리되어 있어 불일치 가능성

## 검증 방법

1. **백엔드 로그 확인**:
   ```
   [NaverCafeWorker] Comment collection decision
   - commentCount: 실제 댓글 수
   - isHotTopic: true/false
   ```

2. **데이터베이스 확인**:
   ```sql
   SELECT id, summary, commentCount, isHotTopic 
   FROM ReportItemIssue 
   WHERE commentCount BETWEEN 5 AND 29 
   ORDER BY commentCount DESC;
   ```

3. **프론트엔드 확인**:
   - 5-29개 댓글을 가진 이슈가 어떻게 표시되는지 확인
   - 🔥 또는 💬 중 어떤 아이콘이 표시되는지 확인





