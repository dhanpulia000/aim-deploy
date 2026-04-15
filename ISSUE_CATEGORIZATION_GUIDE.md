# 이슈 자동 분류 시스템 가이드

## 개요

업로드된 일일 보고서의 이슈 데이터를 키워드 기반으로 자동 분류하는 시스템입니다.

## 기능

### 1. 키워드 기반 자동 분류

5가지 카테고리로 자동 분류:
- **장애/접속**: 서버, 점검, 접속 불가, 튕김, 렉, 핑, 지연, 버벅, 다운, 오류, 에러, 먹통 등
- **결제/환불**: 환불, 결제 오류, 미결제, 영수증, 과금, 결제취소, 청구 등
- **핵/부정행위**: 핵, 치트, 에임핵, 매크로, 스피드핵, 벽핵, bot, cheat 등
- **운영/정책**: 밴, 정지, 제재, 영구정지, 어필, 공지, 운영자, 신고 등
- **불만/이탈징후**: 망겜, 현타, 접을, 환멸, 실망, 욕, refund please 등

### 2. API 엔드포인트

#### 모든 이슈 조회
```bash
GET /api/issues
```

**Query Parameters:**
- `agentId` (optional): 특정 에이전트 필터
- `startDate` (optional): 시작 날짜 (YYYY-MM-DD)
- `endDate` (optional): 종료 날짜 (YYYY-MM-DD)
- `severity` (optional): 심각도 필터 (1, 2, 3)
- `status` (optional): 상태 필터
- `category` (optional): 카테고리 필터
- `limit` (optional): 최대 개수 (기본: 1000)
- `offset` (optional): 오프셋 (기본: 0)

**Response:**
```json
{
  "success": true,
  "data": {
    "issues": [
      {
        "id": "...",
        "summary": "서버 접속 불가",
        "categories": ["장애/접속"],
        "primaryCategory": "장애/접속",
        "severity": 1,
        "status": "new",
        ...
      }
    ],
    "stats": {
      "장애/접속": {
        "count": 10,
        "issues": ["id1", "id2", ...]
      },
      ...
    },
    "pagination": {
      "total": 100,
      "limit": 1000,
      "offset": 0,
      "hasMore": false
    }
  }
}
```

#### 카테고리별 통계 조회
```bash
GET /api/issues/stats?startDate=2025-10-20&endDate=2025-10-26
```

**Response:**
```json
{
  "success": true,
  "data": {
    "categories": {
      "장애/접속": {
        "count": 10,
        "issues": ["id1", "id2", ...]
      },
      ...
    },
    "totalIssues": 100,
    "period": {
      "startDate": "2025-10-20",
      "endDate": "2025-10-26"
    }
  }
}
```

#### 특정 에이전트의 이슈 조회
```bash
GET /api/issues/:agentId
```

### 3. 프론트엔드 통합

- 메인 대시보드(`/`)에서 자동으로 이슈 데이터 로드
- 카테고리 필터 드롭다운 추가
- 각 이슈에 주요 카테고리 표시 (📌 아이콘)

### 4. 키워드 팩 관리

키워드 팩은 `backend/utils/keyword-categorizer.js`에서 관리됩니다.

**키워드 추가 방법:**
```javascript
const KEYWORD_PACKS = {
  '장애/접속': {
    keywords: [
      '서버', '점검', '접속 불가', // 기존 키워드
      '새로운 키워드', // 추가
      ...
    ],
    priority: 1
  },
  ...
};
```

**주의사항:**
- 키워드는 부분 일치로 검색됩니다
- 한글/영어 동의어, 오탈자 변형을 모두 포함할 수 있습니다
- 우선순위(priority)가 낮을수록 높은 우선순위입니다

## 키워드 팩 개선 프로세스

### 1주차: 넓게 잡기
- 초기 키워드 팩으로 시작
- False Positive를 수용하면서도 중요한 이슈를 놓치지 않도록

### 2주차 이후: 정밀화
- 불필요한 키워드 제거
- 예외 단어(화이트리스트) 추가
- 카테고리별 정확도 모니터링

## 사용 예시

### 이슈 조회 및 필터링
```javascript
// 모든 이슈 조회
const response = await fetch('/api/issues?limit=100');
const data = await response.json();

// 장애/접속 카테고리만 필터링
const issuesResponse = await fetch('/api/issues?category=장애/접속');
const filteredData = await issuesResponse.json();

// 특정 기간의 이슈 조회
const periodResponse = await fetch(
  '/api/issues?startDate=2025-10-20&endDate=2025-10-26'
);
```

### 카테고리 통계 확인
```javascript
const statsResponse = await fetch('/api/issues/stats?startDate=2025-10-20&endDate=2025-10-26');
const stats = await statsResponse.json();

console.log('카테고리별 통계:', stats.data.categories);
```

## 향후 개선 사항

1. **변경감지형 모니터링** (A 방식)
   - 카페 검색결과/게시판 목록 모니터링
   - 5-10분 주기 확인
   - 웹훅 → Slack 알림
   - 중복 억제 (24시간 쿨다운)

2. **수집형 모니터링** (B 방식)
   - 로그인 쿠키로 키워드 검색 결과 수집
   - Google Apps Script 파싱
   - 구글시트 적재
   - 15분 주기
   - OpenAI/Zapier 요약

3. **키워드 팩 자동 학습**
   - False Positive 패턴 학습
   - 키워드 자동 제안
   - 카테고리별 정확도 추적

## 파일 구조

```
backend/
  utils/
    keyword-categorizer.js  # 키워드 분류 로직
  services/
    issues.service.js        # 이슈 조회 서비스
  controllers/
    issues.controller.js    # 이슈 컨트롤러
  routes/
    issues.routes.js        # 이슈 라우트
```

## 참고

- 키워드 팩은 정기적으로 검토하고 업데이트해야 합니다
- False Positive는 실제 사용 데이터를 기반으로 개선합니다
- 카테고리는 여러 개가 매칭될 수 있으며, 우선순위가 높은 것이 `primaryCategory`로 설정됩니다







