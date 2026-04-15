#!/bin/bash
# Snap Docker 올바른 설정 스크립트
# 터미널에서 직접 실행해야 합니다 (sudo 비밀번호 필요)

set -e

echo "🐳 Snap Docker 설정 스크립트"
echo ""

# Docker 확인
if ! command -v docker &> /dev/null; then
    echo "❌ Docker가 설치되어 있지 않습니다."
    echo "다음 명령어로 Docker를 설치하세요:"
    echo "   sudo snap install docker"
    exit 1
fi

echo "✅ Docker가 설치되어 있습니다."
docker --version
echo ""

# docker 그룹 확인
if ! getent group docker > /dev/null 2>&1; then
    echo "📦 docker 그룹 생성 중..."
    sudo groupadd docker
    echo "✅ docker 그룹 생성 완료"
else
    echo "✅ docker 그룹이 이미 존재합니다."
fi

# 현재 사용자가 docker 그룹에 있는지 확인
if groups | grep -q "\bdocker\b"; then
    echo "✅ 현재 사용자가 이미 docker 그룹에 있습니다."
else
    echo "📦 현재 사용자를 docker 그룹에 추가 중..."
    sudo usermod -aG docker $USER
    echo "✅ 사용자 추가 완료"
    echo ""
    echo "⚠️  새 그룹 권한을 활성화하려면 다음 중 하나를 실행하세요:"
    echo "   1. newgrp docker"
    echo "   2. 로그아웃 후 다시 로그인"
    echo ""
fi

# Docker 접근 테스트
echo "🔍 Docker 접근 테스트 중..."
if docker ps > /dev/null 2>&1; then
    echo "✅ Docker에 정상적으로 접근할 수 있습니다!"
    docker ps
    exit 0
else
    echo "⚠️  Docker에 접근할 수 없습니다."
    echo ""
    echo "다음 명령어를 실행하세요:"
    echo "   newgrp docker"
    echo ""
    echo "그런 다음 다시 테스트하세요:"
    echo "   docker ps"
    exit 1
fi
