#!/bin/bash
# Docker 설치 스크립트
# 이 스크립트는 sudo 권한이 필요합니다.

set -e

echo "🐳 Docker 설치 스크립트"
echo ""

# Docker 설치 확인
if command -v docker &> /dev/null; then
    echo "✅ Docker가 이미 설치되어 있습니다."
    docker --version
    exit 0
fi

echo "📦 Docker 설치 중..."
echo ""

# Snap 사용 시도
if command -v snap &> /dev/null; then
    echo "Snap을 사용하여 Docker 설치 중..."
    sudo snap install docker
    
    echo ""
    echo "✅ Docker 설치 완료!"
    echo ""
    echo "⚠️  현재 사용자를 docker 그룹에 추가하려면 다음 명령어를 실행하세요:"
    echo "   sudo usermod -aG docker $USER"
    echo "   newgrp docker"
    echo ""
    echo "또는 로그아웃 후 다시 로그인하세요."
    exit 0
fi

# apt 사용 시도
if command -v apt &> /dev/null; then
    echo "apt를 사용하여 Docker 설치 중..."
    sudo apt update
    sudo apt install -y docker.io
    sudo systemctl start docker
    sudo systemctl enable docker
    
    echo ""
    echo "✅ Docker 설치 완료!"
    echo ""
    echo "⚠️  현재 사용자를 docker 그룹에 추가하려면 다음 명령어를 실행하세요:"
    echo "   sudo usermod -aG docker $USER"
    echo "   newgrp docker"
    echo ""
    echo "또는 로그아웃 후 다시 로그인하세요."
    exit 0
fi

echo "❌ Docker를 설치할 수 없습니다. 수동으로 설치하세요."
exit 1
