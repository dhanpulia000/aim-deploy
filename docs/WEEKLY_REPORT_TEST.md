# 주간보고서 테스트 방법

## 1. API로 빠르게 테스트 (백엔드 실행 중일 때)

### DB 기반 주간 보고서 다운로드 (PC / Mobile)

```bash
cd /home/young-dev/AIM/backend
node scripts/test-weekly-report.js http://127.0.0.1:8080
```

- `GET /api/reports/weekly/download?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&platform=pc|mobile` 호출
- 200이면 Excel 다운로드 성공, 500이면 데이터 없음 등 서버 에러(API 동작은 확인됨)

### Excel 업로드 기반 주간 보고서 (일일보고서 → 주간 집계)

- **프론트엔드**: 주간보고서 생성 페이지에서 “엑셀 파일로 생성” 탭 → 일일보고서 엑셀 선택, 기간·플랫폼 선택 후 생성
- **API 직접 호출** (curl):

```bash
curl -X POST http://127.0.0.1:8080/api/reports/weekly/from-excel \
  -F "file=@/path/to/일일보고서.xlsx" \
  -F "startDate=2026-01-20" \
  -F "endDate=2026-01-26" \
  -F "platform=pc" \
  -o weekly_report.xlsx
```

---

## 2. 프론트엔드에서 테스트

1. **백엔드 실행**: `cd AIM && bash scripts/safe-start.sh`
2. **프론트엔드 실행**: `cd AIM && npm run dev` → http://127.0.0.1:5173
3. **주간보고서 생성 페이지**로 이동 (메뉴에서 “주간보고서” 또는 해당 라우트)
4. **DB 기반**: 기간·플랫폼 선택 후 “다운로드” → Excel 파일 확인
5. **엑셀 기반**: “엑셀 파일로 생성” 탭에서 일일보고서 엑셀 업로드, 기간·플랫폼 선택 후 생성 → 다운로드된 Excel에서 **동향 리스트**(헤더 1행 + 구분 행 + 데이터) 레이아웃 확인

---

## 3. 템플릿 클리어 / 동향 영역 검증 (선택)

생성된 주간보고서에 템플릿 잔여 데이터가 없는지, 데이터 영역만 채워졌는지 검증:

```bash
cd /home/young-dev/AIM/backend
node scripts/test-weekly-report-template-clear.js
```

- 최소 일일보고서 엑셀 생성 후 PC/Mobile 주간보고서 생성
- 생성된 엑셀을 열어 데이터 영역 스캔 후 템플릿 플레이스홀더(샘플, 예시 등) 유무 검사

---

## 4. 확인 포인트 (동향 리스트 변경 후)

- **PC 주간보고서** SUMMARY 시트:
  - 동향 영역 **맨 위 헤더 1행**: `분류 | 플랫폼 | 주제` (그 다음 열 설명)
  - **섹션 구분**: B열에 `■ 인게임 동향`, `■ 컨텐츠 동향` 등 (한 줄씩)
  - **주제 구분**: B열에 `【 주제: … 】` (한 줄씩)
  - **데이터 행**: 분류·플랫폼·주제·설명·링크
- 데이터 수가 줄어들면 빈 행만 남고, 늘어나면 행이 자동으로 추가되는지 확인
