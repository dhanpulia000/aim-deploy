# Excel 파일 형식 가이드

현황판에서 사용하는 Excel 파일의 정확한 형식입니다.

## 파일 위치
`backend/data/wallboard-data.xlsx`

---

## 📋 Agents 시트

### 컬럼 정의

| 컬럼명 | 설명 | 예시 | 필수 |
|--------|------|------|------|
| id | 에이전트 고유 ID | a1, a2, a3 | ✅ |
| name | 에이전트 이름 | Jin, Ara, Min | ✅ |
| status | 현재 상태 | available, busy, away, offline | ✅ |
| handling | 현재 처리 중인 티켓 수 | 2, 0, 5 | ✅ |
| todayResolved | 오늘 처리한 티켓 수 | 8, 5, 10 | ✅ |
| avgHandleSec | 평균 처리 시간(초) | 320, 410, 290 | ✅ |
| channelFocus | 담당 게임 (쉼표로 구분) | PUBG PC, PUBG MOBILE | ✅ |

### 상태 값
- `available`: 이용 가능
- `busy`: 바쁨
- `away`: 자리비움
- `offline`: 오프라인

### 예시 데이터

```
id  | name | status     | handling | todayResolved | avgHandleSec | channelFocus
a1  | Jin  | busy       | 2        | 8             | 320          | PUBG PC
a2  | Ara  | available  | 0        | 5             | 410          | PUBG MOBILE,PUBG NEW STATE
a3  | Min  | away       | 0        | 3             | 520          | PUBG MOBILE
a4  | Hyeon| busy       | 1        | 10            | 290          | PUBG PC,PUBG ESPORTS
```

---

## 📋 Tickets 시트

### 컬럼 정의

| 컬럼명 | 설명 | 예시 | 필수 |
|--------|------|------|------|
| id | 티켓 고유 ID | t101, t102 | ✅ |
| title | 티켓 제목 | [버그] 결제 실패 | ✅ |
| source | 소스 | discord, naver, system | ✅ |
| createdAt | 생성 시간 | 2024-01-01 10:00:00 | ✅ |
| slaDeadlineAt | SLA 데드라인 | 2024-01-01 12:00:00 | - |
| severity | 심각도 | 1, 2, 3 | ✅ |
| sentiment | 감성 분석 | neg, neu, pos | ✅ |
| status | 상태 | new, triage, in_progress, waiting, resolved | ✅ |
| assigneeId | 담당자 ID | a1, a2, - | - |
| link | 원문 링크 | #, https://... | - |
| tags | 태그 (쉼표로 구분) | 결제,버그 | - |

### 값 설명

**Source:**
- `discord`: Discord 채널
- `naver`: 네이버 카페
- `system`: 시스템 자동 생성

**Severity:**
- `1`: Sev1 (심각) - 빨간색 표시
- `2`: Sev2 (중간) - 노란색 표시
- `3`: Sev3 (경미) - 회색 표시

**Sentiment:**
- `neg`: 부정 (빨간 배지)
- `neu`: 중립 (회색 배지)
- `pos`: 긍정 (초록 배지)

**Status:**
- `new`: 신규
- `triage`: 분류 중
- `in_progress`: 진행 중
- `waiting`: 대기 중
- `resolved`: 해결됨

### 예시 데이터

```
id   | title                    | source  | createdAt        | slaDeadlineAt   | severity | sentiment | status    | assigneeId | link | tags
t101 | [버그] 결제 실패         | discord | 2024-01-01 10:00 | 2024-01-01 12:00| 1        | neg       | triage    | -          | #    | 결제,버그
t102 | 렉 심함 - 서버           | naver   | 2024-01-01 09:30 | 2024-01-01 11:00| 2        | neg       | new       | -          | #    | 렉,서버
t103 | 신규 유저 가이드 좋네요   | discord | 2024-01-01 11:00 |                 | 3        | pos       | new       | -          | #    |
t104 | 이벤트 당첨자 문의       | naver   | 2024-01-01 08:00 |                 | 3        | neu       | in_progress| a2        | #    |
```

---

## 💡 사용 팁

### 1. 날짜 형식
Excel에서 날짜 형식으로 입력:
```
2024-01-01 10:00:00
또는
2024-01-01
```

### 2. 빈 값 처리
- 담당자가 없으면: `-` 입력 또는 빈 셀
- 태그가 없으면: 빈 셀
- SLA가 없으면: 빈 셀

### 3. 쉼표 구분
채널/태그는 쉼표로 구분:
```
discord,naver
결제,버그,긴급
```

### 4. 새 시트 추가
파일을 열어 새 시트를 추가할 수도 있습니다:
- 시트명: Agents, Tickets (대소문자 구분)
- 순서는 무관

---

## 🔧 샘플 파일 생성

백엔드 서버를 처음 실행하면 자동으로 샘플 파일이 생성됩니다:
- 위치: `backend/data/wallboard-data.xlsx`
- 에이전트 4명, 티켓 4개 포함

---

## ⚠️ 주의사항

1. **시트 이름**: 반드시 "Agents", "Tickets"여야 합니다.
2. **컬럼명**: 첫 번째 행은 헤더로 사용됩니다.
3. **숫자 필드**: handling, todayResolved, avgHandleSec, severity는-class must be numbers.
4. **날짜**: Excel의 날짜 형식으로 입력하세요.
5. **파일 열림**: 파일이 열려있으면 자동 업데이트가 안 됩니다.

