# Excel 파일 연동 설정 가이드

## 1단계: Excel 파일 생성

1. Excel 파일을 열고 두 개의 시트 생성:
   - **Agents**: 에이전트 정보
   - **Tickets**: 티켓 정보

2. `backend/data/` 폴더에 `wallboard-data.xlsx`로 저장

### Agents 시트 구조
| ID | Name | Status | Handling | TodayResolved | AvgHandleSec | ChannelFocus |
|----|------|--------|----------|---------------|--------------|--------------|
| a1 | Jin | busy | 2 | 8 | 320 | discord |
| a2 | Ara | available | 0 | 5 | 410 | naver,discord |
| a3 | Min | away | 0 | 3 | 520 | naver |
| a4 | Hyeon | busy | 1 | 10 | 290 | discord,other |

**주의사항:**
- 첫 번째 행은 헤더로 사용됩니다
- 채널은 쉼표(,)로 구분합니다
- Status는: available, busy, away, offline 중 하나

### Tickets 시트 구조
| ID | Title | Source | CreatedAt | SLADeadlineAt | Severity | Sentiment | AssigneeID | Status | Link | Tags |
|----|-------|--------|-----------|---------------|----------|-----------|------------|--------|------|------|
| t101 | [버그] 결제 실패 보고 증가 | discord | 2024-01-01 10:00:00 | 2024-01-01 11:00:00 | 1 | neg | - | triage | # | 결제,버그 |
| t102 | 렉 심함 - 주말 오후 서버 | naver | 2024-01-01 09:30:00 | 2024-01-01 10:30:00 | 2 | neg | - | new | # | 렉,서버 |

**주의사항:**
- CreatedAt, SLADeadlineAt는 날짜 형식으로 입력
- Severity는 숫자: 1=심각, 2=중간, 3=경미
- Sentiment는: neg(부정), neu(중립), pos(긍정)
- Status는: new, triage, in_progress, waiting, resolved
- AssigneeID가 없으면 빈 셀 또는 '-' 입력
- Tags는 쉼표로 구분

## 2단계: 의존성 설치

```bash
cd backend
npm install xlsx
```

## 3단계: 서버 실행

```bash
node excel-server.js
```

서버가 실행되면 자동으로:
- Excel 파일이 없으면 샘플 파일 생성
- 5초마다 파일 변경 감지
- 변경 시 자동 업데이트

## 4단계: 데이터 업데이트

Excel 파일을 직접 편집하고 저장하면 자동으로 반영됩니다.

## 시트명 변경

시트 이름을 변경하려면 `excel-server.js` 수정:
```javascript
const agentsSheet = workbook.Sheets['Agents']; // 'Agents' 대신 원하는 이름
const ticketsSheet = workbook.Sheets['Tickets']; // 'Tickets' 대신 원하는 이름
```

## 파일 경로 변경

`backend/data/` 대신 다른 위치를 사용하려면:
```javascript
const EXCEL_FILE_PATH = 'C:/Users/YourName/Documents/wallboard-data.xlsx';
```

## 샘플 Excel 파일 다운로드

서버를 처음 실행하면 자동으로 샘플 Excel 파일이 생성됩니다:
`backend/data/wallboard-data.xlsx`

## 장점

✅ Excel 파일을 직접 편집 가능 (비개발자도 사용 가능)
✅ 서버 재시작 없이 실시간 반영
✅ 추가 도구 설치 불필요
✅ 로컬 파일로 관리 가능

## 주의사항

⚠️ Excel 파일이 열려있으면 업데이트가 반영되지 않을 수 있습니다
⚠️ 파일이 삭제되면 Mock 데이터를 사용합니다
⚠️ 대용량 데이터에는 부적합합니다 (1MB 이하 권장)

