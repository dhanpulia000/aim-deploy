#!/bin/bash
# PostgreSQL + pgvector 수동 설정 스크립트
# Docker 접근이 가능한 세션에서 실행하세요

set -e

echo "🐳 PostgreSQL + pgvector 수동 설정"
echo ""

CONTAINER_NAME="pgvector"
DB_NAME="wallboard_vectors"
DB_USER="wallboard"
DB_PASSWORD="wallboard_pass_$(date +%s | sha256sum | head -c 8)"
PORT=5432

# 기존 컨테이너 확인
if docker ps -a | grep -q "$CONTAINER_NAME"; then
    if docker ps | grep -q "$CONTAINER_NAME"; then
        echo "✅ pgvector 컨테이너가 이미 실행 중입니다."
        echo "기존 컨테이너 정보:"
        docker ps | grep "$CONTAINER_NAME"
        exit 0
    else
        echo "🔄 기존 컨테이너 시작 중..."
        docker start $CONTAINER_NAME
        sleep 3
        echo "✅ 컨테이너 시작 완료"
        exit 0
    fi
fi

# 포트 확인
if netstat -tuln 2>/dev/null | grep -q ":$PORT "; then
    PORT=5433
    echo "⚠️  포트 5432가 사용 중입니다. 포트 $PORT를 사용합니다."
fi

echo "📦 PostgreSQL + pgvector 컨테이너 생성 중..."
echo "   컨테이너 이름: $CONTAINER_NAME"
echo "   데이터베이스: $DB_NAME"
echo "   사용자: $DB_USER"
echo "   비밀번호: $DB_PASSWORD"
echo "   포트: $PORT"
echo ""

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

# 컨테이너 상태 확인
if docker ps | grep -q "$CONTAINER_NAME"; then
    echo "✅ 컨테이너가 성공적으로 시작되었습니다!"
    echo ""
    
    # pgvector 확장 설치
    echo "📦 pgvector 확장 설치 중..."
    docker exec $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || {
        echo "⚠️  권한 오류. postgres 사용자로 설치 시도..."
        docker exec $CONTAINER_NAME psql -U postgres -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS vector;" || {
            echo "❌ pgvector 확장 설치 실패"
            exit 1
        }
    }
    echo "✅ pgvector 확장 설치 완료"
    echo ""
    
    # .env 파일 업데이트
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
    cd "$BACKEND_DIR"
    
    VECTOR_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost:$PORT/$DB_NAME?schema=public"
    
    if [ -f .env ]; then
        # 기존 주석 처리된 PG_VECTOR_URL 제거
        sed -i '/^#.*PG_VECTOR_URL/d' .env 2>/dev/null || true
        
        # PG_VECTOR_URL 추가 또는 업데이트
        if grep -q "^PG_VECTOR_URL=" .env 2>/dev/null; then
            sed -i "s|^PG_VECTOR_URL=.*|PG_VECTOR_URL=$VECTOR_URL|" .env
            echo "✅ .env 파일의 PG_VECTOR_URL 업데이트 완료"
        else
            echo "" >> .env
            echo "# PostgreSQL + pgvector 설정" >> .env
            echo "PG_VECTOR_URL=$VECTOR_URL" >> .env
            echo "✅ .env 파일에 PG_VECTOR_URL 추가 완료"
        fi
    fi
    
    echo ""
    echo "✅ 설정 완료!"
    echo ""
    echo "📋 설정 정보:"
    echo "   컨테이너: $CONTAINER_NAME"
    echo "   데이터베이스: $DB_NAME"
    echo "   사용자: $DB_USER"
    echo "   비밀번호: $DB_PASSWORD"
    echo "   포트: $PORT"
    echo "   연결 URL: $VECTOR_URL"
    echo ""
    echo "다음 단계:"
    echo "   cd /home/young-dev/AIM/backend"
    echo "   node scripts/init-pgvector.js"
    echo ""
else
    echo "❌ 컨테이너 시작에 실패했습니다."
    echo "다음 명령어로 로그를 확인하세요:"
    echo "   docker logs $CONTAINER_NAME"
    exit 1
fi
