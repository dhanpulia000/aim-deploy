#!/bin/bash
# Docker 권한 문제 해결 스크립트

echo "🔧 Docker 권한 문제 해결"
echo ""

# 현재 사용자 확인
CURRENT_USER=$(whoami)
echo "현재 사용자: $CURRENT_USER"
echo ""

# docker 그룹 확인
if getent group docker > /dev/null 2>&1; then
    echo "✅ docker 그룹이 존재합니다."
    echo "docker 그룹 멤버:"
    getent group docker
    echo ""
else
    echo "❌ docker 그룹이 없습니다."
    echo "다음 명령어로 생성하세요:"
    echo "   sudo groupadd docker"
    exit 1
fi

# 현재 사용자가 docker 그룹에 있는지 확인
if groups | grep -q "\bdocker\b"; then
    echo "✅ 현재 사용자가 docker 그룹에 있습니다."
    echo ""
    echo "⚠️  하지만 현재 쉘 세션에서 권한이 활성화되지 않았습니다."
    echo ""
    echo "해결 방법:"
    echo ""
    echo "방법 1: newgrp 명령어 사용 (권장)"
    echo "   newgrp docker"
    echo "   docker ps"
    echo ""
    echo "방법 2: 로그아웃 후 다시 로그인"
    echo ""
    echo "방법 3: 새 터미널 창 열기"
    echo ""
else
    echo "❌ 현재 사용자가 docker 그룹에 없습니다."
    echo ""
    echo "다음 명령어로 추가하세요:"
    echo "   sudo usermod -aG docker $CURRENT_USER"
    echo "   newgrp docker"
    echo ""
fi

# docker.sock 권한 확인
if [ -e /var/run/docker.sock ]; then
    echo "📋 docker.sock 권한 정보:"
    ls -la /var/run/docker.sock
    echo ""
    
    SOCK_GROUP=$(stat -c '%G' /var/run/docker.sock 2>/dev/null || echo "unknown")
    echo "docker.sock 그룹: $SOCK_GROUP"
    
    if [ "$SOCK_GROUP" = "docker" ]; then
        echo "✅ docker.sock이 docker 그룹에 속해 있습니다."
    else
        echo "⚠️  docker.sock이 docker 그룹에 속해 있지 않습니다."
        echo "   (일반적으로 문제가 되지 않지만, 필요시 수정 가능)"
    fi
else
    echo "⚠️  /var/run/docker.sock 파일이 없습니다."
    echo "   Docker 서비스가 실행 중인지 확인하세요."
fi

echo ""
echo "💡 빠른 해결:"
echo "   newgrp docker"
echo "   docker ps"
