#!/bin/bash
# GitHub 빠른 업로드 스크립트

cd /home/young-dev/AIM

echo "=== GitHub 업로드 시작 ==="

# 1. .gitignore 확인 및 업데이트
echo "1. .gitignore 확인 중..."
if ! grep -q "*.db-shm" .gitignore; then
    echo "   .db-shm, .db-wal 추가 중..."
    echo "" >> .gitignore
    echo "# SQLite temporary files" >> .gitignore
    echo "*.db-shm" >> .gitignore
    echo "*.db-wal" >> .gitignore
    echo "backend/prisma/*.db-shm" >> .gitignore
    echo "backend/prisma/*.db-wal" >> .gitignore
fi

# 2. 현재 상태 확인
echo "2. Git 상태 확인 중..."
git status --short | head -20

# 3. 데이터베이스 파일이 스테이징되지 않았는지 확인
echo "3. 민감한 파일 확인 중..."
if git diff --cached --name-only | grep -E "\.(db|env)$"; then
    echo "   ⚠️  경고: 데이터베이스 파일이나 .env 파일이 스테이징되어 있습니다!"
    echo "   계속하시겠습니까? (y/N)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "   취소되었습니다."
        exit 1
    fi
fi

# 4. 변경사항 추가 (데이터베이스 파일 제외)
echo "4. 변경사항 추가 중..."
git add backend/controllers/ backend/services/ backend/workers/ backend/routes/ \
    backend/server.js backend/app.js \
    src/ \
    *.md *.json *.ts *.js .gitignore \
    package.json vite.config.ts tsconfig.json

# 5. 커밋 메시지 입력
echo "5. 커밋 메시지를 입력하세요 (기본값: 최신 기능 업데이트):"
read -r commit_msg
if [ -z "$commit_msg" ]; then
    commit_msg="최신 기능 업데이트: $(date +%Y-%m-%d)"
fi

# 6. 커밋
echo "6. 커밋 중..."
git commit -m "$commit_msg"

# 7. 푸시
echo "7. GitHub에 푸시 중..."
git push origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 업로드 완료!"
    echo "   GitHub 저장소: https://github.com/NodeplugKorea2026/AIM"
else
    echo ""
    echo "❌ 업로드 실패. 오류를 확인하세요."
    exit 1
fi











