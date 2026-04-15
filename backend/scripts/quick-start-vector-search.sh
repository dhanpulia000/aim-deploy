#!/bin/bash
# 벡터 검색 빠른 시작 스크립트
# PostgreSQL + pgvector 설치 및 초기화 자동화

set -e

echo "🚀 벡터 검색 환경 설정 시작..."
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BACKEND_DIR"

# 1. Docker 설치 확인 및 설치 제안
if ! command -v docker &> /dev/null; then
    echo "⚠️  Docker가 설치되어 있지 않습니다."
    echo ""
    echo "다음 명령어로 Docker를 설치할 수 있습니다:"
    echo "   sudo snap install docker"
    echo "   # 또는"
    echo "   sudo apt update && sudo apt install docker.io"
    echo ""
    read -p "지금 Docker를 설치하시겠습니까? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "📦 Docker 설치 중..."
        sudo snap install docker || sudo apt install docker.io
        echo "✅ Docker 설치 완료"
        echo ""
        echo "⚠️  현재 사용자를 docker 그룹에 추가하려면:"
        echo "   sudo usermod -aG docker $USER"
        echo "   newgrp docker"
        echo ""
        read -p "계속하시겠습니까? (Docker를 수동으로 시작해야 할 수 있습니다) (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        echo "❌ Docker 없이는 PostgreSQL 컨테이너를 실행할 수 없습니다."
        echo "INSTALL_POSTGRES.md 파일을 참고하여 수동으로 설치하세요."
        exit 1
    fi
fi

# 2. PostgreSQL 컨테이너 확인/생성
if docker ps -a | grep -q "pgvector"; then
    if docker ps | grep -q "pgvector"; then
        echo "✅ pgvector 컨테이너가 이미 실행 중입니다."
    else
        echo "🔄 기존 pgvector 컨테이너 시작 중..."
        docker start pgvector
        sleep 3
    fi
else
    echo "📦 PostgreSQL + pgvector 컨테이너 생성 중..."
    bash "$SCRIPT_DIR/setup-postgres.sh"
fi

# 3. 컨테이너에서 pgvector 확장 설치 확인
echo ""
echo "🔍 pgvector 확장 확인 중..."

CONTAINER_NAME="pgvector"
DB_NAME="wallboard_vectors"
DB_USER="wallboard"

# 컨테이너 내에서 pgvector 확장 설치 확인 및 설치
VECTOR_CHECK=$(docker exec $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME -tAc "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')" 2>/dev/null || echo "false")

if [ "$VECTOR_CHECK" = "t" ]; then
    echo "✅ pgvector 확장이 이미 설치되어 있습니다."
else
    echo "📦 pgvector 확장 설치 중..."
    docker exec $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS vector;" || {
        echo "⚠️  권한 오류. 수동으로 설치해야 합니다:"
        echo "   docker exec -it $CONTAINER_NAME psql -U postgres -d $DB_NAME -c 'CREATE EXTENSION vector;'"
    }
fi

# 4. .env 파일 업데이트
echo ""
echo "📝 .env 파일 확인 중..."

if ! grep -q "PG_VECTOR_URL" .env 2>/dev/null || grep -q "^#.*PG_VECTOR_URL" .env 2>/dev/null; then
    echo "📝 .env 파일에 PG_VECTOR_URL 추가 중..."
    
    # Docker 컨테이너에서 연결 정보 추출
    DB_PASSWORD=$(docker exec $CONTAINER_NAME printenv POSTGRES_PASSWORD 2>/dev/null || echo "wallboard_pass")
    PORT=$(docker port $CONTAINER_NAME 5432 2>/dev/null | cut -d: -f2 || echo "5432")
    
    VECTOR_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost:$PORT/$DB_NAME?schema=public"
    
    # 기존 주석 처리된 PG_VECTOR_URL 제거
    sed -i '/^#.*PG_VECTOR_URL/d' .env 2>/dev/null || true
    
    # 새로운 PG_VECTOR_URL 추가
    if ! grep -q "^PG_VECTOR_URL" .env 2>/dev/null; then
        echo "" >> .env
        echo "# PostgreSQL + pgvector 설정" >> .env
        echo "PG_VECTOR_URL=$VECTOR_URL" >> .env
    else
        sed -i "s|^PG_VECTOR_URL=.*|PG_VECTOR_URL=$VECTOR_URL|" .env
    fi
    
    echo "✅ .env 파일 업데이트 완료"
else
    echo "✅ PG_VECTOR_URL이 이미 설정되어 있습니다."
fi

# 5. 초기화 스크립트 실행
echo ""
echo "🔧 데이터베이스 테이블 초기화 중..."
node "$SCRIPT_DIR/init-pgvector.js" || {
    echo "⚠️  초기화 스크립트 실행 실패. 수동으로 실행하세요:"
    echo "   node scripts/init-pgvector.js"
}

echo ""
echo "✅ 설정 완료!"
echo ""
echo "다음 단계:"
echo "1. 서버 재시작: npm start (또는 pm2 restart all)"
echo "2. 서비스 상태 확인: curl http://localhost:3000/api/vector-search/status"
echo "3. 테스트: curl -X POST http://localhost:3000/api/vector-search/embed -H 'Content-Type: application/json' -d '{\"issueId\":\"test_issue\"}'"
echo ""
