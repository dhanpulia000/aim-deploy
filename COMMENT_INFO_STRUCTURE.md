# 댓글 정보 UI 표시 구조 및 데이터 필드 정리

## 📋 목차
1. [데이터베이스 스키마](#1-데이터베이스-스키마)
2. [데이터 수집 과정](#2-데이터-수집-과정)
3. [백엔드 API 응답 구조](#3-백엔드-api-응답-구조)
4. [프론트엔드 타입 정의](#4-프론트엔드-타입-정의)
5. [데이터 변환 과정](#5-데이터-변환-과정)
6. [UI 표시 로직](#6-ui-표시-로직)
7. [오류 검토 체크리스트](#7-오류-검토-체크리스트)

---

## 1. 데이터베이스 스키마

### `ReportItemIssue` 모델 (Prisma Schema)

```prisma
model ReportItemIssue {
  // ... 기타 필드들 ...
  
  // 댓글 동향 정보 (네이버 카페 크롤링)
  commentCount    Int     @default(0) // 댓글 개수
  scrapedComments String? // 수집된 댓글 리스트를 JSON 문자열로 저장 (Text 타입)
  isHotTopic      Boolean @default(false) // 댓글이 많거나 중요 인물의 글인 경우 True
  
  // ... 기타 필드들 ...
}
```

### 필드 설명

| 필드명 | 타입 | 설명 | 기본값 |
|--------|------|------|--------|
| `commentCount` | `Int` | 크롤러가 수집한 댓글 개수 | `0` |
| `scrapedComments` | `String?` | 수집된 댓글을 JSON 문자열로 저장 | `null` |
| `isHotTopic` | `Boolean` | 핫토픽 여부 (댓글 30개 이상 또는 중요 인물의 글) | `false` |

### `scrapedComments` JSON 구조

```json
[
  {
    "index": 1,
    "author": "작성자닉네임",
    "text": "댓글 내용",
    "date": "2023.11.29. 14:00"
  },
  {
    "index": 2,
    "author": "다른작성자",
    "text": "댓글 내용2",
    "date": "2023.11.29. 14:05"
  }
]
```

---

## 2. 데이터 수집 과정

### 2.1 크롤러 단계 (`backend/workers/monitoring/naverCafe.worker.js`)

**위치**: `scanBoard` 함수 내부, 게시글 상세 페이지 크롤링 시

```javascript
// 댓글 추출 (라인 869-944)
const comments = await page.evaluate(() => {
  // 페이지에서 댓글 요소들을 찾아서 추출
  // 반환 형식: Array<{ index, author, text, date }>
});

if (comments && comments.length > 0) {
  scrapedComments = JSON.stringify(comments);
  commentCount = comments.length;
  isHotTopic = true; // 또는 댓글 수가 HOT_TOPIC_THRESHOLD(30) 이상일 때
}
```

**저장**: `saveRawLog` 함수 호출 시 metadata에 포함
```javascript
await saveRawLog({
  // ... 기타 필드들 ...
  commentCount: commentCount || 0,
  scrapedComments: scrapedComments || null,
  isHotTopic: isHotTopic || false
});
```

### 2.2 RawLog → Issue 승격 단계 (`backend/workers/rawLogProcessor.worker.js`)

**위치**: `processRawLog` 함수 내부

```javascript
// metadata에서 댓글 정보 추출 (라인 47-50)
const commentCount = metadata.commentCount || 0;
const scrapedComments = metadata.scrapedComments || null;
const isHotTopic = metadata.isHotTopic || false;

// upsertIssueFromNaverCafe 호출 시 전달 (라인 156-166)
await upsertIssueFromNaverCafe({
  // ... 기타 필드들 ...
  commentCount: commentCount,
  scrapedComments: scrapedComments,
  isHotTopic: isHotTopic
});
```

### 2.3 Issue 저장 단계 (`backend/services/naverCafeIssues.service.js`)

**위치**: `upsertIssueFromNaverCafe` 함수 내부

```javascript
// issueData 객체에 포함 (라인 217-220)
const issueData = {
  // ... 기타 필드들 ...
  commentCount: commentCount || 0,
  scrapedComments: scrapedComments || null,
  isHotTopic: isHotTopic || false
};

// 새 Issue 생성 시
await prisma.reportItemIssue.create({
  data: issueData
});

// 기존 Issue 업데이트 시 (라인 271-273)
await prisma.reportItemIssue.update({
  where: { id: issue.id },
  data: {
    // ... 기타 필드들 ...
    commentCount: issueData.commentCount,
    scrapedComments: issueData.scrapedComments,
    isHotTopic: issueData.isHotTopic
  }
});
```

---

## 3. 백엔드 API 응답 구조

### 3.1 API 엔드포인트

**경로**: `GET /api/issues`

**서비스 함수**: `backend/services/issues.service.js` → `getAllIssues`

### 3.2 Prisma 쿼리

```javascript
const issues = await prisma.reportItemIssue.findMany({
  where: { /* 필터 조건 */ },
  include: {
    report: { select: { agentId: true } },
    assignedAgent: { select: { id: true, name: true } },
    categoryGroup: true,
    category: true,
    monitoredBoard: { select: { id: true, cafeGame: true, name: true } },
    _count: { select: { comments: true } } // IssueComment 테이블의 댓글 개수
  },
  // ... 기타 옵션들 ...
});
```

**중요**: `include`를 사용하므로 기본 필드(`commentCount`, `scrapedComments`, `isHotTopic`)는 자동으로 포함됩니다.

### 3.3 응답 데이터 변환

```javascript
const categorizedIssues = issues.map(issue => {
  return {
    ...issue, // 모든 필드 포함 (commentCount, scrapedComments, isHotTopic 포함)
    status: normalizeStatus(issue.status),
    categories,
    primaryCategory,
    agentId: issue.report.agentId,
    assignedAgentName: issue.assignedAgent?.name || null,
    // commentCount 우선순위: DB의 commentCount 필드 > IssueComment 테이블의 개수
    commentsCount: issue.commentCount || issue._count?.comments || 0,
    // 댓글 정보 추가 (라인 293-295)
    scrapedComments: issue.scrapedComments || null,
    isHotTopic: issue.isHotTopic || false
  };
});
```

### 3.4 최종 API 응답 형식

```json
{
  "success": true,
  "data": {
    "issues": [
      {
        "id": "cmxxx...",
        "summary": "게시글 제목",
        "detail": "게시글 내용",
        "commentCount": 15,
        "scrapedComments": "[{\"index\":1,\"author\":\"작성자\",\"text\":\"댓글내용\",\"date\":\"2023.11.29. 14:00\"},...]",
        "isHotTopic": false,
        "commentsCount": 15, // 프론트엔드용 (commentCount와 동일)
        // ... 기타 필드들 ...
      }
    ],
    "total": 100,
    "limit": 1000,
    "offset": 0
  }
}
```

---

## 4. 프론트엔드 타입 정의

### 4.1 `Ticket` 인터페이스 (`src/types/index.ts`)

```typescript
export interface Ticket {
  // ... 기타 필드들 ...
  commentsCount?: number;        // 댓글 개수
  scrapedComments?: string | null; // 수집된 댓글 JSON 문자열
  isHotTopic?: boolean;           // 핫토픽 여부 (댓글이 많거나 중요 인물의 글)
  // ... 기타 필드들 ...
}
```

### 4.2 필드 설명

| 필드명 | 타입 | 설명 | 소스 |
|--------|------|------|------|
| `commentsCount` | `number?` | 댓글 개수 | API의 `commentsCount` 또는 `commentCount` |
| `scrapedComments` | `string \| null?` | 수집된 댓글 JSON 문자열 | API의 `scrapedComments` |
| `isHotTopic` | `boolean?` | 핫토픽 여부 | API의 `isHotTopic` |

---

## 5. 데이터 변환 과정

### 5.1 API 응답 → Ticket 변환 (`src/App.tsx`)

**위치**: `loadData` 함수 내부, `convertedTickets` 매핑 (라인 609-730)

```typescript
const convertedTickets: Ticket[] = issues.map((issue: any): Ticket => {
  return {
    // ... 기타 필드들 ...
    commentsCount: issue.commentsCount || issue._count?.comments || 0,
    scrapedComments: issue.scrapedComments || null,
    isHotTopic: issue.isHotTopic || false,
    // ... 기타 필드들 ...
  };
});
```

### 5.2 데이터 흐름 다이어그램

```
[크롤러] 
  ↓ (댓글 수집)
[RawLog] 
  ↓ (metadata에 JSON 저장)
[RawLogProcessor] 
  ↓ (metadata 파싱)
[naverCafeIssues.service] 
  ↓ (issueData에 포함)
[Prisma DB] 
  ↓ (ReportItemIssue 테이블 저장)
[issues.service] 
  ↓ (getAllIssues 조회)
[API 응답] 
  ↓ (JSON)
[App.tsx] 
  ↓ (Ticket 변환)
[UI 컴포넌트] 
  ↓ (표시)
[사용자 화면]
```

---

## 6. UI 표시 로직

### 6.1 `TicketCard` 컴포넌트 (`src/components/TicketCard.tsx`)

**위치**: 라인 137-141

```typescript
{ticket.commentsCount && ticket.commentsCount > 0 && (() => {
  const isHot = ticket.isHotTopic || (ticket.commentsCount && ticket.commentsCount >= 30);
  const commentTooltip = (() => {
    if (!ticket.scrapedComments) return `댓글 ${ticket.commentsCount}개`;
    try {
      const comments = JSON.parse(ticket.scrapedComments);
      if (Array.isArray(comments) && comments.length > 0) {
        const preview = comments.slice(0, 3).map((c: any, idx: number) => 
          `${idx + 1}. ${c.author || '익명'}: ${(c.text || c.content || '').substring(0, 30)}${(c.text || c.content || '').length > 30 ? '...' : ''}`
        ).join('\n');
        return `댓글 ${ticket.commentsCount}개\n\n[주요 댓글]\n${preview}`;
      }
    } catch (e) {
      // JSON 파싱 실패 시 기본 툴팁
    }
    return `댓글 ${ticket.commentsCount}개`;
  })();
  
  return (
    <span 
      className={classNames(
        "px-1.5 py-0.5 rounded-full text-[10px] flex-shrink-0 font-semibold",
        isHot 
          ? "bg-red-100 text-red-700 border border-red-300" 
          : "bg-purple-100 text-purple-700"
      )}
      title={commentTooltip}
    >
      {isHot ? '🔥' : '💬'} {ticket.commentsCount}
    </span>
  );
})()}
```

### 6.2 `TicketListRow` 컴포넌트 (`src/components/TicketListRow.tsx`)

**위치**: 라인 80-84

동일한 로직이 적용됩니다.

### 6.3 표시 조건

| 조건 | 아이콘 | 색상 | 표시 여부 |
|------|--------|------|-----------|
| `commentsCount === 0` 또는 `undefined` | - | - | 숨김 |
| `commentsCount > 0` && `!isHot` && `commentsCount < 30` | 💬 | 보라색 (`bg-purple-100 text-purple-700`) | 표시 |
| `isHotTopic === true` 또는 `commentsCount >= 30` | 🔥 | 빨간색 (`bg-red-100 text-red-700 border-red-300`) | 표시 |

### 6.4 툴팁 로직

1. **`scrapedComments`가 없는 경우**:
   - 툴팁: `"댓글 N개"`

2. **`scrapedComments`가 있는 경우**:
   - JSON 파싱 시도
   - 성공 시: 상위 3개 댓글 미리보기
     ```
     댓글 15개
     
     [주요 댓글]
     1. 작성자1: 댓글 내용 (최대 30자)...
     2. 작성자2: 댓글 내용 (최대 30자)...
     3. 작성자3: 댓글 내용 (최대 30자)...
     ```
   - 실패 시: `"댓글 N개"`

---

## 7. 오류 검토 체크리스트

### 7.1 데이터베이스 레벨

- [ ] `ReportItemIssue` 테이블에 `commentCount`, `scrapedComments`, `isHotTopic` 컬럼이 존재하는가?
- [ ] 기존 데이터에 이 필드들이 제대로 저장되어 있는가?
- [ ] `scrapedComments`가 JSON 형식으로 올바르게 저장되는가?

**확인 방법**:
```sql
SELECT id, summary, commentCount, scrapedComments, isHotTopic 
FROM ReportItemIssue 
WHERE commentCount > 0 
LIMIT 5;
```

### 7.2 크롤러 레벨

- [ ] `naverCafe.worker.js`에서 댓글을 제대로 수집하는가?
- [ ] `saveRawLog` 호출 시 `commentCount`, `scrapedComments`, `isHotTopic`이 전달되는가?
- [ ] `scrapedComments`가 올바른 JSON 형식으로 저장되는가?

**확인 방법**: 크롤러 로그에서 다음 메시지 확인
```
[NaverCafeWorker] Comments scraped
```

### 7.3 RawLog Processor 레벨

- [ ] `rawLogProcessor.worker.js`에서 metadata에서 댓글 정보를 제대로 추출하는가?
- [ ] `upsertIssueFromNaverCafe` 호출 시 댓글 정보가 전달되는가?

**확인 방법**: RawLog Processor 로그 확인
```
[RawLogProcessor] Comment info extracted
```

### 7.4 Issue Service 레벨

- [ ] `naverCafeIssues.service.js`에서 `issueData`에 댓글 정보가 포함되는가?
- [ ] DB 저장 시 댓글 정보가 올바르게 저장되는가?
- [ ] 기존 Issue 업데이트 시 댓글 정보도 업데이트되는가?

**확인 방법**: Issue Service 로그 확인
```
[NaverCafeIssues] New issue created
[NaverCafeIssues] Issue updated
```

### 7.5 API 레벨

- [ ] `issues.service.js`의 `getAllIssues`에서 댓글 정보가 조회되는가?
- [ ] API 응답에 `commentCount`, `scrapedComments`, `isHotTopic`이 포함되는가?

**확인 방법**: 브라우저 개발자 도구 → Network 탭 → `/api/issues` 응답 확인

**예상 응답**:
```json
{
  "success": true,
  "data": {
    "issues": [
      {
        "id": "...",
        "commentCount": 15,
        "scrapedComments": "[{...}]",
        "isHotTopic": false,
        "commentsCount": 15,
        // ...
      }
    ]
  }
}
```

### 7.6 프론트엔드 타입 레벨

- [ ] `Ticket` 인터페이스에 `commentsCount`, `scrapedComments`, `isHotTopic` 필드가 정의되어 있는가?
- [ ] 타입이 올바른가? (`number?`, `string | null?`, `boolean?`)

**확인 방법**: `src/types/index.ts` 파일 확인

### 7.7 데이터 변환 레벨

- [ ] `App.tsx`에서 API 응답을 `Ticket`으로 변환할 때 댓글 정보가 매핑되는가?
- [ ] `commentsCount` 우선순위가 올바른가? (DB의 `commentCount` > `_count.comments`)

**확인 방법**: `src/App.tsx` 라인 672-675 확인

### 7.8 UI 표시 레벨

- [ ] `TicketCard`와 `TicketListRow`에서 댓글이 표시되는가?
- [ ] 댓글이 0개일 때 숨겨지는가?
- [ ] 핫토픽일 때 🔥 아이콘과 빨간색으로 표시되는가?
- [ ] 툴팁이 제대로 작동하는가?
- [ ] `scrapedComments` JSON 파싱이 실패해도 크래시가 발생하지 않는가?

**확인 방법**: 브라우저에서 이슈 리스트 확인

---

## 8. 빠른 진단 방법 (1단계: API 응답 확인)

### 8.1 브라우저 개발자 도구로 확인 (가장 빠름)

1. **브라우저에서 F12 키를 눌러 개발자 도구 열기**
2. **Network 탭 선택**
3. **페이지 새로고침 (F5)**
4. **`/api/issues` 요청 찾기**
5. **Response 탭에서 응답 확인**

#### 성공 케이스 (프론트엔드 문제)
```json
{
  "success": true,
  "data": {
    "issues": [
      {
        "id": "...",
        "commentCount": 15,        // ✅ 1 이상
        "scrapedComments": "[{...}]", // ✅ JSON 문자열 존재
        "isHotTopic": false,
        "commentsCount": 15,
        // ...
      }
    ]
  }
}
```
→ **결론**: 백엔드는 정상, 프론트엔드 렌더링 문제

#### 실패 케이스 (백엔드 문제)
```json
{
  "success": true,
  "data": {
    "issues": [
      {
        "id": "...",
        "commentCount": 0,         // ❌ 전부 0
        "scrapedComments": null,   // ❌ null 또는 필드 없음
        // ...
      }
    ]
  }
}
```
→ **결론**: 백엔드 조회 문제 (DB에 데이터가 없거나 조회 로직 문제)

### 8.2 백엔드 디버깅

**로그 확인**:
```bash
# 크롤러 로그
grep "Comments scraped" backend/logs/*.log

# RawLog Processor 로그
grep "Comment info extracted" backend/logs/*.log

# Issue Service 로그
grep "New issue created\|Issue updated" backend/logs/*.log
```

**DB 직접 확인**:
```sql
-- 댓글이 있는 이슈 확인
SELECT id, summary, commentCount, isHotTopic, 
       LENGTH(scrapedComments) as commentsLength
FROM ReportItemIssue 
WHERE commentCount > 0 
ORDER BY commentCount DESC 
LIMIT 10;

-- scrapedComments 내용 확인 (JSON 형식)
SELECT id, summary, commentCount, scrapedComments
FROM ReportItemIssue 
WHERE scrapedComments IS NOT NULL 
LIMIT 5;
```

### 8.3 프론트엔드 디버깅

**브라우저 콘솔**:
```javascript
// API 응답 확인
fetch('/api/issues').then(r => r.json()).then(data => {
  const issues = data.data?.issues || data.issues || [];
  const withComments = issues.filter(i => (i.commentCount || i.commentsCount || 0) > 0);
  console.log('전체 이슈 수:', issues.length);
  console.log('댓글이 있는 이슈 수:', withComments.length);
  console.log('댓글 정보 샘플:', withComments.slice(0, 3).map(i => ({
    id: i.id,
    title: i.summary,
    commentCount: i.commentCount,
    commentsCount: i.commentsCount,
    hasScrapedComments: !!i.scrapedComments,
    isHotTopic: i.isHotTopic
  })));
});

// Ticket 변환 확인 (App.tsx에서)
// React DevTools에서 convertedTickets 배열 확인
```

**React DevTools**:
- `TicketCard` 또는 `TicketListRow` 컴포넌트의 props 확인
- `ticket.commentsCount`, `ticket.scrapedComments`, `ticket.isHotTopic` 값 확인

---

## 9. 일반적인 오류 및 해결 방법

### 오류 1: 댓글이 표시되지 않음

**원인**:
- DB에 `commentCount`가 0이거나 null
- API 응답에 필드가 없음
- 프론트엔드 매핑 누락

**해결**:
1. DB에서 `commentCount` 값 확인
2. API 응답 확인 (Network 탭)
3. `App.tsx`의 매핑 로직 확인

### 오류 2: 핫토픽 표시가 안 됨

**원인**:
- `isHotTopic` 필드가 false
- 댓글 수가 30개 미만

**해결**:
1. 크롤러에서 `isHotTopic` 설정 로직 확인
2. `HOT_TOPIC_THRESHOLD` 값 확인 (기본값: 30)

### 오류 3: 툴팁이 표시되지 않음

**원인**:
- `scrapedComments`가 null
- JSON 파싱 실패

**해결**:
1. DB에서 `scrapedComments` 값 확인
2. JSON 형식이 올바른지 확인
3. 브라우저 콘솔에서 파싱 에러 확인

### 오류 4: JSON 파싱 에러

**원인**:
- `scrapedComments`가 올바른 JSON 형식이 아님
- 크롤러에서 잘못된 형식으로 저장

**해결**:
1. 크롤러의 `JSON.stringify` 로직 확인
2. DB에 저장된 `scrapedComments` 형식 확인
3. try-catch로 에러 처리 확인

---

## 10. 테스트 시나리오

### 시나리오 1: 댓글이 없는 이슈
- **예상 결과**: 댓글 아이콘 표시 안 됨

### 시나리오 2: 댓글이 1-29개인 이슈
- **예상 결과**: 💬 아이콘, 보라색 배경, 댓글 개수 표시

### 시나리오 3: 댓글이 30개 이상인 이슈
- **예상 결과**: 🔥 아이콘, 빨간색 배경, 댓글 개수 표시

### 시나리오 4: `isHotTopic: true`인 이슈
- **예상 결과**: 🔥 아이콘, 빨간색 배경 (댓글 수와 무관)

### 시나리오 5: `scrapedComments`가 있는 이슈
- **예상 결과**: 툴팁에 상위 3개 댓글 미리보기 표시

### 시나리오 6: `scrapedComments`가 없는 이슈
- **예상 결과**: 툴팁에 "댓글 N개"만 표시

---

## 11. 파일별 수정 사항 요약

### 백엔드

1. **`backend/prisma/schema.prisma`**
   - `ReportItemIssue` 모델에 `commentCount`, `scrapedComments`, `isHotTopic` 필드 정의

2. **`backend/workers/monitoring/naverCafe.worker.js`**
   - 댓글 수집 로직 (라인 869-944)
   - `saveRawLog`에 댓글 정보 전달

3. **`backend/workers/rawLogProcessor.worker.js`**
   - metadata에서 댓글 정보 추출
   - `upsertIssueFromNaverCafe`에 댓글 정보 전달

4. **`backend/services/naverCafeIssues.service.js`**
   - `issueData`에 댓글 정보 포함
   - Issue 생성/업데이트 시 댓글 정보 저장

5. **`backend/services/issues.service.js`**
   - `getAllIssues`에서 댓글 정보 조회
   - API 응답에 댓글 정보 포함

### 프론트엔드

1. **`src/types/index.ts`**
   - `Ticket` 인터페이스에 `commentsCount`, `scrapedComments`, `isHotTopic` 필드 추가

2. **`src/App.tsx`**
   - API 응답을 `Ticket`으로 변환 시 댓글 정보 매핑

3. **`src/components/TicketCard.tsx`**
   - 댓글 아이콘 표시 로직
   - 핫토픽 강조 표시
   - 툴팁 기능

4. **`src/components/TicketListRow.tsx`**
   - 동일한 댓글 표시 로직 적용

---

## 12. 데이터 검증 예제

### 올바른 데이터 예시

```json
{
  "id": "cmxxx...",
  "summary": "서버 렉 문제",
  "commentCount": 45,
  "scrapedComments": "[{\"index\":1,\"author\":\"유저1\",\"text\":\"정말 렉 심하네요\",\"date\":\"2023.11.29. 14:00\"},{\"index\":2,\"author\":\"유저2\",\"text\":\"저도 같은 문제 있어요\",\"date\":\"2023.11.29. 14:05\"}]",
  "isHotTopic": true,
  "commentsCount": 45
}
```

### 잘못된 데이터 예시

```json
{
  "id": "cmxxx...",
  "summary": "서버 렉 문제",
  "commentCount": null,  // ❌ null이면 0으로 처리
  "scrapedComments": "invalid json",  // ❌ JSON 파싱 실패
  "isHotTopic": undefined,  // ❌ undefined면 false로 처리
  "commentsCount": 0
}
```

---

## 13. 체크리스트 실행 가이드

### 단계별 확인

1. **DB 확인**
   ```bash
   cd backend
   npx prisma studio
   # 또는 SQLite 직접 확인
   ```

2. **API 테스트**
   ```bash
   curl http://127.0.0.1:8080/api/issues | jq '.data.issues[0] | {commentCount, isHotTopic, scrapedComments: (.scrapedComments | length)}'
   ```

3. **프론트엔드 확인**
   - 브라우저 개발자 도구 → Network 탭
   - `/api/issues` 응답 확인
   - Console에서 `tickets` 배열 확인

4. **UI 확인**
   - 이슈 리스트에서 댓글이 있는 항목 확인
   - 댓글 아이콘 클릭/호버하여 툴팁 확인

---

이 문서를 참고하여 각 단계별로 데이터 흐름을 확인하고 오류를 검토하세요.

