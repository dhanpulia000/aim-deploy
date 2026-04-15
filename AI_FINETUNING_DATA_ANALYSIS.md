# AI 재학습(Fine-tuning) 데이터 축적 상태 분석

## 📊 분석 결과 요약

### ✅ **양호한 부분**
- `AIClassificationLog` 테이블이 "원문 → AI 예측 → 사용자 수정" 데이터를 모두 저장
- AI 분류 필드 변경 시 자동으로 로그 생성
- 변경된 필드 목록(`changedFields`) 추적

### ⚠️ **개선 필요 부분**
- `ReportItemIssue`의 `detail`, `summary` 필드가 사용자 수정 시 덮어씌워질 수 있음
- 원문 데이터가 `AIClassificationLog`에만 저장되고, `ReportItemIssue`에는 최종 수정본만 남음
- `detail`, `summary` 수정 시 `AIClassificationLog`가 생성되지 않음

---

## 1. DB 스키마 분석

### 1.1 `ReportItemIssue` 테이블

#### ✅ 원문 데이터 (크롤링된 본문)
```prisma
detail         String?  // 원문 본문 전체
summary        String?  // 원문 제목/요약
source         String   // 출처 ('naver', 'discord', 'system')
sourceUrl      String?  // 원본 포스트 URL
externalPostId String?  // 외부 시스템 ID
```

**상태**: ✅ 원문 데이터가 `detail`, `summary` 필드에 저장됨

#### ⚠️ AI 초안 (AI가 최초로 생성한 분류)
```prisma
aiClassificationReason String?  // AI 분류 이유
aiClassificationMethod  String?  // 'AI' 또는 'RULE'
categoryGroupId        Int?     // AI가 분류한 대분류
categoryId             Int?     // AI가 분류한 중분류
severity               Int?     // AI가 분류한 심각도
importance             String?  // AI가 분류한 중요도
trend                  String?  // AI가 생성한 동향/토픽
```

**상태**: ⚠️ **사용자가 수정하면 덮어씌워짐**
- 예: 사용자가 `categoryGroupId`를 수정하면, AI가 분류한 원래 값이 사라짐
- 다만 `AIClassificationLog`에 보존됨

#### ⚠️ 최종 수정본 (사용자가 수정한 내용)
```prisma
// 위와 동일한 필드들이 최종 수정된 값으로 업데이트됨
```

**상태**: ⚠️ **원문과 최종 수정본이 같은 필드를 공유**
- `detail`, `summary`는 원문이지만, 사용자가 수정할 수 있음
- 수정 시 원문이 사라질 수 있음

### 1.2 `AIClassificationLog` 테이블

```prisma
model AIClassificationLog {
  originalData  String  // 원문 데이터 (JSON): {summary, detail, source}
  aiPrediction  String  // AI 예측 데이터 (JSON): {categoryGroupId, categoryId, severity, ...}
  userCorrection String // 사용자 수정 데이터 (JSON): {categoryGroupId, categoryId, severity, ...}
  changedFields  String? // 변경된 필드 목록 (JSON array)
}
```

**상태**: ✅ **"원문 → AI 예측 → 사용자 수정" 데이터를 모두 저장**

**저장되는 데이터**:
- `originalData`: `{summary: oldIssue.summary, detail: oldIssue.detail, source: oldIssue.source}`
- `aiPrediction`: `{categoryGroupId, categoryId, severity, importance, trend, aiClassificationMethod, aiClassificationReason}`
- `userCorrection`: `{categoryGroupId, categoryId, severity, importance, trend}` (수정된 값)

---

## 2. 수정 로직 분석

### 2.1 `updateIssue` 함수 (`backend/services/issues.service.js`)

#### ✅ AI 분류 필드 수정 시 로그 생성
```javascript
// 변경 감지
const classificationFields = ['categoryGroupId', 'categoryId', 'severity', 'importance', 'trend'];
const changedFields = [];

for (const field of classificationFields) {
  if (oldIssue[field] !== updated[field]) {
    changedFields.push(field);
  }
}

// AI 분류 필드가 변경되었고, AI 분류 정보가 있는 경우 로그 저장
if (changedFields.length > 0 && oldIssue.aiClassificationMethod) {
  await prisma.aIClassificationLog.create({
    data: {
      originalData: JSON.stringify({
        summary: oldIssue.summary,
        detail: oldIssue.detail,
        source: oldIssue.source
      }),
      aiPrediction: JSON.stringify({
        categoryGroupId: oldIssue.categoryGroupId,
        categoryId: oldIssue.categoryId,
        severity: oldIssue.severity,
        importance: oldIssue.importance,
        trend: oldIssue.trend,
        aiClassificationMethod: oldIssue.aiClassificationMethod,
        aiClassificationReason: oldIssue.aiClassificationReason
      }),
      userCorrection: JSON.stringify({
        categoryGroupId: updated.categoryGroupId,
        categoryId: updated.categoryId,
        severity: updated.severity,
        importance: updated.importance,
        trend: updated.trend
      }),
      changedFields: JSON.stringify(changedFields)
    }
  });
}
```

**상태**: ✅ **AI 분류 필드 수정 시 로그 생성됨**

#### ⚠️ `detail`, `summary` 수정 시 로그 미생성
```javascript
// 현재 updateIssue 함수에서 detail, summary 수정 지원 여부 확인 필요
if (updateData.detail !== undefined) updateFields.detail = updateData.detail;
if (updateData.summary !== undefined) updateFields.summary = updateData.summary;
```

**문제점**:
- `detail`, `summary` 수정 시 `AIClassificationLog`가 생성되지 않음
- 원문 데이터가 덮어씌워질 수 있음

### 2.2 `AuditLog` 테이블

```prisma
model AuditLog {
  action String  // 'LOGIN', 'ISSUE_STATUS_CHANGE', 'SLA_VIOLATION', etc.
  meta   String? // JSON string for additional metadata
}
```

**상태**: ⚠️ **AI 분류 수정에 대한 상세한 before/after 값 저장 안 함**
- `AIClassificationLog`가 별도로 존재하지만, `AuditLog`에는 일반적인 액션만 저장

---

## 3. 데이터 보존 상태 평가

### ✅ **보존되는 데이터**

1. **원문 데이터**:
   - `ReportItemIssue.detail`: 크롤링된 본문 (사용자 수정 전까지 보존)
   - `ReportItemIssue.summary`: 크롤링된 제목 (사용자 수정 전까지 보존)
   - `AIClassificationLog.originalData`: 수정 시점의 원문 스냅샷

2. **AI 예측 데이터**:
   - `AIClassificationLog.aiPrediction`: AI가 분류한 모든 값 (JSON)
   - `ReportItemIssue.aiClassificationReason`: AI 분류 이유 (수정 시 덮어씌워질 수 있음)

3. **사용자 수정 데이터**:
   - `AIClassificationLog.userCorrection`: 사용자가 수정한 값 (JSON)
   - `ReportItemIssue`의 최종 값들

### ⚠️ **손실 가능한 데이터**

1. **원문 덮어쓰기**:
   - 사용자가 `detail` 또는 `summary`를 수정하면 원문이 사라짐
   - `AIClassificationLog`에는 수정 시점의 스냅샷만 저장됨

2. **AI 초안 덮어쓰기**:
   - `ReportItemIssue`의 AI 분류 필드들이 사용자 수정 시 덮어씌워짐
   - 다만 `AIClassificationLog`에 보존됨

---

## 4. 학습용 데이터셋 추출 가능 여부

### ✅ **추출 가능한 데이터**

```sql
-- 학습용 데이터셋 추출 쿼리 예시
SELECT 
  log.originalData,        -- 원문 (input)
  log.aiPrediction,         -- AI 예측 (model output)
  log.userCorrection,       -- 정답 (ground truth)
  log.changedFields,       -- 어떤 필드가 수정되었는지
  issue.source,            -- 출처
  issue.createdAt          -- 생성 시각
FROM AIClassificationLog log
JOIN ReportItemIssue issue ON log.issueId = issue.id
WHERE log.aiPrediction IS NOT NULL
  AND log.userCorrection IS NOT NULL
  AND log.changedFields IS NOT NULL
ORDER BY log.createdAt DESC;
```

**데이터 구조**:
```json
{
  "input": {
    "summary": "원문 제목",
    "detail": "원문 본문",
    "source": "naver"
  },
  "model_output": {
    "categoryGroupId": 1,
    "categoryId": 5,
    "severity": 2,
    "importance": "MEDIUM",
    "trend": "버그제보"
  },
  "ground_truth": {
    "categoryGroupId": 2,
    "categoryId": 8,
    "severity": 1,
    "importance": "HIGH",
    "trend": "긴급버그"
  },
  "changed_fields": ["categoryGroupId", "categoryId", "severity", "importance"]
}
```

### ⚠️ **추출 불가능하거나 불완전한 데이터**

1. **원문이 수정된 경우**:
   - `detail` 또는 `summary`가 사용자에 의해 수정되면, 원문을 복구할 수 없음
   - `AIClassificationLog.originalData`는 수정 시점의 스냅샷이므로, 원문이 이미 수정된 상태일 수 있음

2. **AI 분류 전에 수정된 경우**:
   - 사용자가 AI 분류 전에 `detail`을 수정하면, AI는 수정된 내용을 기반으로 분류함
   - 원문 데이터가 손실됨

---

## 5. 개선 제안

### 5.1 원문 데이터 보존 강화

#### 제안 1: 원문 필드 추가 (권장)
```prisma
model ReportItemIssue {
  // 기존 필드
  detail         String?  // 현재 본문 (수정 가능)
  summary        String?  // 현재 제목 (수정 가능)
  
  // 추가 필드
  originalDetail String?  // 원문 본문 (수정 불가, 크롤링 시점의 원본)
  originalSummary String? // 원문 제목 (수정 불가, 크롤링 시점의 원본)
}
```

**장점**:
- 원문 데이터가 영구 보존됨
- 학습용 데이터셋 추출 시 원문 확보 가능

#### 제안 2: `detail`, `summary` 수정 시 로그 생성
```javascript
// updateIssue 함수에 추가
if (updateData.detail !== undefined || updateData.summary !== undefined) {
  // 원문 수정 로그 생성
  await prisma.aIClassificationLog.create({
    data: {
      originalData: JSON.stringify({
        summary: oldIssue.summary,
        detail: oldIssue.detail,
        source: oldIssue.source
      }),
      aiPrediction: JSON.stringify({
        // AI 분류 정보 (없을 수 있음)
      }),
      userCorrection: JSON.stringify({
        summary: updated.summary,
        detail: updated.detail
      }),
      changedFields: JSON.stringify(
        (updateData.detail !== undefined ? ['detail'] : [])
          .concat(updateData.summary !== undefined ? ['summary'] : [])
      )
    }
  });
}
```

### 5.2 AI 초안 보존 강화

#### 제안: AI 초안 필드 추가
```prisma
model ReportItemIssue {
  // 기존 필드
  categoryGroupId Int?
  categoryId      Int?
  severity        Int?
  importance      String?
  trend           String?
  
  // 추가 필드 (AI 초안 보존)
  aiOriginalCategoryGroupId Int?  // AI가 최초로 분류한 대분류
  aiOriginalCategoryId      Int?  // AI가 최초로 분류한 중분류
  aiOriginalSeverity       Int?  // AI가 최초로 분류한 심각도
  aiOriginalImportance      String? // AI가 최초로 분류한 중요도
  aiOriginalTrend           String? // AI가 최초로 생성한 동향
}
```

**장점**:
- `ReportItemIssue`에서도 AI 초안 확인 가능
- `AIClassificationLog`와 중복이지만, 조회 성능 향상

### 5.3 데이터셋 추출 스크립트

```javascript
// backend/scripts/exportFinetuningDataset.js
async function exportFinetuningDataset() {
  const logs = await prisma.aIClassificationLog.findMany({
    where: {
      aiPrediction: { not: null },
      userCorrection: { not: null },
      changedFields: { not: null }
    },
    include: {
      issue: true
    },
    orderBy: { createdAt: 'desc' }
  });
  
  const dataset = logs.map(log => ({
    input: JSON.parse(log.originalData),
    model_output: JSON.parse(log.aiPrediction),
    ground_truth: JSON.parse(log.userCorrection),
    changed_fields: JSON.parse(log.changedFields || '[]'),
    metadata: {
      issueId: log.issueId,
      source: log.issue.source,
      createdAt: log.issue.createdAt,
      correctedAt: log.createdAt
    }
  }));
  
  return dataset;
}
```

---

## 6. 결론

### ✅ **현재 상태: 부분적으로 학습용 데이터셋 추출 가능**

**장점**:
- `AIClassificationLog`에 "원문 → AI 예측 → 사용자 수정" 데이터가 모두 저장됨
- AI 분류 필드 수정 시 자동으로 로그 생성
- 변경된 필드 추적 가능

**단점**:
- `detail`, `summary` 수정 시 로그 미생성
- 원문 데이터가 사용자 수정 시 덮어씌워질 수 있음
- `ReportItemIssue`에서 AI 초안 확인 불가 (로그 조회 필요)

### 📋 **권장 개선 사항**

1. **즉시 적용 가능**:
   - `detail`, `summary` 수정 시 `AIClassificationLog` 생성 로직 추가

2. **스키마 변경 필요**:
   - `originalDetail`, `originalSummary` 필드 추가 (원문 보존)
   - 또는 `aiOriginal*` 필드 추가 (AI 초안 보존)

3. **데이터셋 추출 도구**:
   - 학습용 데이터셋 추출 스크립트 작성

---

## 7. 데이터셋 추출 예시

### 현재 가능한 추출
```sql
SELECT 
  log.originalData,
  log.aiPrediction,
  log.userCorrection,
  log.changedFields
FROM AIClassificationLog log
WHERE log.aiPrediction IS NOT NULL
  AND log.userCorrection IS NOT NULL
LIMIT 100;
```

### 추출된 데이터 형식
```json
{
  "originalData": {
    "summary": "게임 크래시 문제",
    "detail": "게임을 실행하면 크래시가 발생합니다...",
    "source": "naver"
  },
  "aiPrediction": {
    "categoryGroupId": 1,
    "categoryId": 5,
    "severity": 2,
    "importance": "MEDIUM",
    "trend": "버그제보"
  },
  "userCorrection": {
    "categoryGroupId": 2,
    "categoryId": 8,
    "severity": 1,
    "importance": "HIGH",
    "trend": "긴급버그"
  },
  "changedFields": ["categoryGroupId", "categoryId", "severity", "importance"]
}
```

**이 데이터로 Fine-tuning 가능**: ✅









