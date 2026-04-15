# 현황판 데이터 흐름 가이드

현황판에서 표시되는 각 정보의 데이터 소스와 업데이트 방법을 정리합니다.

## 📊 현황판 UI 구성 요소

### 1. 에이전트 상태 패널 (우측 상단)

**표시 정보:**
- 에이전트 이름, 상태, 아바타
- 담당 게임 목록
- 오늘 처리한 티켓 수
- 현재 처리 중인 티켓 수
- 평균 처리 시간

**데이터 소스:**
```
backend/server.js → agents 배열
또는
backend/data/wallboard-data.xlsx → Agents 시트
```

**데이터 업데이트 방법:**
1. **관리 페이지** (`/admin`):
   - 에이전트 추가/수정/삭제
   - "Excel에 저장" 버튼으로 백엔드에 저장

2. **Excel 직접 수정**:
   - `backend/data/wallboard-data.xlsx` 파일 열기
   - Agents 시트에서 데이터 수정
   - 파일 저장 시 자동 반영 (5초 내)

3. **데이터 예시:**
   ```javascript
   {
     id: "a1",
     name: "Jin",
     status: "busy",  // available, busy, away, offline
     handling: 2,     // 현재 처리 중인 티켓 수
     todayResolved: 8, // 오늘 처리한 티켓 수
    avgHandleSec: 320, // 평균 처리 시간(초)
    channelFocus: ["PUBG PC"] // 담당 게임
   }
   ```

---

### 2. 이슈 큐 테이블 (중앙, 좌측)

**표시 정보:**
- 티켓 제목, 생성 시간
- 소스 (discord, naver, system)
- 심각도 (Sev1, Sev2, Sev3)
- 감성 분석 (neg, neu, pos)
- 담당자 (assigneeId)
- SLA 데드라인
- 티켓 상태 (new, triage, in_progress, waiting, resolved)
- 원문 링크

**데이터 소스:**
```
backend/server.js → tickets 배열
또는
backend/data/wallboard-data.xlsx → Tickets 시트
```

**데이터 업데이트 방법:**
1. **관리 페이지** (`/admin`):
   - 티켓 추가/수정/삭제
   - "Excel에 저장" 버튼으로 백엔드에 저장

2. **Excel 직접 수정**:
   - `backend/data/wallboard-data.xlsx` 파일 열기
   - Tickets 시트에서 데이터 수정
   - 파일 저장 시 자동 반영

3. **데이터 예시:**
   ```javascript
   {
     id: "t101",
     title: "[버그] 결제 실패 보고 증가",
     source: "discord", // discord, naver, system
     createdAt: 1704067200000, // 타임스탬프
     slaDeadlineAt: 1704070800000, // SLA 데드라인
     severity: 1, // 1=심각, 2=중간, 3=경미
     sentiment: "neg", // neg, neu, pos
     status: "triage", // new, triage, in_progress, waiting, resolved
     assigneeId: "a2", // 에이전트 ID
     link: "#", // 원문 링크
     tags: ["결제", "버그"]
   }
   ```

---

### 3. KPI 지표 카드 (상단)

#### 3-1. 열린 이슈
**데이터:**
```javascript
tickets.filter(t => 
  ["new", "triage", "in_progress", "waiting"].includes(t.status)
).length
```

**소스:** 티켓 데이터에서 계산

---

#### 3-2. Sev1 (심각)
**데이터:**
```javascript
tickets.filter(t => t.severity === 1).length
```

**소스:** 티켓 데이터에서 계산

---

#### 3-这一时期 SLA 임박
**데이터:**
```javascript
tickets.filter(t => 
  t.slaDeadlineAt && (t.slaDeadlineAt - Date.now() < 600000)
).length
```

**소스:** 티켓 데이터에서 계산 (10분 이내 마감)

---

#### 3-4. 평균 처리 중앙값
**데이터:**
```javascript
const times = agents.map(a => a.avgHandleSec).sort((a,b)=>a-b);
times[Math.floor(times.length/2)]
```

**소스:** 에이전트 데이터에서 계산

---

### 4. 필터 기능

**소스 필터:**
- dropdown에서 discord, naver, system 선택
- 티켓의 `source` 필드로 필터링

**심각도 필터:**
- dropdown에서 Sev1, Sev2, Sev3 선택
- 티켓의 `severity` 필드로 필터링

---

## 🔄 데이터 흐름도

```
┌─────────────────────────────────────────────────────────────┐
│                    데이터 소스                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Excel 파일 (wallboard-data.xlsx)                        │
│     ↓                                                        │
│     Agents 시트  →  agents 배열                             │
│     Tickets 시트 →  tickets 배열                            │
│                                                              │
│  2. 관리 페이지 (/admin)                                    │
│     ↓                                                        │
│     에이전트/티켓 추가/수정                                  │
│     ↓                                                        │
│     POST /api/data                                          │
│     ↓                                                        │
│     agents, tickets 업데이트                                │
│                                                              │
│  3. 일일 보고서 업로드 (/dashboard)                         │
│     ↓                                                        │
│     Excel 파일 업로드                                        │
│     ↓                                                        │
│     POST /api/upload-report                                 │
│     ↓                                                        │
│     reports 저장 (향후 agents 업데이트 가능)                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                   백엔드 서버 (server.js)                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  GET /api/data                                              │
│    → { agents, tickets } 반환                               │
│                                                              │
│  WebSocket (ws://localhost:8081)                            │
│    → 5초마다 agents, tickets 브로드캐스트                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                   프론트엔드 (현황판)                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 초기 로드                                               │
│     fetch('/api/data') → 데이터 표시                         │
│                                                              │
│  2. 실시간 업데이트                                          │
│     WebSocket 연결                                           │
│     → 데이터 변경 시 자동 업데이트                           │
│                                                              │
│  3. 필터링                                                  │
│     로컬 상태에서 필터 적용                                  │
│     → 화면 재렌더링                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📝 데이터 입력 방법 요약

### 방법 1: 관리 페이지 사용 (추천)
1. 현황판 → "관리" 버튼 클릭 (`/admin`)
2. 에이전트 또는 티켓 탭 선택
3. "+ 추가" 또는 "수정" 클릭
4. 데이터 입력
5. "Excel에 저장" 클릭

### 방법 2: Excel 직접 수정
1. `backend/data/wallboard-data.xlsx` 파일 열기
2. Agents 또는 Tickets 시트에서 데이터 수정
3. 저장
4. 5초 내 자동 반영

### 방법 3: Google Sheets 연동
1. Google Sheets API 설정 (`google-sheets-setup.md` 참고)
2. `google-sheets-server.js` 실행
3. Sheets에서 직접 수정 시 자동 반영

---

## 🔌 API 엔드포인트

### 데이터 조회
```bash
GET http://localhost:8080/api/data
→ { agents: [...], tickets: [...] }
```

### 데이터 저장
```bash
POST http://localhost:8080/api/data
Body: { agents: [...], tickets: [...] }
→ Excel에 저장하고 WebSocket으로 브로드캐스트
```

### 에이전트 단독 조회
```bash
GET http://localhost:8080/api/agents
→ [...]
```

### 티켓 단독 조회
```bash
GET http://localhost:8080/api/tickets
→ [...]
```

### 티켓 추가
```bash
POST http://localhost:8080/api/tickets
Body: { title, source, severity, ... }
```

---

## 💡 실시간 업데이트

### WebSocket 연결
```javascript
const ws = new WebSocket('ws://localhost:8081');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'update') {
    setAgents(data.agents);
    setTickets(data.tickets);
  }
};
```

### 업데이트 주기
- 백엔드: 5초마다 모든 클라이언트에 브로드캐스트
- Excel 파일 변경: 5초마다 파일 변경 감지 및 업데이트

---

## 🎯 데이터 구조 참고

### Excel 파일 구조

**Agents 시트:**
| id | name | status | handling | todayResolved | avgHandleSec | channelFocus |
|----|------|--------|----------|---------------|--------------|--------------|
| a1 | Jin  | busy   | 2        | 8             | 320          | PUBG PC      |

**Tickets 시트:**
| id | title | source | createdAt | slaDeadlineAt | severity | sentiment | status | assigneeId | link | tags |
|----|-------|--------|-----------|---------------|----------|-----------|--------|------------|------|------|
| t1 | 버그  | discord| 2024-01-01| 2024-01-02    | 1        | neg       | new    | a1         | #    | 버그 |

---

## ⚠️ 주의사항

1. **Excel 파일 열림**: 파일이 열려있으면 업데이트가 반영되지 않을 수 있습니다.
2. **서버 재시작**: 서버를 재시작하면 메모리의 데이터가 초기화됩니다.
3. **데이터 백업**: 중요한 데이터는 정기적으로 백업하세요.
4. **파일 크기**: Excel 파일은 1MB 이하를 권장합니다.

