#!/bin/bash
# 실패한 마이그레이션 해결 스크립트

set -e

echo "=== 실패한 마이그레이션 해결 ==="
echo ""

cd backend

# 옵션 1: 마이그레이션 재설정 (데이터 손실 가능, 개발 환경용)
echo "해결 방법 선택:"
echo "1. 마이그레이션 재설정 (모든 데이터 삭제, 개발 환경용)"
echo "2. 실패한 마이그레이션 수동 해결 (프로덕션 환경용)"
echo ""
read -p "선택 (1 또는 2): " choice

if [ "$choice" = "1" ]; then
    echo ""
    echo "⚠️  경고: 모든 데이터가 삭제됩니다!"
    read -p "계속하시겠습니까? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        echo "마이그레이션 재설정 중..."
        npx prisma migrate reset --force
        echo "✅ 마이그레이션 재설정 완료"
        echo ""
        echo "초기 데이터 생성 중..."
        npx prisma db seed
        echo "✅ 초기 데이터 생성 완료"
    else
        echo "취소되었습니다."
        exit 0
    fi
elif [ "$choice" = "2" ]; then
    echo ""
    echo "실패한 마이그레이션 수동 해결..."
    echo ""
    echo "1. 실패한 마이그레이션을 수동으로 완료하거나"
    echo "2. _prisma_migrations 테이블에서 실패한 마이그레이션 레코드 삭제"
    echo ""
    echo "SQLite에서 확인:"
    echo "  sqlite3 prisma/dev.db \"SELECT * FROM _prisma_migrations WHERE finished_at IS NULL;\""
    echo ""
    echo "실패한 마이그레이션 레코드 삭제:"
    echo "  sqlite3 prisma/dev.db \"DELETE FROM _prisma_migrations WHERE migration_name = 'add_monitored_board';\""
    echo ""
    echo "그 후 다시 마이그레이션 실행:"
    echo "  npx prisma migrate deploy"
else
    echo "잘못된 선택입니다."
    exit 1
fi

echo ""
echo "=== 완료 ==="

