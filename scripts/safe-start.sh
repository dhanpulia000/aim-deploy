#!/bin/bash

# Backend 서버 안전 시작 스크립트
# 기존 프로세스를 종료하고 단일 서버 인스턴스만 새로 시작합니다.
# 프로세스 중복 방지: flock으로 동시 실행 차단, server.js 1개 + 자식 워커만 유지

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
LOCK_FILE="${LOCK_FILE:-/tmp/aim-safe-start.lock}"
PID_FILE="${PID_FILE:-/tmp/aim-server.pid}"
PORT="${PORT:-9080}"

# 동시 실행 방지: 다른 safe-start가 실행 중이면 대기 없이 종료
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "⚠️  다른 safe-start가 이미 실행 중입니다. 잠시 후 재시도하세요."
    exit 1
fi

echo "=========================================="
echo "Backend 서버 안전 시작 스크립트"
echo "=========================================="

# 1. server.js(부모)를 먼저 종료 → 자식 워커들이 함께 정리되도록
echo ""
echo "[0/4] server.js 메인 프로세스 확인 중..."
SERVER_PIDS=$(pgrep -f "node.*server\.js" 2>/dev/null || true)
if [ -n "$SERVER_PIDS" ]; then
    echo "   발견된 server.js PID: $SERVER_PIDS"
    for PID in $SERVER_PIDS; do
        kill -TERM "$PID" 2>/dev/null || true
        sleep 1
        if kill -0 "$PID" 2>/dev/null; then
            kill -KILL "$PID" 2>/dev/null || true
        fi
    done
    echo "   server.js 종료 완료"
else
    echo "   실행 중인 server.js 없음"
fi
sleep 1

# 2. 백엔드 포트(기본 9080)를 점유 중인 프로세스 찾아서 종료
echo ""
echo "[1/4] ${PORT} 포트를 점유 중인 프로세스 확인 중..."

if command -v lsof &> /dev/null; then
    PORT_PIDS=$(lsof -ti:${PORT} 2>/dev/null || true)
    if [ -n "$PORT_PIDS" ]; then
        echo "   발견된 프로세스 PID: $PORT_PIDS"
        for PID in $PORT_PIDS; do
            echo "   PID $PID 종료 중..."
            kill -TERM "$PID" 2>/dev/null || true
            sleep 1
            # TERM 신호로 종료되지 않으면 KILL 신호 전송
            if kill -0 "$PID" 2>/dev/null; then
                echo "   PID $PID 강제 종료 중..."
                kill -KILL "$PID" 2>/dev/null || true
            fi
        done
        echo "   ${PORT} 포트 프로세스 종료 완료"
    else
        echo "   ${PORT} 포트를 사용하는 프로세스 없음"
    fi
else
    # lsof가 없으면 fuser 사용 시도
    if command -v fuser &> /dev/null; then
        fuser -k ${PORT}/tcp 2>/dev/null || true
        echo "   fuser로 ${PORT} 포트 프로세스 종료 시도 완료"
    else
        # pgrep으로 node 프로세스 중 백엔드 포트를 사용하는 것 찾기 (대략적)
        echo "   lsof/fuser가 없어 pgrep으로 대체 확인 중..."
        NODE_PIDS=$(pgrep -f "node.*server.js" || true)
        if [ -n "$NODE_PIDS" ]; then
            for PID in $NODE_PIDS; do
                echo "   Node 프로세스 PID $PID 종료 중..."
                kill -TERM "$PID" 2>/dev/null || true
                sleep 1
                if kill -0 "$PID" 2>/dev/null; then
                    kill -KILL "$PID" 2>/dev/null || true
                fi
            done
        fi
    fi
fi

# 2. Worker 프로세스들 찾아서 종료
echo ""
echo "[2/4] Worker 프로세스 확인 중..."

# Worker 파일 목록 (taskNotification 누락 시 라인 알림 중복 전송 발생)
WORKER_PATTERNS=(
    "naverCafe.worker.js"
    "naverCafeClan.worker.js"
    "naverCafeBackfill.worker.js"
    "rawLogProcessor.worker.js"
    "slackNotice.worker.js"
    "discord.worker.js"
    "sla.worker.js"
    "taskNotification.worker.js"
)

WORKER_PIDS_FOUND=false

for WORKER_PATTERN in "${WORKER_PATTERNS[@]}"; do
    # pgrep으로 worker 프로세스 찾기
    PIDS=$(pgrep -f "$WORKER_PATTERN" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        WORKER_PIDS_FOUND=true
        echo "   $WORKER_PATTERN 프로세스 발견: $PIDS"
        for PID in $PIDS; do
            echo "   PID $PID 종료 중..."
            kill -TERM "$PID" 2>/dev/null || true
            sleep 1
            if kill -0 "$PID" 2>/dev/null; then
                echo "   PID $PID 강제 종료 중..."
                kill -KILL "$PID" 2>/dev/null || true
            fi
        done
    fi
done

if [ "$WORKER_PIDS_FOUND" = false ]; then
    echo "   실행 중인 Worker 프로세스 없음"
fi

# 3. 프로세스 종료 대기 (최대 5초)
echo ""
echo "   프로세스 종료 대기 중..."
for i in {1..5}; do
    REMAINING_PIDS=$(lsof -ti:${PORT} 2>/dev/null || true)
    if [ -z "$REMAINING_PIDS" ]; then
        # 추가로 worker 프로세스 확인
        WORKER_REMAINING=false
        for WORKER_PATTERN in "${WORKER_PATTERNS[@]}"; do
            if pgrep -f "$WORKER_PATTERN" &> /dev/null; then
                WORKER_REMAINING=true
                break
            fi
        done
        if [ "$WORKER_REMAINING" = false ]; then
            echo "   모든 프로세스 종료 확인됨"
            break
        fi
    fi
    sleep 1
done

# 4. 최종 확인 및 강제 종료
echo ""
echo "   최종 확인 중..."
REMAINING_PORT_PIDS=$(lsof -ti:${PORT} 2>/dev/null || true)
if [ -n "$REMAINING_PORT_PIDS" ]; then
    echo "   경고: 일부 프로세스가 아직 실행 중입니다. 강제 종료 시도..."
    for PID in $REMAINING_PORT_PIDS; do
        kill -KILL "$PID" 2>/dev/null || true
    done
    sleep 1
fi

# Worker 프로세스 강제 종료
for WORKER_PATTERN in "${WORKER_PATTERNS[@]}"; do
    PIDS=$(pgrep -f "$WORKER_PATTERN" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        for PID in $PIDS; do
            kill -KILL "$PID" 2>/dev/null || true
        done
    fi
done

# 5. 서버 시작 (단일 인스턴스만)
echo ""
echo "[3/4] Backend 서버 시작 중 (단일 프로세스만 유지)..."
echo "   디렉토리: $BACKEND_DIR"
echo "   명령어: node server.js"
echo "   백그라운드 실행: yes"
echo ""

cd "$BACKEND_DIR"

# 서버를 백그라운드로 시작
nohup node server.js > /tmp/aim-server.log 2>&1 &
SERVER_PID=$!

# 서버 시작 확인 및 PID 파일 기록
sleep 2
if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "$SERVER_PID" > "$PID_FILE"
    echo "   ✅ 서버가 백그라운드에서 시작되었습니다 (PID: $SERVER_PID)"
    echo "   로그: /tmp/aim-server.log"
    echo "   PID 파일: $PID_FILE"
    echo ""
    echo "[4/4] 완료. 워커는 server.js 자식 프로세스로만 실행됩니다."
    echo ""
    echo "상태 확인: ps aux | grep server.js"
    echo "로그: tail -f /tmp/aim-server.log"
else
    echo "   ❌ 서버 시작 실패"
    echo "   로그 확인: cat /tmp/aim-server.log"
    rm -f "$PID_FILE"
    exit 1
fi








