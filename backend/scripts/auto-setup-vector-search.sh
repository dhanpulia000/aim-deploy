#!/bin/bash
# 벡터 검색 자동 설정 스크립트 (비대화형)
# Docker가 이미 설치되어 있다고 가정하고 진행

set -e

echo "🚀 벡터 검색 환경 자동 설정 시작..."
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BACKEND_DIR"

# 1. Docker 설치 확인
if ! command -v docker &> /dev/null; then
    echo "❌ Docker가 설치되어 있지 않습니다."
    echo ""
    echo "먼저 다음 명령어로 Docker를 설치하세요:"
    echo "   sudo snap install docker"
    echo "   sudo usermod -aG docker \$USER"
    echo "   newgrp docker"
    echo ""
    echo "Docker 설치 후 이 스크립트를 다시 실행하세요."
    exit 1
fi

echo "✅ Docker가 설치되어 있습니다."
docker --version

# 2. Docker 서비스 확인
if ! docker ps &> /dev/null; then
    echo "⚠️  Docker 서비스가 실행되지 않았거나 권한이 없습니다."
    echo ""
    echo "다음 중 하나를 시도하세요:"
    echo ""
    echo "방법 1: sudo를 사용하여 Docker 접근:"
    echo "   sudo docker ps"
    echo "   (이 경우 스크립트를 sudo로 실행하거나 수동으로 컨테이너 생성)"
    echo ""
    echo "방법 2: 새 쉘 세션에서 실행 (권장):"
    echo "   newgrp docker"
    echo "   bash scripts/auto-setup-vector-search.sh"
    echo ""
    echo "방법 3: docker.sock 권한 확인:"
    echo "   sudo chown root:docker /var/run/docker.sock"
    echo "   sudo chmod 660 /var/run/docker.sock"
    echo "   newgrp docker"
    echo ""
    exit 1
fi

echo "✅ Docker 서비스가 실행 중입니다."
echo ""

# 3. PostgreSQL 컨테이너 확인/생성
CONTAINER_NAME="pgvector"
DB_NAME="wallboard_vectors"
DB_USER="wallboard"
DB_PASSWORD="wallboard_pass_$(date +%s | sha256sum | head -c 8)"

if docker ps -a | grep -q "$CONTAINER_NAME"; then
    if docker ps | grep -q "$CONTAINER_NAME"; then
        echo "✅ pgvector 컨테이너가 이미 실행 중입니다."
        # 기존 컨테이너의 비밀번호 추출 시도
        DB_PASSWORD=$(docker exec $CONTAINER_NAME printenv POSTGRES_PASSWORD 2>/dev/null || echo "$DB_PASSWORD")
    else
        echo "🔄 기존 pgvector 컨테이너 시작 중..."
        docker start $CONTAINER_NAME
        sleep 3
        DB_PASSWORD=$(docker exec $CONTAINER_NAME printenv POSTGRES_PASSWORD 2>/dev/null || echo "$DB_PASSWORD")
    fi
else
    echo "📦 PostgreSQL + pgvector 컨테이너 생성 중..."
    
    # 기존 포트 사용 중인지 확인
    PORT=5432
    if netstat -tuln 2>/dev/null | grep -q ":$PORT "; then
        PORT=5433
        echo "⚠️  포트 5432가 사용 중입니다. 포트 $PORT를 사용합니다."
    fi
    
    docker run -d \
      --name $CONTAINER_NAME \
      --restart unless-stopped \
      -e POSTGRES_USER="$DB_USER" \
      -e POSTGRES_PASSWORD="$DB_PASSWORD" \
      -e POSTGRES_DB="$DB_NAME" \
      -p "$PORT:5432" \
      pgvector/pgvector:pg15
    
    echo "⏳ 컨테이너 시작 대기 중..."
    sleep 5
fi

# 컨테이너 상태 확인
if ! docker ps | grep -q "$CONTAINER_NAME"; then
    echo "❌ 컨테이너 시작에 실패했습니다."
    echo "다음 명령어로 로그를 확인하세요:"
    echo "   docker logs $CONTAINER_NAME"
    exit 1
fi

echo "✅ PostgreSQL + pgvector 컨테이너가 실행 중입니다."
echo ""

# 4. 컨테이너에서 pgvector 확장 설치 확인
echo "🔍 pgvector 확장 확인 중..."

VECTOR_CHECK=$(docker exec $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME -tAc "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')" 2>/dev/null || echo "false")

if [ "$VECTOR_CHECK" = "t" ]; then
    echo "✅ pgvector 확장이 이미 설치되어 있습니다."
else
    echo "📦 pgvector 확장 설치 중..."
    docker exec $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || {
        echo "⚠️  권한 오류. postgres 사용자로 설치 시도..."
        docker exec $CONTAINER_NAME psql -U postgres -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS vector;" || {
            echo "❌ pgvector 확장 설치 실패. 수동으로 설치하세요:"
            echo "   docker exec -it $CONTAINER_NAME psql -U postgres -d $DB_NAME -c 'CREATE EXTENSION vector;'"
            exit 1
        }
    }
    echo "✅ pgvector 확장 설치 완료"
fi

echo ""

# 5. 포트 확인
PORT=$(docker port $CONTAINER_NAME 5432 2>/dev/null | cut -d: -f2 | head -1 || echo "5432")

# 6. .env 파일 업데이트
echo "📝 .env 파일 확인 중..."

VECTOR_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost:$PORT/$DB_NAME?schema=public"

# 기존 주석 처리된 PG_VECTOR_URL 제거
if [ -f .env ]; then
    sed -i '/^#.*PG_VECTOR_URL/d' .env 2>/dev/null || true
    
    # 새로운 PG_VECTOR_URL 추가 또는 업데이트
    if grep -q "^PG_VECTOR_URL=" .env 2>/dev/null; then
        sed -i "s|^PG_VECTOR_URL=.*|PG_VECTOR_URL=$VECTOR_URL|" .env
        echo "✅ PG_VECTOR_URL 업데이트 완료"
    else
        # PG_VECTOR_URL이 없으면 추가
        if ! grep -q "PG_VECTOR_URL" .env 2>/dev/null; then
            echo "" >> .env
            echo "# PostgreSQL + pgvector 설정" >> .env
            echo "PG_VECTOR_URL=$VECTOR_URL" >> .env
            echo "✅ PG_VECTOR_URL 추가 완료"
        fi
    fi
else
    echo "⚠️  .env 파일이 없습니다."
    exit 1
fi

echo ""

# 7. 초기화 스크립트 실행
echo "🔧 데이터베이스 테이블 초기화 중..."

if [ -f "$SCRIPT_DIR/init-pgvector.js" ]; then
    node "$SCRIPT_DIR/init-pgvector.js" 2>&1 || {
        echo "⚠️  초기화 스크립트 실행 중 오류가 발생했습니다."
        echo "수동으로 실행하세요:"
        echo "   node scripts/init-pgvector.js"
    }
else
    echo "⚠️  초기화 스크립트를 찾을 수 없습니다."
fi

echo ""
echo "✅ 설정 완료!"
echo ""
echo "📋 설정 정보:"
echo "   컨테이너 이름: $CONTAINER_NAME"
echo "   데이터베이스: $DB_NAME"
echo "   사용자: $DB_USER"
echo "   포트: $PORT"
echo "   연결 URL: $VECTOR_URL"
echo ""
echo "다음 단계:"
echo "1. 서버 재시작: npm start (또는 pm2 restart all)"
echo "2. 서비스 상태 확인: curl http://localhost:3000/api/vector-search/status"
echo "3. 테스트: node -e \"const fetch = require('node-fetch'); fetch('http://localhost:3000/api/vector-search/status').then(r => r.json()).then(console.log)\""
echo ""
