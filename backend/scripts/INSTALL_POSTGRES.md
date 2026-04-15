# PostgreSQL + pgvector 설치 가이드

## 현재 상황
- Docker가 설치되어 있지 않습니다.
- PostgreSQL이 설치되어 있지 않습니다.

## 설치 방법 선택

### 방법 1: Docker 사용 (권장, 가장 간단)

#### 1-1. Docker 설치
```bash
# Snap 사용 (권장)
sudo snap install docker

# 또는 apt 사용
sudo apt update
sudo apt install docker.io
sudo systemctl start docker
sudo systemctl enable docker
```

#### 1-2. 현재 사용자를 docker 그룹에 추가 (sudo 없이 사용)
```bash
sudo usermod -aG docker $USER
newgrp docker  # 또는 로그아웃 후 다시 로그인
```

#### 1-3. PostgreSQL + pgvector 컨테이너 실행
```bash
cd /home/young-dev/AIM/backend
bash scripts/setup-postgres.sh
```

이 스크립트는 자동으로:
- pgvector가 포함된 PostgreSQL 이미지 다운로드
- 컨테이너 생성 및 실행
- .env 파일 설정 안내

---

### 방법 2: PostgreSQL 직접 설치

#### 2-1. PostgreSQL 설치
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### 2-2. 데이터베이스 및 사용자 생성
```bash
sudo -u postgres psql <<EOF
CREATE DATABASE wallboard_vectors;
CREATE USER wallboard WITH PASSWORD 'your_password_here';
GRANT ALL PRIVILEGES ON DATABASE wallboard_vectors TO wallboard;
\q
EOF
```

#### 2-3. pgvector 확장 설치

**Ubuntu 22.04+ (apt 패키지 사용):**
```bash
sudo apt install postgresql-14-pgvector
# 또는 postgresql-15-pgvector (PostgreSQL 버전에 맞게)
```

**소스에서 설치 (모든 버전):**
```bash
# 필요한 패키지 설치
sudo apt install git build-essential postgresql-server-dev-14

# pgvector 다운로드 및 컴파일
cd /tmp
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install

# PostgreSQL 재시작
sudo systemctl restart postgresql
```

#### 2-4. pgvector 확장 활성화
```bash
sudo -u postgres psql -d wallboard_vectors <<EOF
CREATE EXTENSION vector;
\q
EOF
```

---

### 방법 3: 환경 변수만 설정 (나중에 설치)

PostgreSQL 설치가 어려운 경우, 환경 변수만 설정하고 벡터 검색 기능은 나중에 활성화할 수 있습니다.

`.env` 파일에 주석 처리된 설정이 이미 추가되어 있습니다:
```env
# PG_VECTOR_URL=postgresql://wallboard:your_password@localhost:5432/wallboard_vectors?schema=public
```

PostgreSQL 설치 후 주석을 해제하면 됩니다.

---

## 설치 확인

설치 후 다음 명령어로 확인:

```bash
# Docker 방식
docker ps | grep pgvector

# 직접 설치 방식
sudo systemctl status postgresql
psql -U wallboard -d wallboard_vectors -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
```

---

## .env 파일 설정

설치 완료 후 `.env` 파일에 다음을 추가/수정:

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

## 초기화 및 테스트

설치 및 환경 변수 설정 후:

```bash
cd /home/young-dev/AIM/backend

# 1. 테이블 초기화
node scripts/init-pgvector.js

# 2. 서버 시작
npm start

# 3. 서비스 상태 확인 (다른 터미널)
curl http://localhost:3000/api/vector-search/status
```

---

## 문제 해결

### Docker 권한 오류
```bash
sudo usermod -aG docker $USER
newgrp docker
```

### PostgreSQL 연결 실패
```bash
# 서비스 상태 확인
sudo systemctl status postgresql

# 포트 확인
sudo netstat -tulpn | grep 5432

# PostgreSQL 설정 확인
sudo cat /etc/postgresql/*/main/postgresql.conf | grep listen_addresses
```

### pgvector 확장 설치 실패
```bash
# PostgreSQL 버전 확인
psql --version

# pgvector 소스에서 설치
# (위의 "소스에서 설치" 섹션 참조)
```

---

## 다음 단계

설치 완료 후:
1. ✅ 환경 변수 설정
2. ✅ 초기화 스크립트 실행
3. ✅ 서버 재시작
4. ✅ 벡터 검색 API 테스트

자세한 내용은 `PGVECTOR_SETUP_GUIDE.md`를 참고하세요.
