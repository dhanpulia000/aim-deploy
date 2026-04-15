#!/bin/bash
# 서버에서 Git 자격 증명 설정 스크립트

echo "=== Git 자격 증명 설정 ==="
echo ""

# Personal Access Token 입력
read -sp "Personal Access Token 입력 (ghp_로 시작): " TOKEN
echo ""

# GitHub 사용자명 입력
read -p "GitHub 사용자명 (young-ice26): " USERNAME
USERNAME=${USERNAME:-young-ice26}

# Git credential helper 설정
git config --global credential.helper store

# 자격 증명 파일에 저장
echo "https://${USERNAME}:${TOKEN}@github.com" > ~/.git-credentials
chmod 600 ~/.git-credentials

echo "✅ Git 자격 증명이 설정되었습니다!"
echo ""
echo "이제 일반적인 git clone 명령어를 사용할 수 있습니다:"
echo "  git clone https://github.com/NodeplugKorea2026/AIM.git"

