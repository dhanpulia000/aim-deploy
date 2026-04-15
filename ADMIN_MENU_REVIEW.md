# 관리 페이지 메뉴 검토 결과

## 현재 메뉴 구조

### ✅ 활성화된 메뉴 (유지 필요)
1. **에이전트 (agents)** - 에이전트 관리, User 계정 생성 기능 포함
2. **스케줄 관리 (schedules)** - 에이전트별 근무 스케줄 관리
3. **스케줄 캘린더 (calendar)** - 스케줄 시각화
4. **SLA 정책 (sla)** - ADMIN/LEAD 권한 필요, SLA 정책 관리
5. **모니터링 제어** - 별도 페이지(`/admin/monitoring`), 링크만 있음

### ❌ 불필요한 메뉴 (제거 완료)

#### 1. 티켓 (tickets) 탭 - 제거됨 ✅
- **문제점**: 
  - 레거시 `/api/data` 엔드포인트 사용 (mock 데이터 반환)
  - 실제 이슈는 `/api/issues`를 통해 관리됨
  - 관리 페이지에서 티켓을 수동으로 추가/수정하는 기능이 실제로 사용되지 않음
- **조치**: 티켓 탭 버튼, 관련 상태, 함수, UI 모두 제거 완료

#### 2. 모니터링 URL (monitoredUrls) 관련 코드 - 제거됨 ✅
- **문제점**:
  - `activeTab` 타입에 포함되어 있지만 실제로는 사용되지 않음
  - `{false && activeTab === "monitoredUrls" &&` 로 완전히 비활성화됨
  - 관련 상태와 함수들이 남아있지만 사용되지 않음
- **조치**: 관련 상태 및 함수 제거 완료 (UI는 `{false &&` 로 감싸져 있어 실행되지 않지만, 코드 정리를 위해 완전 제거 권장)

## 완료된 작업

### ✅ 제거된 코드
1. **티켓 관련**:
   - `tickets` 상태 제거
   - `editingTicket` 상태 제거
   - `addTicket`, `editTicket`, `deleteTicket`, `saveTicket` 함수 제거
   - 티켓 탭 버튼 제거
   - 티켓 목록 UI 제거
   - 티켓 편집 폼 제거
   - `/api/data` 호출 코드 제거
   - `Ticket`, `TicketSeverity` 타입 import 제거

2. **모니터링 URL 관련**:
   - `monitoredUrls` 상태 제거
   - `editingMonitoredUrl` 상태 제거
   - `showMonitoredUrlForm` 상태 제거
   - `loadingMonitoredUrls` 상태 제거
   - `loadMonitoredUrls`, `saveMonitoredUrl`, `deleteMonitoredUrl` 함수 제거

3. **타입 정리**:
   - `activeTab` 타입에서 `"tickets"`, `"monitoredBoards"`, `"monitoring"` 제거
   - 실제 사용되는 탭만 포함: `"agents" | "schedules" | "calendar" | "sla"`

## 남아있는 코드 (선택적 정리)

### 모니터링 URL UI 코드
- 위치: `src/Admin.tsx` 라인 1250-1446
- 상태: `{false &&` 로 감싸져 있어 실행되지 않음
- 권장사항: 코드 정리를 위해 완전 제거 권장 (현재는 실행되지 않으므로 기능에는 영향 없음)

## 최종 메뉴 구조

관리 페이지(`/admin`)에는 다음 4개의 탭만 남아있습니다:

1. **에이전트** - 에이전트 관리
2. **스케줄 관리** - 근무 스케줄 관리
3. **스케줄 캘린더** - 스케줄 시각화
4. **SLA 정책** - SLA 정책 관리 (ADMIN/LEAD만)

모니터링 관련 기능은 별도 페이지(`/admin/monitoring`)로 이동되어 있습니다.

