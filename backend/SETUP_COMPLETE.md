# ✅ PostgreSQL + pgvector 설정 완료!

## 완료된 작업

- ✅ Docker 설치 및 설정
- ✅ PostgreSQL + pgvector 컨테이너 생성 및 실행
- ✅ pgvector 확장 설치 (버전 0.8.1)
- ✅ issue_embeddings 테이블 생성
- ✅ .env 파일 설정 완료 (PG_VECTOR_URL)

## 다음 단계

### 1. 서버 재시작

```bash
# PM2 사용 (프로덕션)
pm2 restart all

# 또는 npm start (개발)
npm start
```

### 2. 벡터 검색 서비스 상태 확인

```bash
curl http://localhost:8080/api/vector-search/status
```

또는 브라우저에서:
```
http://localhost:8080/api/vector-search/status
```

### 3. API 테스트

#### 서비스 상태 확인
```bash
curl http://localhost:8080/api/vector-search/status
```

#### 이슈 임베딩 생성 및 저장
```bash
curl -X POST http://localhost:8080/api/vector-search/embed \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "issueId": "your_issue_id",
    "text": "이슈 내용 텍스트"
  }'
```

#### 유사한 이슈 검색
```bash
curl -X POST http://localhost:8080/api/vector-search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "text": "서버 접속이 안되는 문제",
    "limit": 10
  }'
```

## 설정 정보

- **컨테이너 이름**: pgvector
- **데이터베이스**: wallboard_vectors
- **사용자**: wallboard
- **포트**: 5432
- **pgvector 버전**: 0.8.1

## 문제 해결

### 컨테이너 상태 확인
```bash
docker ps | grep pgvector
docker logs pgvector
```

### 컨테이너 재시작
```bash
docker restart pgvector
```

### pgvector 확장 확인
```bash
docker exec pgvector psql -U wallboard -d wallboard_vectors -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
```

### 테이블 확인
```bash
docker exec pgvector psql -U wallboard -d wallboard_vectors -c "\d issue_embeddings"
```

## 참고 문서

- `PGVECTOR_SETUP_GUIDE.md` - 상세 설정 가이드
- `NEXT_STEPS.md` - 다음 단계 가이드
- `QUICK_SETUP.md` - 빠른 설정 가이드
