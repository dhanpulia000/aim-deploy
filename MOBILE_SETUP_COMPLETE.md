# Mobile 주간보고서 자동 생성 기능 완료 ✅

## 구현 완료 항목

### 1. 일일보고서 파싱 (VOC, Issue, Data 시트만 사용)
- ✅ Voc 시트 파싱
- ✅ Issue 시트 파싱  
- ✅ Data 시트 파싱
- ✅ 여러 시트 동시 처리

### 2. 주간보고서 자동 생성
- ✅ 성향별 주간 동향 (긍정/부정/중립)
- ✅ 이슈별 주간 동향 (게임플레이, 버그, 서버 등)
- ✅ 주요 이슈 건수 증감 (9개 카테고리)
- ✅ 공유 이슈 시간순 정리
- ✅ 부정/긍정/기타 동향 요약
- ✅ VoC 전체 데이터 집계
- ✅ Data 시트 정보 활용

## 사용 시트

### 일일보고서
- **Voc**: 이용자 동향 전체
- **Issue**: 버그, 서버 이슈
- **Data**: 주차/날짜 정보

### 주간보고서 생성 결과
- 성향별 통계
- 이슈별 통계
- 주요 이슈 건수
- 공유 이슈 목록
- VoC 데이터 전체

## 테스트 방법

1. **백엔드 서버 시작**
   ```bash
   cd backend
   node server.js
   ```

2. **브라우저에서 접속**
   - http://localhost:5173/login

3. **일일보고서 업로드**
   - 파일 타입: "Mobile 모니터링 일일 보고서.xlsx"
   - 파일 선택 및 업로드

4. **주간보고서 생성**
   - http://localhost:5173/weekly-report
   - 기간 입력 또는 "지난 주 자동 생성" 클릭

## 파일 구조

```
backend/
├── server.js                      # 메인 서버 (VOC, Issue, Data 파싱)
├── weekly-report-generator.js     # 주간보고서 생성기
└── data/
    └── 20251027 PUBG MOBILE 모니터링 일일 보고서.xlsx

src/
├── App.tsx                        # 메인 현황판
├── Dashboard.tsx                  # 대시보드 (업로드)
└── WeeklyReportGenerator.tsx      # 주간보고서 UI
```

## 다음 단계 (선택)

1. Excel 파일 생성 로 uitmpl
2. 전주 데이터 비교 기능
3. 차트 그래프 시각화
4. PDF/Excel 다운로드 기능

