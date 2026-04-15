#!/bin/bash

# 서버에서 "현 방식" 그대로 배포 적용:
# - 프론트: vite build로 dist 생성
# - 백엔드: pm2 restart aimforglobal-backend --update-env
#
# 주의: 이 스크립트는 "배포 파이프라인 대체"가 아니라, 사람 실수를 줄이기 위한 단일 명령 래퍼입니다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=========================================="
echo "서버 적용 (프론트 빌드 + 백엔드 재시작)"
echo "=========================================="

cd "$PROJECT_ROOT"

echo ""
echo "[1/3] 프론트 배포 빌드 생성 (dist/)"
npm run build

echo ""
echo "[2/3] 백엔드 재시작 (pm2, --update-env)"
pm2 restart aimforglobal-backend --update-env

echo ""
echo "[3/3] 상태 확인"
pm2 status aimforglobal-backend || true

echo ""
echo "✅ 완료"

