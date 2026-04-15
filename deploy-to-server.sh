#!/bin/bash
# 서버 배포 스크립트
# 서버 터미널에서 실행하세요

set -e

echo "=== Wallboard 서버 배포 시작 ==="

# 배포 디렉토리 설정 (필요에 따라 변경)
DEPLOY_DIR="${DEPLOY_DIR:-/var/www/wallboard}"
PROJECT_NAME="AIM"

echo "배포 디렉토리: $DEPLOY_DIR"

# 디렉토리 생성
mkdir -p $DEPLOY_DIR
cd $DEPLOY_DIR

# Git 클론 또는 업데이트
if [ -d "$PROJECT_NAME" ]; then
    echo "기존 프로젝트 업데이트 중..."
    cd $PROJECT_NAME
    git pull origin main
else
    echo "새 프로젝트 클론 중..."
    git clone https://github.com/NodeplugKorea2026/AIM.git $PROJECT_NAME
    cd $PROJECT_NAME
fi

# 의존성 설치
echo "의존성 설치 중..."
npm install

echo "백엔드 의존성 설치 중..."
cd backend
npm install

# Prisma 설정
echo "Prisma 설정 중..."
npx prisma generate

# 루트로 돌아가서 프론트엔드 빌드
cd ..
echo "프론트엔드 빌드 중..."
npm run build

# 환경 변수 파일 확인
if [ ! -f "backend/.env" ]; then
    echo "⚠️  backend/.env 파일이 없습니다. 생성해주세요."
    echo "필수 환경 변수:"
    echo "  - DATABASE_URL"
    echo "  - JWT_SECRET"
    echo "  - PORT (AIMGLOBAL 기본값: 9080)"
    echo "  - OPENAI_API_KEY (선택)"
fi

echo ""
echo "=== 배포 완료 ==="
echo "다음 단계:"
echo "1. backend/.env 파일 설정"
echo "2. 서버 시작:"
echo "   cd $DEPLOY_DIR/$PROJECT_NAME/backend"
echo "   pm2 start server.js --name wallboard"
echo "   또는"
echo "   node server.js"

