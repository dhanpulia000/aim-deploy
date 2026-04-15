# 이슈 상세 창 → 일일 보고서 반영 가이드

## 현재 상황

### 이슈 상세 창에서 수정 가능한 필드
1. **카테고리**: `categoryGroupId`, `categoryId`
2. **중요도 (Severity)**: `severity` (1=상, 2=중, 3=하)
3. **종류 (Trend)**: `trend` (문의, 의견, 건의, 제보)
4. **AI 분류 이유**: `aiClassificationReason`

### 일일 보고서 VOC 시트에서 사용하는 필드
1. **종류**: `inferType()` 함수로 `trend` 또는 `category.name`에서 추론
2. **성향**: `issue.sentiment` 직접 사용 (수정 불가)
3. **중요도**: `issue.importance` 직접 사용 (HIGH/MEDIUM/LOW)

## 문제점

1. **중요도 불일치**: 이슈 상세 창에서는 `severity`를 수정하지만, VOC 시트는 `importance`를 사용
2. **성향 수정 불가**: `sentiment` 필드가 수정 불가능
3. **종류 추론 부정확**: `trend`가 없으면 `category.name`에서 추론하지만, 정확도가 낮을 수 있음

## 해결 방법

### 방법 1: Severity → Importance 자동 동기화 (권장)

**이슈 업데이트 시 `severity` 변경에 따라 `importance`도 자동 업데이트**

```javascript
// backend/services/issues.service.js의 updateIssue 함수 수정
if (updateData.severity !== undefined) {
  updateFields.severity = updateData.severity;
  // severity에 따라 importance 자동 설정
  if (updateData.severity === 1) {
    updateFields.importance = 'HIGH';
  } else if (updateData.severity === 2) {
    updateFields.importance = 'MEDIUM';
  } else if (updateData.severity === 3) {
    updateFields.importance = 'LOW';
  }
}
```

**장점**:
- 기존 코드 변경 최소화
- 데이터 일관성 보장
- VOC 시트에 자동 반영

### 방법 2: VOC 시트에서 Severity 우선 사용

**VOC 시트 생성 시 `importance` 대신 `severity` 사용**

```javascript
// backend/services/excelReport.service.js의 groupVoCIssues 함수 수정
importance: issue.importance || 
  (issue.severity === 1 ? 'HIGH' : 
   issue.severity === 2 ? 'MEDIUM' : 'LOW') || 
  'MEDIUM'
```

**장점**:
- 이슈 상세 창 수정 내용 즉시 반영
- 별도 동기화 로직 불필요

### 방법 3: 성향 수정 기능 추가

**이슈 상세 창에 성향 수정 UI 추가**

```typescript
// src/components/IssueDetailPanel.tsx
const [selectedSentiment, setSelectedSentiment] = useState<string>(
  ticket.sentiment || 'neu'
);

// 저장 시
const updateData: any = {
  // ... 기존 필드
  sentiment: selectedSentiment
};
```

**장점**:
- 사용자가 성향도 직접 수정 가능
- 보고서에 정확한 성향 반영

## 권장 구현 순서

1. **1단계**: Severity → Importance 자동 동기화 구현
2. **2단계**: 성향 수정 기능 추가
3. **3단계**: 종류 추론 로직 개선 (trend 우선 사용)

## 구현 예시

### 1. Severity → Importance 동기화

```javascript
// backend/services/issues.service.js
async function updateIssue(issueId, updateData, userId = null) {
  // ... 기존 코드
  
  if (updateData.severity !== undefined) {
    updateFields.severity = updateData.severity;
    // severity에 따라 importance 자동 설정
    const severityToImportance = {
      1: 'HIGH',
      2: 'MEDIUM',
      3: 'LOW'
    };
    updateFields.importance = severityToImportance[updateData.severity] || 'MEDIUM';
  }
  
  // ... 나머지 코드
}
```

### 2. 성향 수정 UI 추가

```typescript
// src/components/IssueDetailPanel.tsx
const [selectedSentiment, setSelectedSentiment] = useState<string>(
  ticket.sentiment || 'neu'
);

// UI에 추가
<select
  value={selectedSentiment}
  onChange={(e) => setSelectedSentiment(e.target.value)}
>
  <option value="pos">긍정</option>
  <option value="neu">중립</option>
  <option value="neg">부정</option>
</select>

// 저장 시
const updateData: any = {
  // ... 기존 필드
  sentiment: selectedSentiment
};
```

### 3. 종류 추론 개선

```javascript
// backend/services/excelReport.service.js
inferType(issue) {
  // 1. trend 필드 우선 사용 (사용자가 직접 수정한 값)
  if (issue.trend) {
    const trendLower = issue.trend.toLowerCase();
    if (trendLower.includes('건의') || trendLower.includes('제안')) {
      return '건의';
    } else if (trendLower.includes('문의') || trendLower.includes('질문')) {
      return '문의';
    } else if (trendLower.includes('제보') || trendLower.includes('신고')) {
      return '제보';
    } else if (trendLower.includes('의견')) {
      return '의견';
    }
  }
  
  // 2. category.name에서 추론
  if (issue.category?.name) {
    const categoryName = issue.category.name.toLowerCase();
    if (categoryName.includes('건의') || categoryName.includes('제안')) {
      return '건의';
    } else if (categoryName.includes('문의') || categoryName.includes('질문')) {
      return '문의';
    } else if (categoryName.includes('제보') || categoryName.includes('신고')) {
      return '제보';
    }
  }
  
  // 3. 기본값
  return '의견';
}
```

## 검증 방법

1. 이슈 상세 창에서 카테고리, 중요도, 종류 수정
2. 일일 보고서 생성
3. VOC 시트에서 수정된 내용 확인:
   - 대분류/중분류: 수정한 카테고리 반영
   - 중요도: 수정한 severity에 맞는 중요도 표시
   - 종류: 수정한 trend 반영
   - 성향: 수정한 sentiment 반영 (수정 기능 추가 후)









