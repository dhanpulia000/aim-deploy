#!/bin/bash
# NVM을 사용하여 Node.js와 npm 설치 (sudo 불필요)

echo "=== NVM을 사용한 Node.js/npm 설치 ==="
echo ""

# NVM 설치
echo "[1/3] NVM 설치 중..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# NVM 로드
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "✅ NVM 설치 완료"
echo ""

# Node.js LTS 버전 설치
echo "[2/3] Node.js LTS 버전 설치 중..."
nvm install --lts
nvm use --lts
nvm alias default node

echo "✅ Node.js 설치 완료"
echo "Node.js 버전: $(node --version)"
echo "npm 버전: $(npm --version)"
echo ""

# 설치 확인
echo "[3/3] 설치 확인..."
if command -v node &> /dev/null && command -v npm &> /dev/null; then
    echo "✅ 설치 성공!"
    echo ""
    echo "다음 명령어를 ~/.bashrc 또는 ~/.zshrc에 추가하세요:"
    echo "  export NVM_DIR=\"\$HOME/.nvm\""
    echo "  [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\""
    echo ""
    echo "또는 다음 명령어로 자동 추가:"
    echo "  echo 'export NVM_DIR=\"\$HOME/.nvm\"' >> ~/.bashrc"
    echo "  echo '[ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"' >> ~/.bashrc"
    echo "  source ~/.bashrc"
else
    echo "❌ 설치 실패"
    exit 1
fi

