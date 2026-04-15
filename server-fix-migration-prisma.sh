#!/bin/bash
# Prisma를 사용하여 마이그레이션 문제 해결 (sqlite3 불필요)

set -e

echo "=== Prisma로 마이그레이션 문제 해결 ==="
echo ""

cd backend

# 옵션 1: 마이그레이션 재설정 (가장 간단, 데이터 삭제됨)
echo "해결 방법 선택:"
echo "1. 마이그레이션 재설정 (모든 데이터 삭제, 권장)"
echo "2. 마이그레이션 상태 확인 후 수동 해결"
echo ""
read -p "선택 (1 또는 2): " choice

if [ "$choice" = "1" ]; then
    echo ""
    echo "⚠️  경고: 모든 데이터가 삭제됩니다!"
    read -p "계속하시겠습니까? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        echo ""
        echo "[1/2] 마이그레이션 재설정 중..."
        npx prisma migrate reset --force --skip-seed
        
        echo ""
        echo "[2/2] 초기 데이터 생성 중..."
        npx prisma db seed
        
        echo ""
        echo "✅ 완료!"
        echo ""
        echo "기본 관리자 계정:"
        echo "  이메일: admin@example.com"
        echo "  비밀번호: admin123"
    else
        echo "취소되었습니다."
        exit 0
    fi
elif [ "$choice" = "2" ]; then
    echo ""
    echo "마이그레이션 상태 확인..."
    npx prisma migrate status
    
    echo ""
    echo "마이그레이션을 수동으로 해결하려면:"
    echo "1. Prisma Studio로 데이터베이스 확인:"
    echo "   npx prisma studio"
    echo ""
    echo "2. 또는 마이그레이션 재설정:"
    echo "   npx prisma migrate reset --force"
else
    echo "잘못된 선택입니다."
    exit 1
fi

