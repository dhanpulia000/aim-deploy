# 다음 단계 가이드

## 🎯 현재 상태

✅ **완료된 작업:**
- PostgreSQL + pgvector 코드 구현 완료
- 벡터 검색 서비스 구현 완료
- 벡터 임베딩 생성 서비스 구현 완료
- API 엔드포인트 추가 완료
- 환경 변수 템플릿 추가 완료

⚠️ **필요한 작업:**
- PostgreSQL + pgvector 설치 (아직 설치되지 않음)
- Docker 설치 (또는 PostgreSQL 직접 설치)
- 환경 변수 설정 활성화
- 초기화 및 테스트

---

## 🚀 빠른 시작 (권장)

### 1단계: Docker 설치 (아직 설치되지 않은 경우)

**터미널에서 다음 명령어를 실행하세요:**

```bash
# Snap 사용 (권장)
sudo snap install docker

# 현재 사용자를 docker 그룹에 추가 (sudo 없이 사용)
sudo usermod -aG docker $USER
newgrp docker  # 또는 로그아웃 후 다시 로그인
```

**또는 설치 스크립트 실행:**
```bash
cd /home/young-dev/AIM/backend
bash scripts/install-docker.sh
```

### 2단계: 자동 설정 스크립트 실행

Docker 설치가 완료되면:

```bash
cd /home/young-dev/AIM/backend
bash scripts/auto-setup-vector-search.sh
```

이 스크립트가 자동으로:
- ✅ Docker 확인
- ✅ PostgreSQL + pgvector 컨테이너 생성 및 실행
- ✅ pgvector 확장 설치
- ✅ .env 파일 업데이트
- ✅ 테이블 초기화

### 3단계: 서버 재시작 및 테스트

```bash
# 서버 재시작
cd /home/young-dev/AIM/backend
npm start

# 다른 터미널에서 상태 확인
curl http://localhost:3000/api/vector-search/status
```

---

## 📝 수동 설정 (선택사항)

Docker 설치가 어려운 경우:

### 1. PostgreSQL 직접 설치

자세한 내용은 `scripts/INSTALL_POSTGRES.md` 참고:

```bash
# PostgreSQL 설치
sudo apt update
sudo apt install postgresql postgresql-contrib

# 데이터베이스 생성
sudo -u postgres psql <<EOF
CREATE DATABASE wallboard_vectors;
CREATE USER wallboard WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE wallboard_vectors TO wallboard;
\q
EOF

# pgvector 확장 설치 (apt 패키지)
sudo apt install postgresql-14-pgvector
# 또는 소스에서 설치 (INSTALL_POSTGRES.md 참고)

# 확장 활성화
sudo -u postgres psql -d wallboard_vectors -c "CREATE EXTENSION vector;"
```

### 2. .env 파일 설정

`.env` 파일의 주석을 해제하고 수정:

```env
# PostgreSQL + pgvector 설정
PG_VECTOR_URL=postgresql://wallboard:your_password@localhost:5432/wallboard_vectors?schema=public

# 기존 SQLite 연결 (변경하지 않음)
DATABASE_URL=file:./prisma/dev.db
```

### 3. 초기화

```bash
cd /home/young-dev/AIM/backend
node scripts/init-pgvector.js
```

---

## ✅ 설치 확인

### Docker 방식
```bash
docker ps | grep pgvector
docker exec pgvector psql -U wallboard -d wallboard_vectors -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
```

### 직접 설치 방식
```bash
sudo systemctl status postgresql
psql -U wallboard -d wallboard_vectors -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
```

---

## 🧪 테스트

### 1. 서비스 상태 확인
```bash
curl http://localhost:3000/api/vector-search/status
```

**예상 응답:**
```json
{
  "success": true,
  "data": {
    "available": true,
    "type": "postgresql + pgvector"
  }
}
```

### 2. 이슈 임베딩 생성 및 저장
```bash
curl -X POST http://localhost:3000/api/vector-search/embed \
  -H "Content-Type: application/json" \
  -d '{"issueId": "your_issue_id"}'
```

### 3. 유사한 이슈 검색
```bash
curl -X POST http://localhost:3000/api/vector-search \
  -H "Content-Type: application/json" \
  -d '{
    "text": "서버 접속이 안되는 문제",
    "limit": 10,
    "threshold": 0.7
  }'
```

---

## 📚 참고 문서

- **설치 가이드**: `scripts/INSTALL_POSTGRES.md`
- **상세 설정 가이드**: `PGVECTOR_SETUP_GUIDE.md`
- **마이그레이션 계획**: `PGVECTOR_MIGRATION_PLAN.md`

---

## 🔧 문제 해결

### Docker 권한 오류
```bash
sudo usermod -aG docker $USER
newgrp docker
```

### PostgreSQL 연결 실패
```bash
# 서비스 상태 확인
sudo systemctl status postgresql  # 직접 설치인 경우
docker ps | grep pgvector  # Docker인 경우

# 포트 확인
sudo netstat -tulpn | grep 5432
```

### pgvector 확장 없음
```bash
# Docker인 경우
docker exec -it pgvector psql -U postgres -d wallboard_vectors -c "CREATE EXTENSION vector;"

# 직접 설치인 경우
sudo -u postgres psql -d wallboard_vectors -c "CREATE EXTENSION vector;"
```

---

## 🎉 완료 후

설치 및 초기화가 완료되면:

1. ✅ 서버 재시작
2. ✅ 벡터 검색 API 테스트
3. ✅ 기존 이슈에 대한 임베딩 배치 생성 (선택사항)
4. ✅ 프론트엔드에서 벡터 검색 기능 통합 (선택사항)

자세한 내용은 `PGVECTOR_SETUP_GUIDE.md`를 참고하세요.
