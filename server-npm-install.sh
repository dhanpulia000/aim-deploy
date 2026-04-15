#!/bin/bash
# 서버에서 npm 설치 스크립트

echo "=== npm 설치 ==="
echo ""

# Node.js 버전 확인
if command -v node &> /dev/null; then
    echo "Node.js 버전: $(node --version)"
else
    echo "❌ Node.js가 설치되어 있지 않습니다."
    echo "Node.js를 먼저 설치해야 합니다."
    exit 1
fi

# npm 버전 확인
if command -v npm &> /dev/null; then
    echo "npm 버전: $(npm --version)"
    echo "✅ npm이 이미 설치되어 있습니다."
    exit 0
fi

# 운영체제 확인
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "운영체제를 확인할 수 없습니다."
    exit 1
fi

echo "운영체제: $OS"
echo ""

# Ubuntu/Debian
if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
    echo "Ubuntu/Debian에서 npm 설치 중..."
    sudo apt update
    sudo apt install -y npm
    echo "✅ npm 설치 완료"

# CentOS/RHEL
elif [ "$OS" = "centos" ] || [ "$OS" = "rhel" ]; then
    echo "CentOS/RHEL에서 npm 설치 중..."
    sudo yum install -y npm
    echo "✅ npm 설치 완료"

# Amazon Linux
elif [ "$OS" = "amzn" ]; then
    echo "Amazon Linux에서 npm 설치 중..."
    sudo yum install -y npm
    echo "✅ npm 설치 완료"

else
    echo "지원하지 않는 운영체제입니다."
    echo "수동으로 npm을 설치해주세요."
    exit 1
fi

# 설치 확인
if command -v npm &> /dev/null; then
    echo ""
    echo "✅ npm 설치 완료!"
    echo "npm 버전: $(npm --version)"
else
    echo "❌ npm 설치 실패"
    exit 1
fi

