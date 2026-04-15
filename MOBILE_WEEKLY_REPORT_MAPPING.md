# Mobile 주간보고서 자동 생성 매핑

## 주간보고서 시트 부칙
1. **[10월5주차]** - 메인 시트
2. **주요 이/

## 주요 이슈 건수 증감 시트

### 컬럼 구조
| 컬럼명 | 설명 | 데이터 소스 |
|--------|------|------------|
| 순위 | 이슈 순위 | 집계 후 정렬 |
| 주요 이슈 구분 | 이슈 카테고리 | VOC 대분류 + Issue 분류 |
| 주요 내용 (요약) | 하위 카테고리 상세 | VOC 중분류 |
| 전주 건수 | 전주 총 건수 | 전주 데이터 |
| 건수 | 이번주 총 건수 | 이번주 VOC + Issue |
| 전주 비율 | 전주 비율 | 전주건수/전주MO취합량 |
| 비율 | 이번주 비율 | 이번주건수/이번주MO취합량 |
| 증감 | 증감 방향 | ▲ 또는 ▼ |
| 전주 대비 % | 증감률 | (이번주-전주)/전주*100 |

### 주요 이슈 구분 매핑
| 주간보고서 카테고리 | 일일보고서 매핑 |
|-------------------|----------------|
| 유료 아이템 | VOC: 유료 |
| 게임 플레이 관련 문의 | VOC: 컨텐츠, Issue: 게임플레이 |
| 버그 | Issue: 버그 |
| 서버/접속 | VOC: 서버, Issue: 서버 |
| 커뮤니티/이스포츠 | VOC: 커뮤니티, 이스포츠 |
| 불법프로그램 | Cheat&Abuse 시트 |
| 비매너 행위 | VOC: 비매너 관련 |
| 이용 제한 조치 | VOC: 이용제한 |
| 타게임 | VOC: 타게임 |

### 집계 로직
```javascript
function aggregateMajorIssues(vocData, issueData, cheatData, currentWeek, prevWeek) {
  const categories = {
    '유료 아이템': vocData.filter(v => v.category === '유료').length,
    '게임 플레이 관련 문의': vocData.filter(v => v.category === '컨텐츠').length + 
                           issueData.filter(i => i.category === '게임플레이').length,
    '버그': issueData.filter(i => i.category === '버그').length,
    '서버/접속': vocData.filter(v => v.category === '서버').length + 
                issueData.filter(i => i.category === '서버').length,
    '커뮤니티/이스포츠': vocData.filter(v => ['커뮤니티', '이스포츠'].includes(v.category)).length,
    '불법프로그램': cheatData.length,
    '비매너 행위': vocData.filter(v => v.subcategory.includes('비매너')).length,
    '이용 제한 조치': vocData.filter(v => v.subcategory.includes('이용제한')).length,
    '타게임': vocData.filter(v => v.category === '타게임').length
  };
  
  // 전주 대비 증감 계산
  return Object.entries(categories).map(([category, currentCount]) => {
    const prevCount = prevWeek[category] || 0;
    const change = currentCount - prevCount;
    const changePercent = prevCount > 0 ? ((change / prevCount) * 100).toFixed(1) : '0.0';
    
    return {
      category,
      prevCount,
      currentCount,
      change,
      changePercent,
      arrow: change > 0 ? '▲' : change < 0 ? '▼' : '-'
    };
  }).sort((a, b) => b.currentCount - a.currentCount); // 건수 기준 정렬
}
```

## 공유 이슈 시간 순 시트

### 컬럼 구조
| 컬럼명 | 설명 | 데이터 소스 |
|--------|------|------------|
| 공유 이슈 | 이슈 제목 + 날짜 + 상태 | Issue/VOC 중요 이슈 |

### 공유 이슈 선택 기준
- Severity 1 또는 2 (높은 심각도)
- 특정 키워드 포함 (예: 비정상 종료, 오류 등)
- 공유 여부가 표시된 이슈
- 날짜 + 상태 표시: `YYYY-MM-DD (공유 완료)` 또는 `(업무 시간 외 공유)`

### 예시 데이터
```
공유 이슈 예시 - 10/21 (공유 완료)
공유 이슈 예시 - 10/22 (업무 시간 외 공유)
영혼의 각인-SCAR-L 의 피격이 보이지 않는 현상에 대한 제보 - 10/27 (공유 완료)
```

### 집계 로직
```javascript
function extractSharedIssues(issueData, vocData) {
  // Severity 1 또는 2 이슈만 필터링
  const criticalIssues = [
    ...issueData.filter(i => i.severity <= 2),
    ...vocData.filter(v => v.severity <= 2)
  ];
  
  // 시간순 정렬
  const sortedIssues = criticalIssues.sort((a, b) => a.createdAt - b.createdAt);
  
  // 공유 이슈 형식으로 변환
  return sortedIssues.map(issue => ({
    date: issue.date,
    title: issue.title,
    status: '공유 완료', // 또는 '업무 시간 외 공유'
    formatted: `${issue.title} - ${issue.date} (공유 완료)`
  }));
}
```

## VoC 시트 (주간 보고서)

### 설명
주간보고서의 VoC 시트는 일일보고서의 VoC 데이터를 기간 내에서 집계한 시트입니다.

### 컬럼 구조
- 날짜, 출처, 대분류, 중분류, 종류, 성향, 중요도, 내용, 게시물 주소
- 일일보고서 VoC 시트와 동일한 구조

### 데이터 집계 로직
```javascript
function aggregateWeeklyVOC(dailyReports, startDate, endDate) {
  // 모든 일일보고서의 VoC 데이터 수집
  const allVOC = [];
  
  dailyReports.forEach(report => {
    if (report.data && report.data.voc) {
      report.data.voc.forEach(item => {
        const itemDate = new Date(item.date);
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        // 기간 내 데이터만 필터링
        if (itemDate >= start && itemDate <= end) {
          allVOC.push(item);
        }
      });
    }
  });
  
  // 날짜순 정렬
  return allVOC.sort((a, b) => new Date(a.date) - new Date(b.date));
}
```

## 메인 시트 구조
- **시트명**: `[10월5주차]` 형식
- **기간**: 2025-10-27 ~ 2025-11-02

## 일일보고서 → 주간보고서 데이터 매핑

### 차트 1: 성향별 주간 동향 수
**데이터 소스**: VOC 시트의 `성향` 컬럼
- 긍정: `sentiment === 'pos'` 집계
- 부정: `sentiment === 'neg'` 집계  
- 중립: `sentiment === 'neu'` 집계

### 차트 2: 이슈별 주간 동향 수
**데이터 소스**: VOC `대분류` + Issue `분류`
- 게임 플레이 문의 유료화 아이템 → 유료/컨텐츠
- 버그 → 버그
- 서버/접속/불법프로그램 → 서버/불법프로그램
- 비매너/이스포츠 → 커뮤니티

### 부정 동향 요약
**데이터 소스**: VOC + Issue (`sentiment === 'neg'`)
대분류별 상세 내용 추출

### 긍정 동향 요약
**데이터 소스**: VOC (`sentiment === 'pos'`)
대분류별 상세 내용 추출

### 기타 동향
**데이터 소스**: VOC (`sentiment === 'neu'`)

### 모니터링 업무 현황
**데이터 소스**: Summary 시트의 `취합량`
- 일별 집계
- 주별 집계 (5주 비교)

## 구현 필요 함수
1. `aggregateBySentiment()` - 성향별 집계
2. `aggregateByIssueType()` - 이슈별 집계
3. `extractDetailsByCategory()` - 대분류별 상세 추출
4. `aggregateMonitoringWork()` - 업무 현황 집계

