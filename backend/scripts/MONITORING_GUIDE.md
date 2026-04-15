# 시스템 오류 확인 가이드

## 가장 확실한 방법

### 1. 자동화된 시스템 점검 스크립트 실행

```bash
cd /home/young-dev/AIM/backend
node scripts/check-system-health.js
```

이 스크립트는 다음을 확인합니다:
- ✅ 데이터베이스 연결 상태
- ✅ 모든 프로세스 실행 상태 (서버, 크롤러, 프로세서)
- ✅ 포트 사용 상태
- ✅ 최근 에러 로그
- ✅ 데이터 무결성 (제목=본문 중복 등)
- ✅ 크롤러 활동 상태
- ✅ 이슈 승격 상태
- ✅ 에러 통계

### 2. 수동 확인 방법

#### 2.1 프로세스 상태 확인
```bash
ps aux | grep -E "node.*server\.js|naverCafe.*worker\.js|rawLogProcessor.*worker\.js" | grep -v grep
```

#### 2.2 포트 사용 확인
```bash
lsof -ti:8080
```

#### 2.3 최근 에러 확인
```bash
cd /home/young-dev/AIM/backend
node -e "
const { query } = require('./libs/db');
const errors = query(\`
  SELECT id, source, lastError, attempts, updatedAt
  FROM RawLog
  WHERE lastError IS NOT NULL
    AND lastError != ''
    AND updatedAt > datetime('now', '-24 hours')
  ORDER BY updatedAt DESC
  LIMIT 20
\`);
console.log('최근 24시간 내 에러:', errors.length, '개');
errors.forEach(e => console.log('  -', e.id, ':', e.lastError?.substring(0, 100)));
"
```

#### 2.4 처리 실패한 항목 확인
```bash
cd /home/young-dev/AIM/backend
node -e "
const { query } = require('./libs/db');
const failed = query(\`
  SELECT id, source, lastError, attempts
  FROM RawLog
  WHERE processingStatus = 'FAILED'
  ORDER BY updatedAt DESC
  LIMIT 10
\`);
console.log('처리 실패한 RawLog:', failed.length, '개');
failed.forEach(f => console.log('  -', f.id, ':', f.lastError?.substring(0, 100)));
"
```

#### 2.5 크롤러 활동 확인
```bash
cd /home/young-dev/AIM/backend
node -e "
const { query } = require('./libs/db');
const recent = query(\`
  SELECT COUNT(*) as count
  FROM RawLog
  WHERE source = 'naver'
    AND createdAt > datetime('now', '-1 hour')
\`);
console.log('최근 1시간 내 수집된 RawLog:', recent[0].count, '개');
"
```

#### 2.6 이슈 승격 상태 확인
```bash
cd /home/young-dev/AIM/backend
node -e "
const { query } = require('./libs/db');
const pending = query(\`
  SELECT COUNT(*) as count
  FROM RawLog
  WHERE source = 'naver'
    AND isProcessed = 0
    AND processingStatus = 'PENDING'
\`);
console.log('처리 대기 중인 RawLog:', pending[0].count, '개');
"
```

### 3. 로그 파일 확인 (있는 경우)

```bash
# 로그 디렉토리 확인
ls -la /home/young-dev/AIM/backend/logs/

# 최근 로그 확인
tail -100 /home/young-dev/AIM/backend/logs/app.log | grep -i error
```

### 4. 실시간 모니터링

```bash
# 프로세스 모니터링
watch -n 5 'ps aux | grep -E "node.*server\.js|naverCafe.*worker\.js|rawLogProcessor.*worker\.js" | grep -v grep'

# 포트 모니터링
watch -n 5 'lsof -ti:8080'
```

## 정기 점검 스케줄

### 권장 사항
- **매시간**: 시스템 점검 스크립트 실행
- **매일**: 처리 실패한 항목 확인 및 수동 처리
- **매주**: 데이터 무결성 확인 및 정리

### cron 설정 예시
```bash
# 매시간 시스템 점검
0 * * * * cd /home/young-dev/AIM/backend && node scripts/check-system-health.js >> /var/log/system-health.log 2>&1
```

## 문제 발생 시 대응

1. **프로세스가 실행되지 않는 경우**
   ```bash
   cd /home/young-dev/AIM && bash scripts/safe-start.sh
   ```

2. **대량의 처리 실패가 있는 경우**
   - 에러 로그 확인
   - 데이터베이스 상태 확인
   - 필요시 재처리 스크립트 실행

3. **백로그가 누적된 경우**
   - RawLog Processor 프로세스 확인
   - 처리 속도 확인
   - 필요시 프로세스 재시작




