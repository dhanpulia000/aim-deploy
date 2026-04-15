# 로깅 시스템 가이드

이 프로젝트는 `winston`과 `winston-daily-rotate-file`을 사용하여 로깅 시스템을 구축했습니다.

## 로그 파일 위치

모든 로그는 프로젝트 루트의 `logs/` 디렉토리에 저장됩니다:

- `application-YYYY-MM-DD.log`: 모든 레벨의 로그 (info, warn, error, debug)
- `error-YYYY-MM-DD.log`: error 레벨만 기록
- `exceptions-YYYY-MM-DD.log`: 처리되지 않은 예외
- `rejections-YYYY-MM-DD.log`: 처리되지 않은 Promise rejection

## 로그 포맷

로그는 다음 형식으로 저장됩니다:

```
[YYYY-MM-DD HH:mm:ss] [LEVEL] 메시지 {"메타데이터": "값"}
```

예시:
```
[2025-12-17 05:56:56] [INFO] Server running on http://0.0.0.0:8080
[2025-12-17 05:56:56] [ERROR] Database connection failed {"error": "Connection timeout"}
```

## 로그 회전 (Rotation)

- **주기**: 매일 자정에 새로운 로그 파일 생성
- **보관 기간**: 최대 14일치 보관
- **압축**: 오래된 로그 파일은 자동으로 `.gz`로 압축됨
- **파일 크기 제한**: 파일당 최대 20MB

## 사용 방법

### 기본 사용

```javascript
const logger = require('./utils/logger');

// Info 레벨 로그
logger.info('Server started successfully');
logger.info('User logged in', { userId: 123, username: 'john' });

// Error 레벨 로그
logger.error('Database connection failed', { error: err.message });

// Warning 레벨 로그
logger.warn('API rate limit approaching', { remaining: 10 });

// Debug 레벨 로그 (개발 환경에서만 출력)
logger.debug('Processing request', { method: 'GET', url: '/api/issues' });
```

### HTTP 요청 로깅

```javascript
const logger = require('./utils/logger');

// Express 미들웨어에서 사용
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.logRequest(req, res, duration);
  });
  next();
});
```

### 환경 변수

- `LOG_LEVEL`: 로그 레벨 설정 (기본값: `info`)
  - 가능한 값: `error`, `warn`, `info`, `debug`
- `NODE_ENV`: `production`으로 설정 시 콘솔 출력 최소화
- `DISABLE_CONSOLE_LOG`: `true`로 설정 시 콘솔 출력 완전 비활성화

## 기존 코드와의 호환성

기존 `logger.js`의 API는 그대로 유지되므로 코드 변경 없이 사용할 수 있습니다:

```javascript
// 기존 방식 (여전히 작동)
logger.info('Message', { meta: 'data' });
logger.error('Error message', { error: err.message });
logger.warn('Warning message');
logger.debug('Debug message');
logger.logRequest(req, res, duration);
```

## 로그 파일 관리

### 로그 파일 확인

```bash
# 최신 로그 확인
tail -f logs/application-$(date +%Y-%m-%d).log

# 에러 로그만 확인
tail -f logs/error-$(date +%Y-%m-%d).log

# 압축된 로그 파일 확인
zcat logs/application-2025-12-01.log.gz
```

### 로그 파일 정리

14일이 지난 로그 파일은 자동으로 삭제됩니다. 수동으로 정리하려면:

```bash
# 14일 이상 된 로그 파일 삭제
find logs/ -name "*.log*" -mtime +14 -delete
```

## 주의사항

1. **SQLite와의 호환성**: 로거는 `fork` 모드에서만 사용해야 합니다. PM2의 `cluster` 모드는 SQLite와 호환되지 않습니다.

2. **로그 파일 권한**: 로그 디렉토리는 애플리케이션이 쓰기 권한을 가져야 합니다.

3. **디스크 공간**: 로그 파일이 누적되면 디스크 공간을 많이 사용할 수 있으므로 정기적으로 확인하세요.

4. **성능**: 로깅은 비동기로 처리되지만, 과도한 로깅은 성능에 영향을 줄 수 있습니다.











