# Prisma에서 직접 SQLite로 마이그레이션 가이드

## 완료된 작업

1. ✅ `backend/libs/db.js` - better-sqlite3로 교체
2. ✅ `backend/services/auth.service.js` - 직접 SQL 사용
3. ✅ `backend/services/agents.service.js` - 직접 SQL 사용
4. ✅ `backend/services/projects.service.js` - 직접 SQL 사용
5. ✅ `backend/package.json` - Prisma 제거, better-sqlite3 추가

## 남은 작업

### 서비스 파일 (우선순위 높음)
- [ ] `backend/services/issues.service.js` - 매우 복잡, 핵심 함수 수정 필요
- [ ] `backend/services/categories.controller.js` - Prisma 직접 사용
- [ ] `backend/services/reports.service.js`
- [ ] `backend/services/schedules.service.js`
- [ ] `backend/services/classification-rules.service.js`
- [ ] `backend/services/sla.service.js`
- [ ] `backend/services/audit.service.js`
- [ ] `backend/services/metrics.service.js`
- [ ] `backend/services/excelReport.service.js`
- [ ] `backend/services/weekly.service.js`
- [ ] `backend/services/weeklyReport.service.js`
- [ ] `backend/services/monitoring.service.js`
- [ ] `backend/services/slack.service.js`
- [ ] `backend/services/naverCafeIssues.service.js`
- [ ] `backend/services/manualIngest.service.js`
- [ ] `backend/services/articles.service.js`
- [ ] `backend/services/files.service.js`
- [ ] `backend/services/screenshotCleanup.service.js`
- [ ] `backend/services/issueClassifier.js`
- [ ] `backend/services/aiIssueClassifier.js`
- [ ] `backend/services/boardScanner.js`

### 컨트롤러 파일
- [ ] `backend/controllers/categories.controller.js` - Prisma 직접 사용
- [ ] 나머지 컨트롤러들은 대부분 서비스를 사용하므로 서비스 수정 후 자동 반영

### 스크립트 파일
- [ ] `backend/prisma/seed.js`
- [ ] `backend/scripts/*.js` (30개 이상)

### 기타 파일
- [ ] `backend/server.js` - Prisma 사용 확인
- [ ] `backend/services/issueClassifier.js`
- [ ] `backend/services/aiIssueClassifier.js`

## 주요 변경 사항

### 1. DB 연결
```javascript
// 이전 (Prisma)
const { prisma } = require('../libs/db');
const user = await prisma.user.findUnique({ where: { email } });

// 이후 (직접 SQL)
const { queryOne, query, execute } = require('../libs/db');
const user = queryOne('SELECT * FROM User WHERE email = ?', [email]);
```

### 2. 트랜잭션
```javascript
// 이전 (Prisma)
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: {...} });
  const agent = await tx.agent.create({ data: {...} });
});

// 이후 (better-sqlite3)
const { executeTransaction } = require('../libs/db');
executeTransaction(() => {
  const userResult = execute('INSERT INTO User ...', [...]);
  const agentResult = execute('INSERT INTO Agent ...', [...]);
});
```

### 3. ID 생성
```javascript
// 이전 (Prisma CUID 자동 생성)
const issue = await prisma.reportItemIssue.create({ data: {...} });

// 이후 (nanoid 사용)
const { nanoid } = require('nanoid');
const issueId = nanoid();
execute('INSERT INTO ReportItemIssue (id, ...) VALUES (?, ...)', [issueId, ...]);
```

### 4. 날짜/시간
```javascript
// 이전 (Prisma 자동 처리)
createdAt: DateTime @default(now())

// 이후 (수동 처리)
const now = new Date().toISOString();
execute('INSERT INTO ... (createdAt, updatedAt) VALUES (?, ?)', [now, now]);
```

### 5. Boolean 처리
```javascript
// SQLite는 Boolean을 INTEGER로 저장
// 저장: isActive ? 1 : 0
// 조회: isActive === 1 또는 Boolean(isActive)
```

### 6. JSON 필드
```javascript
// 이전 (Prisma 자동 처리)
channelFocus: JSON.stringify([...])

// 이후 (수동 처리)
channelFocus: JSON.stringify([...]) // 저장
channelFocus: JSON.parse(agent.channelFocus) // 조회
```

## 주의사항

1. **파라미터 바인딩**: 항상 `?` 플레이스홀더 사용, 배열로 파라미터 전달
2. **트랜잭션**: `executeTransaction` 사용 시 동기 함수로 작성
3. **날짜 형식**: ISO 8601 문자열 사용 (`new Date().toISOString()`)
4. **Boolean**: SQLite는 INTEGER로 저장하므로 1/0으로 변환
5. **NULL 처리**: `null`과 `undefined` 구분 필요
6. **관계 조회**: JOIN 또는 별도 쿼리로 처리

## 다음 단계

1. `issues.service.js` 핵심 함수 수정
2. 나머지 서비스 파일들 순차 수정
3. 컨트롤러 파일 확인 및 수정
4. 스크립트 파일 수정
5. 테스트 및 검증

