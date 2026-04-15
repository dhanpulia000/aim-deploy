#!/bin/bash

# 한글 폰트 설치 스크립트 (Playwright 스크린샷용)

echo "한글 폰트 설치를 시작합니다..."

# 시스템 업데이트
sudo apt-get update

# 폰트 관련 패키지 설치
sudo apt-get install -y \
    fonts-nanum \
    fonts-nanum-coding \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fontconfig

# 폰트 캐시 갱신
fc-cache -fv

echo "✅ 한글 폰트 설치 완료!"
echo ""
echo "설치된 폰트 확인:"
fc-list | grep -i "nanum\|noto" | head -5



