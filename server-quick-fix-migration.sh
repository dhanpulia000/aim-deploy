#!/bin/bash
# 빠른 마이그레이션 수정 (개발 환경용)

set -e

echo "=== 빠른 마이그레이션 수정 ==="
echo ""

cd backend

# 실패한 마이그레이션 레코드 확인
echo "[1/3] 실패한 마이그레이션 확인..."
sqlite3 prisma/dev.db "SELECT migration_name, started_at, finished_at FROM _prisma_migrations WHERE finished_at IS NULL;" 2>/dev/null || echo "마이그레이션 테이블 확인 중..."

# 실패한 마이그레이션 레코드 삭제
echo ""
echo "[2/3] 실패한 마이그레이션 레코드 삭제..."
sqlite3 prisma/dev.db "DELETE FROM _prisma_migrations WHERE migration_name = 'add_monitored_board' AND finished_at IS NULL;" 2>/dev/null || echo "레코드가 없거나 이미 삭제됨"

# 마이그레이션 재실행
echo ""
echo "[3/3] 마이그레이션 재실행..."
npx prisma migrate deploy

echo ""
echo "✅ 완료!"
echo ""
echo "초기 데이터 생성 중..."
npx prisma db seed

echo ""
echo "=== 완료 ==="
echo "기본 관리자 계정:"
echo "  이메일: admin@example.com"
echo "  비밀번호: admin123"

