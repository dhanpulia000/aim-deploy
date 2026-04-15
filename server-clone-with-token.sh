#!/bin/bash
# 서버에서 Personal Access Token을 사용하여 클론하는 스크립트

echo "=== 서버 클론 스크립트 ==="
echo ""

# Personal Access Token 입력
read -sp "Personal Access Token 입력 (ghp_로 시작): " TOKEN
echo ""

# 배포 디렉토리 설정
DEPLOY_DIR="${DEPLOY_DIR:-/var/www/wallboard}"
PROJECT_NAME="AIM"

echo "배포 디렉토리: $DEPLOY_DIR"
mkdir -p $DEPLOY_DIR
cd $DEPLOY_DIR

# 토큰을 포함한 URL로 클론
echo "저장소 클론 중..."
git clone "https://${TOKEN}@github.com/NodeplugKorea2026/AIM.git" $PROJECT_NAME

if [ $? -eq 0 ]; then
    echo "✅ 클론 성공!"
    cd $PROJECT_NAME
    echo ""
    echo "다음 단계:"
    echo "1. 의존성 설치: npm install && cd backend && npm install && cd .."
    echo "2. 프론트엔드 빌드: npm run build"
    echo "3. 환경 변수 설정: cd backend && nano .env"
    echo "4. 서버 시작: node server.js"
else
    echo "❌ 클론 실패. 토큰과 저장소 접근 권한을 확인하세요."
    exit 1
fi

