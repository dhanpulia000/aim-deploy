#!/bin/bash
# 서버 데이터베이스 초기화 및 사용자 계정 생성 스크립트

set -e

echo "=== 데이터베이스 초기화 및 사용자 계정 생성 ==="
echo ""

# 프로젝트 디렉토리 확인
if [ ! -d "backend" ]; then
    echo "❌ backend 디렉토리를 찾을 수 없습니다."
    echo "프로젝트 루트 디렉토리에서 실행하세요."
    exit 1
fi

cd backend

# 1. Prisma Client 생성
echo "[1/4] Prisma Client 생성 중..."
npx prisma generate
echo "✅ Prisma Client 생성 완료"
echo ""

# 2. 데이터베이스 마이그레이션
echo "[2/4] 데이터베이스 마이그레이션 실행 중..."
npx prisma migrate deploy
echo "✅ 마이그레이션 완료"
echo ""

# 3. Seed 스크립트 실행 (초기 관리자 계정 생성)
echo "[3/4] 초기 데이터 생성 중..."
echo ""

# 환경 변수 확인
if [ -f ".env" ]; then
    echo "환경 변수 파일 확인됨"
    # .env 파일에서 SEED_ADMIN_EMAIL과 SEED_ADMIN_PASSWORD 확인
    if grep -q "SEED_ADMIN_EMAIL" .env; then
        echo "사용자 정의 관리자 이메일 사용"
    else
        echo "기본 관리자 계정 생성 (admin@example.com / admin123)"
    fi
else
    echo "⚠️  .env 파일이 없습니다. 기본값으로 진행합니다."
    echo "기본 관리자 계정: admin@example.com / admin123"
fi

# Seed 실행
npx prisma db seed
echo "✅ 초기 데이터 생성 완료"
echo ""

# 4. 생성된 사용자 확인
echo "[4/4] 생성된 사용자 확인..."
echo ""
echo "다음 명령어로 사용자를 확인할 수 있습니다:"
echo "  npx prisma studio"
echo ""
echo "또는 데이터베이스 직접 확인:"
echo "  sqlite3 prisma/dev.db \"SELECT email, role FROM User;\""
echo ""

echo "=== 완료 ==="
echo ""
echo "기본 관리자 계정:"
echo "  이메일: admin@example.com"
echo "  비밀번호: admin123"
echo ""
echo "환경 변수로 변경하려면 .env 파일에 추가:"
echo "  SEED_ADMIN_EMAIL=your-email@example.com"
echo "  SEED_ADMIN_PASSWORD=your-password"
echo ""
echo "⚠️  보안을 위해 첫 로그인 후 비밀번호를 변경하세요!"

