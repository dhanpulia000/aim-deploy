#!/bin/bash
# 서버 전체 설정 스크립트

set -e

echo "=== 서버 전체 설정 시작 ==="
echo ""

# 현재 위치 확인
CURRENT_DIR=$(pwd)
echo "현재 위치: $CURRENT_DIR"
echo ""

# 1. npm 설치 확인
echo "[1/6] npm 설치 확인..."
if ! command -v npm &> /dev/null; then
    echo "npm이 설치되어 있지 않습니다."
    echo "npm 설치를 진행합니다..."
    echo ""
    
    # 운영체제 확인
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
    else
        echo "운영체제를 확인할 수 없습니다. 수동으로 npm을 설치해주세요."
        exit 1
    fi
    
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        sudo apt update
        sudo apt install -y npm
    elif [ "$OS" = "centos" ] || [ "$OS" = "rhel" ] || [ "$OS" = "amzn" ]; then
        sudo yum install -y npm
    else
        echo "지원하지 않는 운영체제입니다."
        exit 1
    fi
    echo "✅ npm 설치 완료"
else
    echo "✅ npm이 이미 설치되어 있습니다: $(npm --version)"
fi
echo ""

# 2. 프로젝트 클론 (이미 클론되어 있으면 스킵)
echo "[2/6] 프로젝트 확인..."
if [ ! -d "AIM" ]; then
    echo "프로젝트 클론 중..."
    if [ -n "$GITHUB_TOKEN" ]; then
        git clone https://${GITHUB_TOKEN}@github.com/NodeplugKorea2026/AIM.git
    else
        git clone https://github.com/NodeplugKorea2026/AIM.git
    fi
    echo "✅ 클론 완료"
else
    echo "✅ 프로젝트가 이미 존재합니다"
fi
cd AIM
echo ""

# 3. 루트 의존성 설치
echo "[3/6] 루트 의존성 설치 중..."
npm install
echo "✅ 루트 의존성 설치 완료"
echo ""

# 4. 백엔드 의존성 설치
echo "[4/6] 백엔드 의존성 설치 중..."
cd backend
npm install
cd ..
echo "✅ 백엔드 의존성 설치 완료"
echo ""

# 5. 프론트엔드 빌드
echo "[5/6] 프론트엔드 빌드 중..."
npm run build
echo "✅ 프론트엔드 빌드 완료"
echo ""

# 6. 환경 변수 파일 확인
echo "[6/6] 환경 변수 파일 확인..."
cd backend
if [ ! -f ".env" ]; then
    echo "⚠️  .env 파일이 없습니다."
    echo ""
    echo "다음 명령어로 .env 파일을 생성하세요:"
    echo "  nano .env"
    echo ""
    echo "필수 환경 변수:"
    echo "  DATABASE_URL=\"file:./prisma/dev.db\""
    echo "  PORT=8080"
    echo "  JWT_SECRET=your-secret-key-here"
    echo "  OPENAI_API_KEY=your-openai-key (선택)"
    echo ""
else
    echo "✅ .env 파일이 존재합니다"
fi
cd ..

echo ""
echo "=== 설정 완료 ==="
echo ""
echo "다음 단계:"
echo "1. backend/.env 파일 확인/수정"
echo "2. 서버 시작:"
echo "   cd backend"
echo "   node server.js"
echo ""
echo "또는 PM2 사용:"
echo "   cd backend"
echo "   pm2 start server.js --name wallboard"
echo "   pm2 save"

