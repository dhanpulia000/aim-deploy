# pgvector 마이그레이션 계획 및 대안

## 현재 상황 분석

### 위험 요소
1. **SQLite 특정 코드 의존성**
   - `better-sqlite3` 직접 사용 (libs/db.js)
   - SQLite 특정 쿼리: `DATE(i.createdAt, '+9 hours')`
   - 약 27,000줄의 코드가 데이터베이스와 관련됨

2. **데이터 마이그레이션**
   - 현재 SQLite DB 크기: 23MB
   - 서비스 중단 없이 마이그레이션 어려움

3. **테스트 범위**
   - 모든 서비스와 워커 재테스트 필요
   - 프로덕션 환경에서 검증 어려움

---

## 전략 1: 점진적 마이그레이션 (권장)

### Phase 1: 데이터베이스 추상화 계층 구축
- **목표**: SQLite와 PostgreSQL 모두 지원하는 추상화 계층 생성
- **기간**: 1-2주
- **작업**:
  ```javascript
  // libs/db-adapter.js 생성
  class DatabaseAdapter {
    constructor(dbType) {
      this.dbType = dbType; // 'sqlite' | 'postgres'
      this.db = dbType === 'sqlite' 
        ? require('./db-sqlite') 
        : require('./db-postgres');
    }
    
    query(sql, params) {
      // SQLite와 PostgreSQL 쿼리 변환
      const convertedSql = this.convertSql(sql);
      return this.db.query(convertedSql, params);
    }
    
    convertSql(sql) {
      if (this.dbType === 'postgres') {
        // DATE(i.createdAt, '+9 hours') -> 
        // (i.createdAt AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::DATE
        return sql.replace(
          /DATE\(([^,]+),\s*'\+9 hours'\)/g,
          "(($1 AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::DATE)"
        );
      }
      return sql;
    }
  }
  ```

### Phase 2: 하이브리드 운영
- **목표**: SQLite는 기존 기능, PostgreSQL은 벡터 검색만
- **기간**: 1주
- **작업**:
  - PostgreSQL에 `pgvector` 설치
  - 벡터 검색용 별도 서비스 생성
  - 기존 서비스는 SQLite 유지

### Phase 3: 점진적 전환
- **목표**: 기능별로 PostgreSQL로 전환
- **기간**: 2-4주
- **작업**:
  - 읽기 전용 기능부터 전환
  - 쓰기 기능은 나중에 전환
  - 각 단계마다 테스트

---

## 전략 2: 하이브리드 접근 (안전한 방법)

### 구조
```
기존 시스템 (SQLite)
├── 모든 기존 기능
└── 데이터 저장

새로운 시스템 (PostgreSQL + pgvector)
├── 벡터 임베딩 저장
├── 벡터 검색만 처리
└── SQLite와 동기화
```

### 구현 예시
```javascript
// services/vectorSearch.service.js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.PG_VECTOR_URL
});

class VectorSearchService {
  async storeEmbedding(issueId, embedding) {
    // PostgreSQL에만 저장
    await pool.query(
      'INSERT INTO issue_embeddings (issue_id, embedding) VALUES ($1, $2)',
      [issueId, embedding]
    );
  }
  
  async searchSimilar(textEmbedding, limit = 10) {
    // pgvector로 유사도 검색
    const result = await pool.query(
      `SELECT issue_id, embedding <=> $1::vector AS distance
       FROM issue_embeddings
       ORDER BY distance
       LIMIT $2`,
      [textEmbedding, limit]
    );
    
    // SQLite에서 실제 이슈 데이터 조회
    const issueIds = result.rows.map(r => r.issue_id);
    const issues = query(
      'SELECT * FROM ReportItemIssue WHERE id IN (?)',
      [issueIds]
    );
    
    return issues;
  }
}
```

### 장점
- ✅ 기존 시스템 안정성 유지
- ✅ 서비스 중단 없음
- ✅ 점진적 테스트 가능
- ✅ 롤백 용이

### 단점
- ⚠️ 두 데이터베이스 동기화 필요
- ⚠️ 복잡도 증가

---

## 전략 3: SQLite 유지 + 외부 벡터 서비스

### 옵션 A: Pinecone / Weaviate 등 외부 서비스
```javascript
// services/vectorSearch.service.js
const { Pinecone } = require('@pinecone-database/pinecone');

class ExternalVectorSearch {
  async storeEmbedding(issueId, embedding) {
    await this.index.upsert([{
      id: issueId.toString(),
      values: embedding
    }]);
  }
  
  async searchSimilar(queryEmbedding) {
    const results = await this.index.query({
      vector: queryEmbedding,
      topK: 10
    });
    return results.matches;
  }
}
```

### 옵션 B: SQLite + 별도 벡터 검색 서버
- Chroma, Qdrant 등 별도 벡터 DB 사용
- SQLite는 메타데이터만 저장

### 장점
- ✅ SQLite 유지 (기존 코드 수정 최소화)
- ✅ 전문 벡터 검색 서비스 활용
- ✅ 확장성 좋음

### 단점
- ⚠️ 외부 서비스 의존성
- ⚠️ 추가 비용 가능
- ⚠️ 네트워크 지연 가능

---

## 권장사항

### 단기 (1-3개월)
**전략 2 (하이브리드) 추천**
- PostgreSQL + pgvector를 별도로 구축
- 벡터 검색 기능만 PostgreSQL 사용
- 기존 시스템은 SQLite 유지
- 안정성 최우선

### 중기 (3-6개월)
**전략 1 (점진적 마이그레이션) 진행**
- 추상화 계층 구축
- 기능별로 PostgreSQL 전환
- 철저한 테스트 후 전환

### 장기 (6개월+)
- PostgreSQL로 완전 전환 또는 하이브리드 유지

---

## 마이그레이션 체크리스트

### 준비 단계
- [ ] 데이터 백업 (SQLite 덤프)
- [ ] PostgreSQL 설치 및 설정
- [ ] pgvector 확장 설치
- [ ] 테스트 환경 구축

### 개발 단계
- [ ] 추상화 계층 구현
- [ ] SQL 쿼리 변환 함수 구현
- [ ] 벡터 검색 서비스 구현
- [ ] 통합 테스트

### 배포 단계
- [ ] 스테이징 환경 배포
- [ ] 데이터 마이그레이션 스크립트 실행
- [ ] 기능별 검증
- [ ] 프로덕션 배포 (점진적)

---

## 즉시 시작 가능한 작업

### 1. PostgreSQL + pgvector 테스트 환경 구축
```bash
# Docker로 테스트 환경 생성
docker run -d \
  --name pgvector-test \
  -e POSTGRES_PASSWORD=test \
  -p 5433:5432 \
  pgvector/pgvector:pg15
```

### 2. 벡터 검색 프로토타입 구현
- 별도 브랜치에서 개발
- 기존 코드에 영향 없음
- 검증 후 병합

### 3. 성능 벤치마크
- SQLite vs PostgreSQL
- 벡터 검색 성능 테스트
- 리소스 사용량 비교
