#!/bin/bash
# sudo 없이 전체 설정 (NVM 사용)

set -e

echo "=== sudo 없이 서버 설정 ==="
echo ""

# 1. NVM 설치 확인
echo "[1/6] NVM 확인..."
if ! command -v nvm &> /dev/null; then
    echo "NVM이 설치되어 있지 않습니다. 설치 중..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
    
    # NVM 로드
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    
    # .bashrc에 추가
    if ! grep -q "NVM_DIR" ~/.bashrc; then
        echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc
        echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc
    fi
    echo "✅ NVM 설치 완료"
else
    echo "✅ NVM이 이미 설치되어 있습니다"
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

# 2. Node.js/npm 설치 확인
echo "[2/6] Node.js/npm 확인..."
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "Node.js/npm 설치 중..."
    nvm install --lts
    nvm use --lts
    nvm alias default node
    echo "✅ Node.js/npm 설치 완료"
else
    echo "✅ Node.js/npm이 이미 설치되어 있습니다"
    echo "Node.js 버전: $(node --version)"
    echo "npm 버전: $(npm --version)"
fi
echo ""

# 3. 프로젝트 클론
echo "[3/6] 프로젝트 확인..."
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

# 4. 의존성 설치
echo "[4/6] 의존성 설치 중..."
npm install
cd backend && npm install && cd ..
echo "✅ 의존성 설치 완료"
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
    echo "최소 필수 환경 변수:"
    echo "  DATABASE_URL=\"file:./prisma/dev.db\""
    echo "  PORT=8080"
    echo "  JWT_SECRET=your-secret-key-here"
else
    echo "✅ .env 파일이 존재합니다"
fi
cd ..

echo ""
echo "=== 설정 완료 ==="
echo ""
echo "다음 단계:"
echo "1. backend/.env 파일 확인/수정"
echo "2. Prisma 설정:"
echo "   cd backend"
echo "   npx prisma generate"
echo "3. 서버 시작:"
echo "   node server.js"

