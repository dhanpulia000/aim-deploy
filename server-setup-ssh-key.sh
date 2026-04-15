#!/bin/bash
# 서버에서 SSH 키 설정 스크립트

echo "=== SSH 키 설정 ==="
echo ""

# SSH 키가 있는지 확인
if [ -f ~/.ssh/id_ed25519.pub ]; then
    echo "기존 SSH 키 발견:"
    cat ~/.ssh/id_ed25519.pub
    echo ""
    read -p "이 키를 사용하시겠습니까? (Y/n): " USE_EXISTING
    if [ "$USE_EXISTING" != "n" ] && [ "$USE_EXISTING" != "N" ]; then
        echo "기존 키를 사용합니다."
        exit 0
    fi
fi

# 새 SSH 키 생성
echo "새 SSH 키 생성 중..."
ssh-keygen -t ed25519 -C "young.ko@iceberg101.com" -f ~/.ssh/id_ed25519 -N ""

# 공개 키 표시
echo ""
echo "=== 공개 키 (아래 내용을 복사하세요) ==="
cat ~/.ssh/id_ed25519.pub
echo ""
echo "========================================="
echo ""
echo "다음 단계:"
echo "1. 위의 공개 키를 복사하세요"
echo "2. GitHub → Settings → SSH and GPG keys → New SSH key"
echo "3. 키를 붙여넣고 저장"
echo "4. 원격 URL을 SSH로 변경:"
echo "   git remote set-url origin git@github.com:NodeplugKorea2026/AIM.git"
echo "5. 클론: git clone git@github.com:NodeplugKorea2026/AIM.git"

