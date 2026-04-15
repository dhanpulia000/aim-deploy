# Mobile 모니터링 일일 보고서 파싱 가이드

## Excel 파일 구조

### 시트 구성
1. **Summary 시트** - 통계 요약
   - 종합: 총게시물량, 댓글량, 취합량
   - 주요 분류별: 불법 프로그램, 최적화, 버그
   - 대분류별: 의견/건의/문의/제보 건수

2. **VOC 시트** (이용자 동향) - 상세 이슈 목록

## VOC 시트 컬럼 매핑

| Excel 컬럼 | 인덱스 | 데이터 | 시스템 매핑 |
|-----------|--------|--------|-------------|
| 날짜 | B (1) | 2025-10-26 | `date`, `createdAt` |
| 출처 | C (2) | Naver Café | `source` → 'naver' |
| 대분류 | D (3) | 컨텐츠, 커뮤니티, 유료 등 | `category` |
| 중분류 | E (4) | 정상 랭킹전, UC/환불 등 | `subcategory` |
| 종류 | F (5) | 문의, 의견, 건의 | `type` |
| 성향 | G (6) | 중립, 부정, 긍정 | `sentiment` → neg/neu/pos |
| 중요도 | H (7) | 중, 하 | `severity` → 2, 3 |
| 내용 | I (8) | 상세 내용 | `title` |
| 게시물 주소 | M (12) | 링크 | `link` |

## 데이터 변환 규칙

### 심각도 (Severity)
- 중요도 '중' → Severity 2
- 중요도 '하' → Severity 3
- 중요도 없음 시 자동 분류:
  - 문의 → Severity 3
  - 제보 → Severity 2
  - 기타 → Severity 1

### 성향 (Sentiment)
- 부정 → 'neg'
- 중립 → 'neu'
- 긍정 → 'pos'

### 출처 (Source)
- Naver Café 포함 → 'naver'
- 기타 → 'system'

## 파싱 결과 형식

```json
{
  "id": "voc-1698336000000-0",
  "date": "2025-10-26",
  "title": "일인칭(FPP) 모드에서 적정 시야(FOV) 설정값을 묻는 질문",
  "source": "naver",
  "category": "컨텐츠",
  "subcategory": "-",
  "type": "문의",
  "sentiment": "neu",
  "severity": 3,
  "createdAt": 1698336000000,
  "link": "1",
  "status": "new"
}
```

## 구현 상태

✅ **완료된 기능:**
- VOC 시트 파싱 함수 추가 (`parseMobileVOCSheet`)
- 심각도 자동 분류
- 성향 변환
- CI품 매핑

❌ **미구현 기능:**
- Summary 시트 파싱
- 업로드 API와 연동
- 현황판 UI 연동

## 사용 방법

### 1. Excel 파일 업로드
`/login` → `/dashboard`에서 "Mobile 모니터링 일일 보고서" 타입 선택 후 업로드

### 2. 데이터 자동 파싱
VOC 시트가 자동으로 파싱되어 이슈 목록으로 변환됨

### 3. 주간 보고서 생성
파싱된 일일 보고서를 기반으로 주간 보고서 자동 생성 가능

