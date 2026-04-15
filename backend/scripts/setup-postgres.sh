#!/bin/bash
# PostgreSQL + pgvector Docker 컨테이너 설정 스크립트

set -e

echo "🔍 Docker 설치 확인 중..."

# Docker 설치 확인
if ! command -v docker &> /dev/null; then
    echo "❌ Docker가 설치되어 있지 않습니다."
    echo ""
    echo "Docker 설치 방법:"
    echo "1. Snap을 사용한 설치 (권장):"
    echo "   sudo snap install docker"
    echo ""
    echo "2. 또는 apt를 사용한 설치:"
    echo "   sudo apt update"
    echo "   sudo apt install docker.io"
    echo "   sudo systemctl start docker"
    echo "   sudo systemctl enable docker"
    echo ""
    echo "Docker 설치 후 이 스크립트를 다시 실행하세요."
    exit 1
fi

echo "✅ Docker가 설치되어 있습니다."

# Docker 서비스 확인
if ! sudo systemctl is-active --quiet docker 2>/dev/null && ! docker ps &> /dev/null; then
    echo "⚠️  Docker 서비스가 실행되지 않았습니다."
    echo "다음 명령어로 Docker 서비스를 시작하세요:"
    echo "   sudo systemctl start docker"
    exit 1
fi

echo "✅ Docker 서비스가 실행 중입니다."

# 기존 컨테이너 확인
if docker ps -a | grep -q "pgvector"; then
    echo "⚠️  기존 pgvector 컨테이너가 발견되었습니다."
    read -p "기존 컨테이너를 삭제하고 새로 생성하시겠습니까? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🗑️  기존 컨테이너 삭제 중..."
        docker stop pgvector 2>/dev/null || true
        docker rm pgvector 2>/dev/null || true
    else
        echo "✅ 기존 컨테이너를 유지합니다."
        exit 0
    fi
fi

# 환경 변수 설정
POSTGRES_USER=${POSTGRES_USER:-wallboard}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-wallboard_pass_$(date +%s | sha256sum | head -c 8)}
POSTGRES_DB=${POSTGRES_DB:-wallboard_vectors}
POSTGRES_PORT=${POSTGRES_PORT:-5432}

echo ""
echo "📋 PostgreSQL 컨테이너 설정:"
echo "   사용자: $POSTGRES_USER"
echo "   비밀번호: $POSTGRES_PASSWORD"
echo "   데이터베이스: $POSTGRES_DB"
echo "   포트: $POSTGRES_PORT"
echo ""

# 컨테이너 실행
echo "🚀 PostgreSQL + pgvector 컨테이너 시작 중..."
docker run -d \
  --name pgvector \
  --restart unless-stopped \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DB="$POSTGRES_DB" \
  -p "$POSTGRES_PORT:5432" \
  pgvector/pgvector:pg15

# 컨테이너 시작 대기
echo "⏳ 컨테이너 시작 대기 중..."
sleep 5

# 컨테이너 상태 확인
if docker ps | grep -q "pgvector"; then
    echo "✅ PostgreSQL + pgvector 컨테이너가 성공적으로 시작되었습니다!"
    echo ""
    echo "📝 .env 파일에 다음을 추가하세요:"
    echo ""
    echo "PG_VECTOR_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:$POSTGRES_PORT/$POSTGRES_DB?schema=public"
    echo ""
    echo "다음 명령어로 pgvector 확장을 설치하세요:"
    echo "   docker exec -it pgvector psql -U $POSTGRES_USER -d $POSTGRES_DB -c 'CREATE EXTENSION vector;'"
    echo ""
    echo "또는 초기화 스크립트를 실행하세요:"
    echo "   node scripts/init-pgvector.js"
else
    echo "❌ 컨테이너 시작에 실패했습니다."
    echo "다음 명령어로 로그를 확인하세요:"
    echo "   docker logs pgvector"
    exit 1
fi
