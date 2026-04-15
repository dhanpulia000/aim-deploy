#!/bin/bash
# 사용자 홈 디렉토리에서 클론하는 스크립트 (sudo 불필요)

echo "=== 홈 디렉토리에서 클론 ==="
echo ""

# 홈 디렉토리로 이동
cd ~

# 프로젝트 디렉토리 생성
PROJECT_DIR="$HOME/wallboard"
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

# Personal Access Token이 필요하면 환경변수 GITHUB_TOKEN을 사용하세요.
echo "저장소 클론 중..."
if [ -n "$GITHUB_TOKEN" ]; then
    git clone https://${GITHUB_TOKEN}@github.com/NodeplugKorea2026/AIM.git
else
    git clone https://github.com/NodeplugKorea2026/AIM.git
fi

if [ $? -eq 0 ]; then
    echo "✅ 클론 성공!"
    cd AIM
    echo ""
    echo "프로젝트 위치: $PROJECT_DIR/AIM"
    echo ""
    echo "다음 단계:"
    echo "1. 의존성 설치: npm install && cd backend && npm install && cd .."
    echo "2. 프론트엔드 빌드: npm run build"
    echo "3. 환경 변수 설정: cd backend && nano .env"
    echo "4. 서버 시작: node server.js"
else
    echo "❌ 클론 실패"
    exit 1
fi

