# PUBG PC 주간 모니터링 보고서 생성기 (Node.js) — 상세 개발명세서

> 이 문서는 **동일한 산출물(엑셀 시트/집계값/정렬/파일명)**을 재현할 수 있도록, 구현 규칙을 “프로그램 수준”으로 구체화한 개발명세서입니다.  
> 현재 프로젝트의 Node.js 구현(`backend/services/weeklyVocReportFromExcelPc.service.js`) 동작을 기준으로 작성했습니다.

---

## 0) 용어

- **VoC 원천 엑셀**: `PUBG PC 모니터링 일일 보고서.xlsx` (업로드하는 파일)
- **VoC 시트**: 원천 엑셀 내부의 `VoC` 시트(필수)
- **주간 범위(thisWeek)**: 보고서에 반영할 기간(자동/기간 지정)
- **필터링 데이터(filteredRows)**: `thisWeek` 범위로 필터된 VoC 행
- **대표 내용(representative content)**: 동일 그룹 내에서 **문자열 길이가 가장 긴 원문** `content` (정보량이 많다고 가정)
- **content_norm**: “유사한 내용이 모여 보이도록” 약한 정규화된 내용 키

---

## 1) 목적 / 범위

### 1.1 목적
- **입력**: VoC 원천 엑셀(`.xlsx`) 1개
- **출력**: 지정 기간에 대한 **주간 모니터링 보고서 엑셀 1개**
  - 11개 시트 생성 (아래 5절)

### 1.2 범위
- Backend에서 원천 엑셀을 읽고 집계/정리하여 산출 엑셀 생성
- Frontend에서 업로드/기간선택/생성/다운로드/삭제 UI 제공

### 1.3 구현 위치(레퍼런스)
- **Backend 서비스**: `backend/services/weeklyVocReportFromExcelPc.service.js`
- **Backend API**: `backend/controllers/reports.controller.js` (weekly-pc-sources / weekly-pc-outputs)
- **Frontend UI**: `src/WeeklyReportGenerator.tsx` (PUBG PC 주간보고서 생성 섹션)

---

## 2) 입력 엑셀 규격 (필수)

### 2.1 파일/시트
- 파일: `.xlsx` (권장)
- 시트명: **`VoC`** (필수)
  - `VoC` 시트가 없으면 에러로 종료한다.

### 2.2 헤더/데이터 위치
- 헤더 행: **4번째 행 (1-based = 4)**  
- 데이터 시작 행: **5번째 행 (1-based = 5)**

### 2.3 컬럼 매핑 (인덱스 기반, Excel 1-based)
PC 템플릿은 `Unnamed` 컬럼이 섞일 수 있어 **헤더 텍스트 매칭이 아닌 “고정 인덱스” 기반 매핑**을 기본으로 한다.

| 필드 | 의미 | Excel 1-based 컬럼 | Excel 열 | 비고 |
|---|---|---:|---|---|
| `date` | 날짜 | 2 | B | 파싱 실패 시 행 제외 |
| `category` | 대분류 | 5 | E | 문자열 trim 권장 |
| `subCategory` | 중분류 | 6 | F | 문자열 trim 권장 |
| `sentimentRaw` | 성향 원문 | 8 | H | 정규화 후 사용 |
| `content` | 내용 | 10 | J | 대표 내용 선택에 사용 |
| `count` | 건수 | 24 | X | 숫자 변환, 0 이하면 제외 |

---

## 3) 파싱/정제/정규화 규칙

### 3.1 셀 값 추출 규칙
엑셀 라이브러리(ExcelJS) 특성을 고려해 다음 규칙으로 값을 추출한다.

- 값이 `richText`인 경우: 모든 text를 join 후 trim
- 값이 `formula` 결과를 갖는 경우: `result` 사용
- 그 외: 원시 value 사용 후 문자열/숫자 변환

### 3.2 날짜 파싱(`date_only`)
**날짜 비교는 ‘날짜 단위’로만** 수행하며 time(시/분/초)는 제거한다.

지원 입력 형식:
- `Date` 객체
- Excel serial number(숫자)
- 문자열:
  - `YYYY-MM-DD`
  - `YYYY.MM.DD`
  - `YYYY/MM/DD`
  - `YYYYMMDD`
  - 그 외 `new Date(string)`로 파싱 가능한 값

규칙:
- 파싱 실패 → 해당 행 제외
- `date_only = new Date(y, m, d)` 형태로 time 제거

### 3.3 건수 파싱(`count`)
- 숫자면 `Math.floor`
- 문자열이면 `,` 제거 후 `parseFloat` → `Math.floor`
- 파싱 실패/NaN/빈 값 → 0
- `count <= 0`인 행은 제외(집계 대상 아님)

### 3.4 성향 정규화(`sentiment_norm`)
`sentimentRaw`(원문)에서 아래 규칙으로 정규화한다.

- 문자열에 `"긍정"` 포함 → `긍정`
- 문자열에 `"부정"` 포함 → `부정`
- 그 외 → `중립`

### 3.5 “유사한 내용” 정규화(`content_norm`) — 약한 정규화
유사한 내용을 묶기 위한 약한 정규화(현재 구현 기준):

1) 공백 축약  
`content.replace(/\s+/g, ' ').trim()`

2) 문장 끝 숫자 제거  
`...문의1`, `...이슈2` 등 → 끝의 `\d+` 제거  
`collapsed.replace(/\d+$/g, '').trim()`

예)
- `"2차 인증 문의1"` → `"2차 인증 문의"`
- `"동일 이슈   내용"` → `"동일 이슈 내용"`

---

## 4) 기간 산정(주간 범위)

### 4.1 주간(자동)
VoC 데이터의 날짜 중 최대값(최신일)을 기준으로 **직전 주(월~일)** 를 사용한다. (PUBGM과 동일)

- `latestDate = max(vocRows.date_only)`
- `refDate = latestDate - 1일` (최신일 전날)
- `start = refDate가 속한 주의 월요일`
- `end = refDate가 속한 주의 일요일`
- 범위 필터: `start <= date_only <= end`

예: 최신일 2026-02-09(월) → 직전 주 2026-02-02(월) ~ 2026-02-08(일)

### 4.2 기간 지정(custom)
사용자 입력 `startDate`, `endDate`(YYYY-MM-DD)를 그대로 사용한다.

- 검증: `start <= end` (위반 시 에러)
- 범위 필터: `start <= date_only <= end`

---

## 5) 산출물(엑셀) 규격

### 5.1 파일명/저장
- 파일명(기본):

`PUBGPC_모니터링_주간보고서_YYYYMMDD_YYYYMMDD.xlsx`

- 저장 폴더: weekly-pc-outputs 내부 job 디렉터리(컨트롤러 구현 기준)
- 엑셀 파일 쓰기 실패(권한/잠금 등 EPERM 류) 시:
  - fallback 파일명: 위 파일명 뒤에 `_timestamp` 추가 후 재시도

### 5.2 시트 목록 (총 11개)
1. `전반적인 동향(부정)`
2. `금주 최고의 동향`
3. `금주 최악의 동향`
4. `커뮤니티 동향`
5. `안티치트 동향`
6. `맵 서비스 리포트`
7. `패치노트 동향`
8. `2차 인증 관련 동향`
9. `컨텐츠 동향`
10. `인게임 동향`
11. `범위_정보`

---

## 6) 공통 그룹핑/정렬 규칙

### 6.1 대표 내용 선택
동일 그룹 내 `content` 후보 중 **문자열 길이가 가장 긴 원문**을 대표로 선택한다.

### 6.2 상세 동향 계열(시트 4~10) 그룹핑 키
상세 동향 시트(4~10)는 아래 키로 그룹핑하여 “유사한 내용이 모여 보이도록” 한다.

- 그룹 키: `(category, subCategory, sentiment_norm, content_norm)`
- 건수: `sum(count)`
- 대표 내용: 그룹 내 content 최장 원문

정렬:
- `category ASC (ko locale)`
- `subCategory ASC (ko locale)`
- `count DESC`
- `content ASC (ko locale)`

출력 컬럼:
- `대분류`, `중분류`, `성향`, `내용`, `건수`

---

## 7) 시트별 생성 규칙 (상세)

> 모든 시트는 **thisWeek 범위로 필터된 데이터(filteredRows)**만 사용한다(명시된 경우 제외).

### 7.1 시트 1 — `전반적인 동향(부정)`

#### 7.1.1 목적
- 부정 동향 상위 항목을 주간 요약으로 제공

#### 7.1.2 집계 대상
- `sentiment_norm == '부정'`

#### 7.1.3 그룹핑
- 그룹 키: `(category, subCategory, content_norm)`
- 건수: 그룹 내 `count` 합
- 대표 내용: 그룹 내 최장 `content`

#### 7.1.4 정렬/상위 선택
- `count DESC`
- 상위 6개를 사용(표/LLM 입력 기준)

#### 7.1.5 출력 형식 (2가지)
**A) LLM 내러티브 사용 가능 시**
- 조건:
  - `OPENAI_API_KEY` 설정
  - `openai` 모듈 사용 가능
  - 호출/파싱 성공
- 출력 컬럼:
  - `순위`(1..N)
  - `내용`(서술형 문장)

**B) LLM 불가/실패 시 (fallback 표)**
- 출력 컬럼:
  - `순위`(1..6)
  - `대분류`
  - `중분류`
  - `내용`(대표 내용)
  - `건수`

---

### 7.2 시트 2 — `금주 최고의 동향` (긍정)

#### 7.2.1 목적
- 긍정 동향을 나열

#### 7.2.2 집계 대상
- `sentiment_norm == '긍정'`

#### 7.2.3 그룹핑 (현재 구현 기준)
> 기존 명세(대분류/중분류 중복 없이)와 달리, 현 프로젝트 요구 반영으로 **내용별로 분리**하여 출력한다.

- 그룹 키: `(category, subCategory, content_norm)`
- 건수: 그룹 내 `count` 합
- 대표 내용: 그룹 내 최장 `content`

#### 7.2.4 정렬 (유사 항목이 모이도록)
- `category ASC`
- `subCategory ASC`
- `count DESC`
- `content ASC`

#### 7.2.5 출력 컬럼
- `순위`: 정렬 결과 순번(1부터)
- `대분류`
- `중분류`
- `내용`: **각 문장 앞에 `- `를 붙여 출력**
  - 이미 `-`로 시작하면 중복 방지
- `건수`

---

### 7.3 시트 3 — `금주 최악의 동향` (부정)
`금주 최고의 동향`과 동일한 규칙을 적용하되 성향만 다르다.

- 대상: `sentiment_norm == '부정'`
- 그룹 키: `(category, subCategory, content_norm)`
- 정렬: `category ASC`, `subCategory ASC`, `count DESC`, `content ASC`
- 출력 컬럼: `순위, 대분류, 중분류, 내용(- prefix), 건수`

---

### 7.4 시트 4 — `커뮤니티 동향`

#### 7.4.1 필터
- `String(category).trim() === '커뮤니티'`

#### 7.4.2 그룹핑/정렬/출력
- 6.2 규칙(상세 동향 공통) 적용

---

### 7.5 시트 5 — `안티치트 동향`

#### 7.5.1 필터
- `category`에서 공백 제거 후 `"불법프로그램"` 포함
  - 예: `"불법 프로그램"`/`"불법프로그램"` 모두 매칭

#### 7.5.2 그룹핑/정렬/출력
- 6.2 규칙 적용

---

### 7.6 시트 6 — `맵 서비스 리포트`

#### 7.6.1 필터
아래 조건을 모두 만족:
- `category.trim() === '컨텐츠'`
- `subCategory`가 아래 중 하나:
  - 정확히 `"맵 서비스 리포트"`
  - `"맵 서비스 리포트"`로 시작
  - 공백 제거 후 `"맵서비스리포트"` 포함

#### 7.6.2 그룹핑/정렬/출력
- 6.2 규칙 적용

---

### 7.7 시트 7 — `패치노트 동향`

#### 7.7.1 필터
- `subCategory.trim().startsWith('#')`

#### 7.7.2 그룹핑/정렬/출력
- 6.2 규칙 적용

---

### 7.8 시트 8 — `2차 인증 관련 동향`

#### 7.8.1 필터
- `subCategory` 공백 제거 후 `"2차인증"` 포함

#### 7.8.2 그룹핑/정렬/출력
- 6.2 규칙 적용

---

### 7.9 시트 9 — `컨텐츠 동향`

#### 7.9.1 필터
- `category.trim() === '컨텐츠'` 이면서
- **맵 서비스 리포트 / 패치노트 / 2차 인증**에 해당하지 않는 것

#### 7.9.2 그룹핑/정렬/출력
- 6.2 규칙 적용

---

### 7.10 시트 10 — `인게임 동향`

#### 7.10.1 필터
- (현 구현 기준) `category.trim() !== '컨텐츠'` 이면서
- `커뮤니티`, `안티치트`로 분류된 것 제외
  - 상세 필터링은 코드의 조건 분기를 따른다.

#### 7.10.2 그룹핑/정렬/출력
- 6.2 규칙 적용

---

### 7.11 시트 11 — `범위_정보`

#### 7.11.1 목적
- 보고서 생성 범위 및 소스 파일 정보를 기록

#### 7.11.2 출력(권장)
테이블 형태(컬럼 2개):
- `항목`, `값`

최소 포함 항목:
- `주간 시작일`: `YYYY-MM-DD`
- `주간 종료일`: `YYYY-MM-DD`
- `소스 파일명`: 업로드된 소스 파일명

---

## 8) 엑셀 쓰기 규칙(표 형식)

### 8.1 컬럼 설정
- 각 시트는 `ws.columns = [{ key, width }, ...]` 설정 후,
- 헤더 행은 **명시적으로 1행에만** 기록한다.

### 8.2 데이터 행 기록
- 데이터는 `columns` 순서대로 셀 값을 채운다.
- `null/undefined`는 빈 값으로 기록한다.

---

## 9) API / 저장 경로 규칙(시스템 동작)

> 아래는 현재 프로젝트 구조에 맞춘 “동작 규칙” 요약이다. 정확한 파라미터 명/응답 포맷은 컨트롤러 구현을 따른다.

### 9.1 소스 파일(업로드) 디렉터리
- `backend/data/weekly-pc-sources/`

### 9.2 산출물 디렉터리
- `backend/data/weekly-pc-outputs/<jobId>/...xlsx`

### 9.3 주요 API
- `GET /api/reports/weekly-pc-sources`
  - 소스 파일 목록 조회
- `POST /api/reports/weekly-pc-sources/upload`
  - multipart 업로드
- `DELETE /api/reports/weekly-pc-sources/:sourceId`
  - 소스 파일 삭제
- `POST /api/reports/weekly-pc-sources/generate`
  - 바디 예:
    - `{ "sourceId": "...", "periodMode": "auto" }`
    - `{ "sourceId": "...", "periodMode": "custom", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }`
- `GET /api/reports/weekly-pc-outputs`
  - 생성된 산출물 job 목록 조회
- `GET /api/reports/weekly-pc-outputs/download?jobId=...&file=...`
  - 산출물 다운로드
- `DELETE /api/reports/weekly-pc-outputs/:jobId`
  - 산출물 삭제

---

## 10) 오류/예외 처리

- `VoC` 시트 없음 → 에러(`VoC 시트가 없습니다.` 등)
- 유효 행 0개 → 에러(`유효한 데이터가 없습니다.` 등)
- 기간 지정 입력 형식 오류 → 에러
- `start > end` → 에러
- LLM 내러티브 생성 실패:
  - warn 로그 남기고 **표 형식으로 fallback**
- 파일 쓰기 `EPERM/Permission`:
  - fallback 파일명으로 재시도

---

## 11) 재현성 테스트 체크리스트(필수)

### 11.1 입력 파싱 검증
- 날짜 파싱 실패 행 제외되는지
- `count <= 0` 행 제외되는지
- 성향 정규화(긍정/부정/중립) 결과 확인

### 11.2 기간 검증
- auto: `maxDate-6 ~ maxDate` 범위로 정확히 필터되는지
- custom: `start/end` 검증 및 필터 정상 동작

### 11.3 시트 생성/집계 검증
- 11개 시트 생성 여부
- 상세 동향 시트(4~10):
  - content_norm 기반 그룹핑 적용 여부
  - 정렬 순서(category/subCategory/count/content) 일치 여부
- 최고/최악 동향(2~3):
  - 내용별 분리(대분류로 합치지 않음) 여부
  - `내용`에 `- ` prefix 적용 여부
  - 정렬 규칙 적용 여부

### 11.4 파일/다운로드 검증
- 파일명이 규칙대로 생성되는지
- 다운로드/삭제 API 정상 동작

