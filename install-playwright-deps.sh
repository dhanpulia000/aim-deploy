#!/bin/bash
# Playwright 의존성 설치 스크립트

echo "📦 Playwright 의존성 설치를 시작합니다..."
echo ""

# 시스템 업데이트
echo "1. 시스템 패키지 목록 업데이트 중..."
sudo apt-get update

# 필수 라이브러리 설치
echo ""
echo "2. 필수 라이브러리 설치 중..."
sudo apt-get install -y \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libgtk-3-0 \
  libgbm1 \
  libasound2

echo ""
echo "✅ 설치 완료!"
echo ""
echo "크롤러가 자동으로 재시작됩니다. 몇 초 후 서버 로그를 확인하세요."



