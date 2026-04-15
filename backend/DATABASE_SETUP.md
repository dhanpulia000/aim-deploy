# 데이터베이스 설정 가이드

## 현재 설정 (SQLite)

현재 개발 환경에서는 SQLite를 사용하고 있습니다.

### SQLite 설정

`.env` 파일에 다음을 설정:

```env
DATABASE_URL="file:./prisma/dev.db"
```

### 마이그레이션 실행

```bash
cd backend
npx prisma migrate deploy
```

또는 개발 중에는:

```bash
npx prisma migrate dev
```

---

## PostgreSQL 설정 (프로덕션)

프로덕션 환경에서 PostgreSQL을 사용하려면:

### 1. PostgreSQL 설치 및 데이터베이스 생성

```bash
# PostgreSQL 설치 (예: Ubuntu/Debian)
sudo apt-get install postgresql postgresql-contrib

# 데이터베이스 생성
sudo -u postgres psql
CREATE DATABASE agent_ops_wallboard;
CREATE USER wallboard_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE agent_ops_wallboard TO wallboard_user;
\q
```

### 2. 환경 변수 설정

`.env` 파일을 업데이트:

```env
# PostgreSQL 연결 문자열
DATABASE_URL="postgresql://wallboard_user:your_password@localhost:5432/agent_ops_wallboard?schema=public"
```

### 3. 마이그레이션 실행

```bash
cd backend
npx prisma migrate deploy
```

### 4. Prisma Client 재생성

```bash
npx prisma generate
```

---

## 스키마 호환성

현재 Prisma 스키마는 SQLite와 PostgreSQL 모두와 호환되도록 작성되었습니다:

- ✅ SQLite 특정 쿼리 사용 안 함
- ✅ Prisma 추상화 사용
- ✅ 표준 SQL 타입 사용
- ✅ 인덱스 및 관계 설정 호환

### 주의사항

1. **JSON 필드**: SQLite는 JSON을 TEXT로 저장하므로, PostgreSQL로 전환 시 자동으로 JSON 타입으로 변환됩니다.

2. **AUTO_INCREMENT vs SERIAL**: Prisma가 자동으로 처리합니다.

3. **날짜/시간**: 두 데이터베이스 모두 DATETIME/TIMESTAMP를 지원합니다.

---

## 마이그레이션 전략

### 개발 → 프로덕션 마이그레이션

1. **데이터 백업** (SQLite):
   ```bash
   sqlite3 prisma/dev.db .dump > backup.sql
   ```

2. **PostgreSQL 데이터베이스 생성** (위 참조)

3. **환경 변수 변경** (DATABASE_URL)

4. **마이그레이션 실행**:
   ```bash
   npx prisma migrate deploy
   ```

5. **데이터 마이그레이션** (필요한 경우):
   - SQLite 덤프를 PostgreSQL 형식으로 변환
   - 또는 Prisma를 통한 데이터 이전 스크립트 작성

---

## 환경 변수 예시

### 개발 (SQLite)
```env
DATABASE_URL="file:./prisma/dev.db"
NODE_ENV=development
```

### 프로덕션 (PostgreSQL)
```env
DATABASE_URL="postgresql://user:password@localhost:5432/agent_ops_wallboard?schema=public"
NODE_ENV=production
```

### Docker Compose 예시
```yaml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: agent_ops_wallboard
      POSTGRES_USER: wallboard_user
      POSTGRES_PASSWORD: your_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

---

## 문제 해결

### 연결 오류

1. **PostgreSQL 서비스 확인**:
   ```bash
   sudo systemctl status postgresql
   ```

2. **포트 확인**:
   ```bash
   netstat -an | grep 5432
   ```

3. **방화벽 설정** (프로덕션):
   - PostgreSQL 포트(5432) 열기

### 마이그레이션 오류

1. **스키마 동기화**:
   ```bash
   npx prisma db push
   ```

2. **마이그레이션 재설정** (주의: 데이터 손실 가능):
   ```bash
   npx prisma migrate reset
   ```

---

## 참고 자료

- [Prisma 공식 문서](https://www.prisma.io/docs)
- [PostgreSQL 공식 문서](https://www.postgresql.org/docs/)
- [SQLite 공식 문서](https://www.sqlite.org/docs.html)























