# 크롤러 멈춤 원인 분석

## 🔍 발견된 문제점

### 1. 중복된 `uncaughtException` 핸들러 (수정 완료)
- **위치**: `backend/workers/monitoring/naverCafe.worker.js` (line 1816, 1833)
- **문제**: 동일한 이벤트 핸들러가 두 번 등록되어 예상치 못한 동작 발생 가능
- **해결**: 중복 핸들러 제거

### 2. 프로세스 종료 시나리오

크롤러가 멈출 수 있는 주요 원인:

#### A. 시작 실패 (`start()` 함수)
```javascript
// line 1750-1757
catch (error) {
  logger.error('[NaverCafeWorker] Failed to start', {
    error: error.message,
    stack: error.stack
  });
  isRunning = false;
  process.exit(1); // 프로세스 종료
}
```

**가능한 원인**:
- 브라우저 초기화 실패 (Playwright 설치 문제)
- DB 연결 실패
- 설정 로드 실패

#### B. 예외 처리되지 않은 에러 (`uncaughtException`)
```javascript
// line 1816-1823
process.on('uncaughtException', async (error) => {
  logger.error('[NaverCafeWorker] Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  await stop();
  process.exit(1); // 프로세스 종료
});
```

**가능한 원인**:
- Promise rejection이 catch되지 않은 경우
- 동기 코드에서 예외 발생
- 브라우저 작업 중 예외 발생

#### C. 시작 시 에러 (`start().catch()`)
```javascript
// line 1843-1846
start().catch(err => {
  logger.error('[NaverCafeWorker] Startup failed', { error: err.message });
  process.exit(1); // 프로세스 종료
});
```

### 3. 자동 재시작 메커니즘

`server.js`에서 워커 프로세스가 종료되면 자동으로 재시작합니다:

```javascript
// server.js line 203-209
if (code !== 0 && code !== null) {
  logger.info(`[WorkerManager] Restarting ${workerName} in ${WORKER_RESTART_DELAY_MS}ms`);
  
  const restartTimeout = setTimeout(() => {
    logger.info(`[WorkerManager] Restarting ${workerName}...`);
    startMonitoringWorker(workerName, scriptPath);
  }, WORKER_RESTART_DELAY_MS);
}
```

**문제점**:
- 계속 실패하면 재시작 루프에 빠질 수 있음
- 재시작 횟수 제한 없음
- 에러 로그가 쌓이지만 근본 원인 해결 없이 재시작만 반복

## 🔧 개선 사항

### 1. 중복 핸들러 제거 (완료)
- ✅ `uncaughtException` 핸들러 중복 제거

### 2. 재시작 횟수 제한 추가 (권장)
```javascript
// server.js에 추가
const MAX_RESTART_ATTEMPTS = 5;
const restartCounts = new Map(); // workerName -> count

// 재시작 로직 수정
if (code !== 0 && code !== null) {
  const currentCount = restartCounts.get(workerName) || 0;
  
  if (currentCount >= MAX_RESTART_ATTEMPTS) {
    logger.error(`[WorkerManager] ${workerName} exceeded max restart attempts, stopping`);
    workerProcesses.delete(workerName);
    return;
  }
  
  restartCounts.set(workerName, currentCount + 1);
  // ... 재시작 로직
}
```

### 3. 에러 로깅 강화 (권장)
- 브라우저 초기화 실패 시 상세 로그
- DB 연결 실패 시 상세 로그
- 설정 로드 실패 시 상세 로그

### 4. 헬스체크 추가 (권장)
- 주기적으로 워커 상태 확인
- 응답 없으면 재시작

## 📋 확인 사항

### 1. 현재 프로세스 상태
```powershell
Get-Process -Name node
```
- 8개의 Node 프로세스가 실행 중 (정상)

### 2. 로그 확인
- 서버 콘솔에서 `[NaverCafeWorker]` 또는 `[WorkerManager]` 로그 확인
- 에러 메시지 확인

### 3. 브라우저 설치 확인
```bash
npx playwright install chromium
```

### 4. DB 연결 확인
- `.env` 파일의 `DATABASE_URL` 확인
- DB 파일 존재 여부 확인

### 5. 설정 확인
- `NAVER_CAFE_SCAN_INTERVAL_MS` 설정 확인
- `BROWSER_HEADLESS` 설정 확인
- `NAVER_CAFE_COOKIE` 설정 확인 (선택)

## 🚀 즉시 조치 사항

1. **서버 재시작**
   ```bash
   cd backend
   .\restart-server.bat
   ```

2. **로그 모니터링**
   - 서버 콘솔에서 크롤러 관련 에러 확인
   - `[NaverCafeWorker]` 또는 `[WorkerManager]` 로그 확인

3. **프로세스 확인**
   ```powershell
   Get-Process -Name node | Where-Object { $_.CPU -gt 0 }
   ```

## 💡 예방 조치

1. **에러 핸들링 강화**
   - 모든 비동기 작업에 try-catch 추가
   - Promise rejection 처리

2. **재시작 횟수 제한**
   - 무한 재시작 방지
   - 일정 횟수 초과 시 알림

3. **헬스체크 구현**
   - 주기적으로 워커 상태 확인
   - 응답 없으면 재시작

4. **로깅 개선**
   - 에러 발생 시 상세 정보 로깅
   - 재시작 이벤트 로깅









