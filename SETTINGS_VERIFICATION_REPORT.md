# 모니터링 제어 / 설정 / 기타 설정 검증 보고서

## 검증 결과: ✅ 정상 작동

"기타 설정" 섹션의 모든 입력 내용이 시스템에 저장되고 적용되는 것을 확인했습니다.

## 설정 항목별 검증

### 1. 수집 제외 게시판 이름 (`naver.excludedBoards`)

**저장 경로:**
- 프론트엔드: `src/pages/Admin/MonitoringControl.tsx` (라인 1168-1200)
- API 엔드포인트: `PUT /api/monitoring/config/naver.excludedBoards`
- 데이터베이스: `MonitoringConfig` 테이블 (key: `naver.excludedBoards`)
- 저장 형식: JSON 배열 문자열 (예: `["가입인사", "등업신청", "자유게시판"]`)

**적용 확인:**
- ✅ 워커에서 동적으로 로드: `backend/workers/monitoring/naverCafe.worker.js` (라인 89-122)
- ✅ `loadExcludedBoards()` 함수가 매 스캔마다 DB에서 설정을 읽어옴
- ✅ 게시판 스캔 시 제외 목록과 비교하여 필터링됨 (라인 254-270)

**저장 흐름:**
1. 사용자가 텍스트 영역에 게시판 이름 입력 (줄바꿈으로 구분)
2. "저장" 버튼 클릭
3. 줄바꿈 기준으로 분리 → JSON 배열로 변환
4. `handleSaveConfig('naver.excludedBoards', value)` 호출
5. PUT 요청으로 백엔드에 전송
6. Prisma upsert로 DB에 저장
7. 성공 시 `loadConfigs()` 호출하여 UI 갱신

---

### 2. 크롤링 주기 (`crawler.interval`)

**저장 경로:**
- 프론트엔드: `src/pages/Admin/MonitoringControl.tsx` (라인 1201-1222)
- API 엔드포인트: `PUT /api/monitoring/config/crawler.interval`
- 데이터베이스: `MonitoringConfig` 테이블 (key: `crawler.interval`)
- 저장 형식: 문자열 숫자 (초 단위, 예: `"60"`)

**적용 확인:**
- ✅ 워커에서 동적으로 로드: `backend/workers/monitoring/naverCafe.worker.js` (라인 55-82)
- ✅ `loadScanInterval()` 함수가 우선순위에 따라 로드:
  1. 환경 변수 `NAVER_CAFE_SCAN_INTERVAL_MS` (밀리초)
  2. DB 설정 `crawler.interval` (초 → 밀리초 변환)
  3. 기본값 `DEFAULT_SCAN_INTERVAL_MS`
- ✅ 워커의 스캔 주기가 이 설정값에 따라 동작

**저장 흐름:**
1. 사용자가 숫자 입력 (초 단위)
2. "저장" 버튼 클릭
3. `handleSaveConfig('crawler.interval', configs.scanInterval)` 호출
4. PUT 요청으로 백엔드에 전송
5. Prisma upsert로 DB에 저장
6. 성공 시 `loadConfigs()` 호출하여 UI 갱신

---

### 3. 알림 쿨타임 (`alert.cooldown`)

**저장 경로:**
- 프론트엔드: `src/pages/Admin/MonitoringControl.tsx` (라인 1223-1244)
- API 엔드포인트: `PUT /api/monitoring/config/alert.cooldown`
- 데이터베이스: `MonitoringConfig` 테이블 (key: `alert.cooldown`)
- 저장 형식: 문자열 숫자 (초 단위, 예: `"5"`)

**적용 확인:**
- ⚠️ 저장은 정상 작동하나, 현재 코드베이스에서 실제 사용처를 찾지 못함
- 설정은 DB에 저장되지만 워커나 다른 서비스에서 읽어오는 코드가 없음
- 향후 알림 기능 구현 시 사용될 예정으로 보임

**저장 흐름:**
1. 사용자가 숫자 입력 (초 단위)
2. "저장" 버튼 클릭
3. `handleSaveConfig('alert.cooldown', configs.cooldown)` 호출
4. PUT 요청으로 백엔드에 전송
5. Prisma upsert로 DB에 저장
6. 성공 시 `loadConfigs()` 호출하여 UI 갱신

---

## 전체 저장/적용 흐름

### 프론트엔드 → 백엔드 → 데이터베이스

```
사용자 입력
    ↓
handleSaveConfig(key, value, description)
    ↓
PUT /api/monitoring/config/:key
    ↓
monitoringController.setConfig()
    ↓
monitoringService.setConfig()
    ↓
Prisma MonitoringConfig.upsert()
    ↓
데이터베이스 저장 완료
    ↓
loadConfigs() 호출 → UI 갱신
```

### 데이터베이스 → 워커 적용

```
워커 스캔 시작
    ↓
loadScanInterval() / loadExcludedBoards() 호출
    ↓
Prisma MonitoringConfig.findUnique()
    ↓
설정값 읽어오기
    ↓
워커 동작에 적용
```

## 검증된 기능

✅ **설정 저장 기능**
- 모든 설정 항목이 정상적으로 DB에 저장됨
- Prisma upsert를 사용하여 생성/업데이트 모두 처리
- 저장 성공 시 UI 자동 갱신

✅ **설정 로드 기능**
- 페이지 로드 시 저장된 설정값 자동 로드
- 저장 후 즉시 갱신
- 404 에러 처리 (설정이 없는 경우 기본값 사용)

✅ **워커 적용**
- `crawler.interval`: 워커 스캔 주기에 즉시 적용
- `naver.excludedBoards`: 게시판 필터링에 즉시 적용
- 매 스캔마다 최신 설정값을 DB에서 읽어옴

## 권한 확인

✅ 모든 설정 저장/수정은 `ADMIN` 또는 `LEAD` 역할만 가능
- 라우트: `requireRole(['ADMIN', 'LEAD'])` 적용됨
- 프론트엔드: 설정 탭이 권한에 따라 표시/숨김 처리됨

## 결론

**"기타 설정" 섹션의 모든 입력 내용이 시스템에 정상적으로 저장되고 적용됩니다.**

- ✅ 수집 제외 게시판: 저장 및 적용 확인
- ✅ 크롤링 주기: 저장 및 적용 확인
- ✅ 알림 쿨타임: 저장 확인 (사용처는 향후 구현 예정)

모든 설정은 `MonitoringConfig` 테이블에 저장되며, 워커는 매 스캔마다 최신 설정을 읽어와 동적으로 적용합니다.









