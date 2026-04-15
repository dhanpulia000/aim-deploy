# PostgreSQL + pgvector 설정 가이드

## 개요

이 프로젝트는 하이브리드 방식으로 PostgreSQL + pgvector를 사용합니다:
- **기존 시스템 (SQLite)**: 모든 기존 기능 유지
- **새로운 시스템 (PostgreSQL + pgvector)**: 벡터 검색만 처리

이 방식의 장점:
- ✅ 기존 시스템 안정성 유지
- ✅ 서비스 중단 없음
- ✅ 점진적 전환 가능
- ✅ 롤백 용이

---

## 1. PostgreSQL 설치

### Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### Docker (권장)
```bash
# pgvector가 포함된 PostgreSQL 이미지 사용
docker run -d \
  --name pgvector \
  -e POSTGRES_USER=wallboard \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=wallboard_vectors \
  -p 5432:5432 \
  pgvector/pgvector:pg15
```

---

## 2. pgvector 확장 설치

### 방법 A: SQL 스크립트 실행 (권장)
```bash
# PostgreSQL에 접속
psql -U postgres -d wallboard_vectors

# pgvector 확장 설치
CREATE EXTENSION vector;

# 확인
\dx vector
```

### 방법 B: 초기화 스크립트 사용
```bash
cd backend
node scripts/init-pgvector.js
```

또는 SQL 스크립트 직접 실행:
```bash
psql -U postgres -d wallboard_vectors -f scripts/setup-pgvector.sql
```

---

## 3. 환경 변수 설정

`.env` 파일에 다음 추가:

```env
# PostgreSQL + pgvector 연결 (벡터 검색 전용)
PG_VECTOR_URL=postgresql://wallboard:your_password@localhost:5432/wallboard_vectors?schema=public

# 기존 SQLite 연결 (모든 기존 기능용, 변경하지 않음)
DATABASE_URL=file:./prisma/dev.db

# OpenAI Embedding 설정 (선택사항)
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
```

**중요**: `DATABASE_URL`은 그대로 두고, `PG_VECTOR_URL`만 추가하세요.

---

## 4. 테이블 자동 생성

서버 시작 시 자동으로 테이블이 생성됩니다. 또는 수동으로 확인:

```bash
cd backend
node scripts/init-pgvector.js
```

생성되는 테이블:
- `issue_embeddings`: 이슈 벡터 임베딩 저장
  - `id`: 고유 ID
  - `issue_id`: SQLite의 이슈 ID (외래 키 역할)
  - `embedding`: vector(1536) - 벡터 임베딩
  - `created_at`, `updated_at`: 타임스탬프

---

## 5. 사용 방법

### API 엔드포인트

#### 1. 서비스 상태 확인
```bash
GET /api/vector-search/status
```

#### 2. 이슈 임베딩 생성 및 저장
```bash
POST /api/vector-search/embed
Content-Type: application/json

{
  "issueId": "issue_123"
}
```

#### 3. 유사한 이슈 검색
```bash
POST /api/vector-search
Content-Type: application/json

{
  "text": "서버 접속이 안되는 문제",
  "limit": 10,
  "threshold": 0.7
}
```

**응답 예시:**
```json
{
  "success": true,
  "data": {
    "query": "서버 접속이 안되는 문제",
    "results": [
      {
        "id": "issue_456",
        "summary": "서버 연결 오류",
        "detail": "...",
        "similarity": 0.92
      }
    ],
    "count": 5
  }
}
```

---

## 6. 통합 방법

### 기존 이슈 생성 시 자동 임베딩 생성 (선택사항)

`backend/services/issues.service.js`의 `createIssue` 함수에 추가:

```javascript
// 이슈 생성 후
const vectorSearchService = require('./vectorSearch.service').getVectorSearchService();
const embeddingService = require('./embedding.service');

if (vectorSearchService.isServiceAvailable()) {
  // 비동기로 임베딩 생성 (성능 영향 최소화)
  setImmediate(async () => {
    try {
      const embedding = await embeddingService.generateIssueEmbedding(newIssue);
      if (embedding) {
        await vectorSearchService.storeEmbedding(newIssue.id, embedding);
      }
    } catch (error) {
      logger.warn('Failed to create embedding for new issue', {
        issueId: newIssue.id,
        error: error.message
      });
    }
  });
}
```

### 배치로 기존 이슈 임베딩 생성

별도 스크립트 작성:
```javascript
// scripts/batch-create-embeddings.js
const { query } = require('../libs/db');
const vectorSearchService = require('../services/vectorSearch.service').getVectorSearchService();
const embeddingService = require('../services/embedding.service');

async function batchCreateEmbeddings() {
  const issues = query('SELECT id, summary, detail, source FROM ReportItemIssue LIMIT 100');
  
  for (const issue of issues) {
    const embedding = await embeddingService.generateIssueEmbedding(issue);
    if (embedding) {
      await vectorSearchService.storeEmbedding(issue.id, embedding);
      console.log(`✓ Created embedding for issue ${issue.id}`);
    }
  }
}

batchCreateEmbeddings();
```

---

## 7. 트러블슈팅

### pgvector 확장 설치 실패
```
ERROR: could not open extension control file
```

**해결 방법:**
- PostgreSQL 버전 확인 (14 이상 필요)
- pgvector 패키지 설치 필요:
  ```bash
  # Ubuntu/Debian
  sudo apt-get install postgresql-14-pgvector
  
  # 또는 소스에서 설치
  git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
  cd pgvector
  make
  sudo make install
  ```

### PostgreSQL 연결 실패
```
Error: connect ECONNREFUSED
```

**해결 방법:**
1. PostgreSQL 서비스 확인:
   ```bash
   sudo systemctl status postgresql
   ```
2. 포트 확인:
   ```bash
   netstat -an | grep 5432
   ```
3. 연결 문자열 확인:
   ```env
   PG_VECTOR_URL=postgresql://user:password@localhost:5432/database
   ```

### 벡터 차원 불일치
```
ERROR: dimension mismatch
```

**해결 방법:**
- OpenAI embedding 모델과 차원 확인:
  - `text-embedding-3-small`: 1536 차원
  - `text-embedding-3-large`: 3072 차원
- `.env`의 `OPENAI_EMBEDDING_DIMENSIONS` 설정 확인

---

## 8. 성능 최적화

### 인덱스 튜닝
```sql
-- 벡터 인덱스 재생성 (더 많은 리스트 사용)
DROP INDEX issue_embeddings_vector_idx;
CREATE INDEX issue_embeddings_vector_idx 
ON issue_embeddings 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 1000); -- 데이터 양에 따라 조정
```

### 연결 풀 설정
`backend/libs/db-postgres.js`에서 조정:
```javascript
pool = new Pool({
  connectionString,
  max: 20, // 최대 연결 수
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

---

## 9. 모니터링

### 벡터 검색 성능 확인
```sql
-- 인덱스 사용 여부 확인
EXPLAIN ANALYZE
SELECT issue_id, 1 - (embedding <=> $1::vector) as similarity
FROM issue_embeddings
ORDER BY embedding <=> $1::vector
LIMIT 10;

-- 임베딩 테이블 통계
SELECT 
  COUNT(*) as total_embeddings,
  COUNT(DISTINCT issue_id) as unique_issues
FROM issue_embeddings;
```

### 로그 확인
```bash
# 서버 로그에서 벡터 검색 관련 로그 확인
tail -f logs/server.log | grep VectorSearch
```

---

## 10. 다음 단계 (점진적 전환)

1. **벡터 검색 안정화** (1-2주)
   - 테스트 및 성능 최적화
   - 배치 임베딩 생성

2. **추상화 계층 활용** (2-4주)
   - 일부 읽기 전용 기능을 PostgreSQL로 전환
   - `db-adapter.js`를 통한 자동 쿼리 변환 활용

3. **전체 전환 검토** (1-3개월)
   - 모든 기능의 PostgreSQL 호환성 확인
   - 데이터 마이그레이션 스크립트 작성
   - 점진적 전환 또는 하이브리드 유지 결정

---

## 참고 자료

- [pgvector 공식 문서](https://github.com/pgvector/pgvector)
- [PostgreSQL 공식 문서](https://www.postgresql.org/docs/)
- [OpenAI Embeddings API](https://platform.openai.com/docs/guides/embeddings)
