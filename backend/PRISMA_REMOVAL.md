# Prisma 제거 완료

이 프로젝트는 Prisma를 제거하고 `better-sqlite3`로 완전히 전환되었습니다.

## 변경 사항

### ✅ 완료된 작업

1. **데이터베이스 스키마 변환**
   - `backend/libs/schema.sql`: Prisma 스키마를 SQL CREATE TABLE 문으로 변환
   - 모든 테이블, 인덱스, 외래 키 제약 조건 포함

2. **데이터베이스 초기화**
   - `backend/libs/init-db.js`: 데이터베이스 초기화 및 마이그레이션 관리 스크립트
   - 서버 시작 시 자동으로 스키마 생성

3. **서비스 레이어 전환**
   - 모든 서비스 파일(`services/*.js`)이 `better-sqlite3` 사용
   - 컨트롤러 및 워커도 `better-sqlite3` 사용

4. **의존성 정리**
   - `package.json`에서 Prisma 관련 의존성 제거 완료
   - `better-sqlite3`만 사용

## 데이터베이스 사용 방법

### 초기화

서버를 시작하면 자동으로 데이터베이스가 초기화됩니다. 수동으로 초기화하려면:

```bash
cd backend
node libs/init-db.js
```

### 데이터베이스 접근

```javascript
const { db, query, queryOne, execute } = require('./libs/db');

// 조회
const users = query('SELECT * FROM User WHERE role = ?', ['ADMIN']);
const user = queryOne('SELECT * FROM User WHERE id = ?', [1]);

// 실행
const result = execute(
  'INSERT INTO User (email, password, role) VALUES (?, ?, ?)',
  ['user@example.com', 'hashed_password', 'AGENT']
);
```

### 트랜잭션

```javascript
const { executeTransaction } = require('./libs/db');

executeTransaction(() => {
  const insert = db.prepare('INSERT INTO User (email, password) VALUES (?, ?)');
  insert.run('user1@example.com', 'hash1');
  insert.run('user2@example.com', 'hash2');
});
```

## 남은 작업 (선택사항)

다음 스크립트 파일들은 아직 Prisma를 사용하고 있지만, 유틸리티 스크립트이므로 필요할 때 교체하면 됩니다:

- `backend/scripts/*.js` - 대부분의 스크립트 파일
- `backend/prisma/seed.js` - 시드 스크립트 (새로 작성 필요)

## Prisma 폴더

`backend/prisma/` 폴더는 참고용으로 남겨두었습니다. 필요 없으면 삭제해도 됩니다.

## 장점

1. **단순성**: Prisma의 복잡한 설정과 마이그레이션 없이 직접 SQL 사용
2. **성능**: `better-sqlite3`는 네이티브 바인딩으로 빠름
3. **제어**: SQL을 직접 작성하여 더 세밀한 제어 가능
4. **디버깅**: SQL 쿼리를 직접 확인하고 수정 가능

## 주의사항

- SQLite는 Boolean을 INTEGER(0/1)로 저장합니다
- 날짜/시간은 ISO 문자열 또는 DATETIME으로 저장됩니다
- JSON 필드는 TEXT로 저장되며, 필요시 `JSON.parse()` 사용

