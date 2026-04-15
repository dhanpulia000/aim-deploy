#!/bin/bash
# Snap Docker 설정 스크립트
# Snap으로 설치된 Docker를 올바르게 사용하기 위한 설정

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

# Docker 서비스 시작 (필요한 경우)
if ! docker ps &> /dev/null; then
    echo "⚠️  Docker 서비스에 접근할 수 없습니다."
    echo ""
    echo "다음 단계를 실행하세요:"
    echo ""
    echo "1️⃣  docker 그룹 생성 및 사용자 추가:"
    echo "   sudo groupadd docker"
    echo "   sudo usermod -aG docker $USER"
    echo ""
    echo "2️⃣  Snap Docker는 이미 올바르게 설정되어 있습니다."
    echo "   (docker-executables는 자동으로 연결되어 있습니다)"
    echo ""
    echo "3️⃣  새 그룹 활성화 (로그아웃/로그인 또는):"
    echo "   newgrp docker"
    echo ""
    echo "4️⃣  Docker 접근 테스트:"
    echo "   docker ps"
    echo ""
    exit 1
fi

echo "✅ Docker에 정상적으로 접근할 수 있습니다."
docker ps
echo ""

echo "✅ 설정 완료!"
echo ""
