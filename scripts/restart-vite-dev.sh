#!/bin/bash

# Vite dev server를 1개만 유지하며 재시작합니다.
# - 중복 실행 방지: flock
# - 기존 Vite 포트(기본 5175) 점유/기존 vite 프로세스 정리

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LOCK_FILE="${LOCK_FILE:-/tmp/aim-vite-dev.lock}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-5175}"

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "⚠️  다른 Vite 재시작이 이미 실행 중입니다. 잠시 후 재시도하세요."
  exit 1
fi

echo "=========================================="
echo "Vite dev 재시작 (단일 인스턴스)"
echo "=========================================="

kill_pids() {
  local pids="$1"
  if [ -z "${pids:-}" ]; then
    return 0
  fi
  for pid in $pids; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 1
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}

echo ""
echo "[0/2] 기존 Vite(dev) 프로세스 종료 중..."

# 1) 포트 점유 프로세스 우선 정리
if command -v lsof >/dev/null 2>&1; then
  PORT_PIDS="$(lsof -ti:${PORT} 2>/dev/null || true)"
  kill_pids "$PORT_PIDS"
elif command -v fuser >/dev/null 2>&1; then
  fuser -k ${PORT}/tcp 2>/dev/null || true
fi

# 2) vite 관련 프로세스 정리 (포트와 무관하게 떠있을 수 있음)
VITE_PIDS="$(pgrep -f \"node.*vite\" 2>/dev/null || true)"
kill_pids "$VITE_PIDS"

echo "   ✅ 정리 완료"

echo ""
echo "[1/2] Vite dev 시작 중... (host=${HOST}, port=${PORT})"
cd "$PROJECT_ROOT"

# 터미널 세션에서 바로 로그를 볼 수 있게 foreground로 실행
exec npm run dev -- --host "$HOST" --port "$PORT"

