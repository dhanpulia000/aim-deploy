# 다중 게임(프로젝트) 지원 구조 마이그레이션 가이드

> **버전**: 2.0  
> **날짜**: 2025-12-03  
> **목적**: 시스템을 다중 게임(프로젝트) 지원 구조로 변경

---

## 개요

시스템이 게임별로 카테고리, 중요도 기준, 보고서 양식이 완전히 다르기 때문에 다중 프로젝트 지원 구조로 변경되었습니다.

---

## 변경 사항 요약

### 1. DB 스키마 변경

#### CategoryGroup 모델
- `projectId` 필드 추가 (필수, 기본값: 1)
- `Project` 모델과 관계 추가 (`onDelete: Cascade`)

#### Project 모델
- `severityRules` 필드 추가 (JSON?, AI가 참고할 게임별 중요도 산정 기준)
- `reportConfig` 필드 추가 (JSON?, 엑셀 시트 순서, 헤더 이름, 사용할 시트 종류 등)
- `categoryGroups` 관계 추가

### 2. AI 분류 로직 변경

- `classifyIssueCategory` 함수가 `projectId`를 인자로 받도록 수정
- 해당 프로젝트의 카테고리만 조회하여 AI에게 제공
- `project.severityRules`가 있으면 시스템 프롬프트에 추가

### 3. 관리자 페이지 변경

- `CategoryManagement.tsx`에 프로젝트 선택 드롭다운 추가
- 카테고리 추가/수정/삭제 시 선택된 프로젝트 ID를 API에 전송

### 4. 백엔드 API 변경

- `categories.controller.js`의 모든 CRUD 작업이 `projectId`를 기준으로 수행
- `listCategoryGroups`, `getCategoryTree`에 `projectId` 쿼리 파라미터 추가
- `createCategoryGroup`에 `projectId` 필수 필드 추가

### 5. 보고서 서비스 변경

- `generateDailyReport` 함수가 `projectId`를 받도록 변경
- 모든 집계 함수(`getSummaryStats`, `createVoCSheet`, `createIssueSheet`, `createDataSheet`, `createVolumeSheet`)에 `projectId` 필터링 추가
- `project.reportConfig`를 참조하여 헤더 텍스트나 컬럼 구성을 동적으로 변경 가능

---

## 마이그레이션 절차

### 1단계: DB 스키마 적용

```bash
cd backend
npx prisma db push
npx prisma generate
```

### 2단계: 기존 데이터 마이그레이션

기존 `CategoryGroup` 데이터를 'Default Project'로 할당:

```bash
node backend/scripts/migrate-category-groups-to-project.js
```

이 스크립트는:
1. 'Default Project'를 찾거나 생성
2. `projectId`가 없는 모든 `CategoryGroup`을 'Default Project'에 할당
3. 마이그레이션 결과를 로그로 출력

### 3단계: 서버 재시작

```bash
# 백엔드 서버 재시작
cd backend
node server.js
```

---

## 사용 방법

### 프로젝트별 카테고리 관리

1. 관리자 페이지 → 카테고리 관리 (`/admin/categories`)
2. 상단의 **프로젝트 선택 드롭다운**에서 프로젝트 선택
3. 선택한 프로젝트의 카테고리만 표시됨
4. 카테고리 추가/수정/삭제 시 자동으로 선택된 프로젝트에 할당됨

### 프로젝트별 AI 분류 설정

1. 관리자 페이지 → 프로젝트 관리
2. 프로젝트 선택 → 편집
3. **중요도 산정 기준** (`severityRules`) JSON 필드에 설정 추가:

```json
{
  "description": "이 게임의 중요도 산정 기준입니다.",
  "rules": [
    "서버 접속 불가는 항상 HIGH 중요도",
    "게임 크래시는 severity 1로 분류",
    "UI 버그는 severity 3으로 분류"
  ]
}
```

### 프로젝트별 보고서 설정

1. 관리자 페이지 → 프로젝트 관리
2. 프로젝트 선택 → 편집
3. **보고서 설정** (`reportConfig`) JSON 필드에 설정 추가:

```json
{
  "sheetOrder": ["SUMMARY", "VoC", "ISSUE", "Data", "INDEX", "Volume"],
  "headers": {
    "SUMMARY": {
      "dateColumn": "날짜",
      "categoryColumn": "카테고리"
    }
  },
  "enabledSheets": ["SUMMARY", "VoC", "ISSUE"]
}
```

### 프로젝트별 보고서 생성

보고서 다운로드 API에 `projectId` 쿼리 파라미터 추가:

```
GET /api/reports/daily/download?startDate=2025-12-01&endDate=2025-12-03&projectId=1
```

---

## 주의사항

1. **기존 데이터**: 모든 기존 `CategoryGroup`은 'Default Project' (ID: 1)에 할당됩니다.
2. **하위 호환성**: `projectId`가 없는 경우 기본값으로 처리되거나 모든 프로젝트의 데이터를 조회합니다.
3. **카테고리 중복**: 프로젝트별로 동일한 이름의 카테고리 그룹을 만들 수 있습니다.
4. **보고서 생성**: `projectId`를 지정하지 않으면 모든 프로젝트의 데이터가 포함됩니다.

---

## 문제 해결

### 마이그레이션 스크립트 실행 오류

```bash
# Prisma Client 재생성
cd backend
npx prisma generate

# 스크립트 재실행
node backend/scripts/migrate-category-groups-to-project.js
```

### 카테고리가 표시되지 않음

1. 프로젝트 선택 드롭다운에서 올바른 프로젝트가 선택되었는지 확인
2. 브라우저 개발자 도구에서 API 응답 확인
3. 서버 로그에서 에러 확인

### AI 분류가 작동하지 않음

1. 프로젝트의 `severityRules` 설정 확인
2. 해당 프로젝트에 카테고리가 있는지 확인
3. AI API 키 설정 확인

---

## 다음 단계

1. 각 게임별 프로젝트 생성
2. 프로젝트별 카테고리 설정
3. 프로젝트별 중요도 산정 기준 설정
4. 프로젝트별 보고서 설정 구성
5. 모니터링 게시판에 프로젝트 할당

---

**문서 버전**: 1.0  
**작성일**: 2025-12-03









