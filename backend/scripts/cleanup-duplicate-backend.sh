#!/usr/bin/env bash
# 중복 nodemon / node server.js 프로세스 정리 (8080 사용 중인 백엔드만 유지)
# 사용: ./scripts/cleanup-duplicate-backend.sh
# 백엔드 재시작 시 npm run restart 에서 자동 호출됨.

BACKEND_PORT="${BACKEND_PORT:-9080}"

# 8080 사용 중인 PID
LIVE_PID=""
if command -v lsof &>/dev/null; then
  LIVE_PID=$(lsof -ti :"$BACKEND_PORT" 2>/dev/null | head -1)
fi

# 유지할 프로세스 트리: LIVE_PID와 그 모든 조상
KEEP_PIDS=""
if [ -n "$LIVE_PID" ]; then
  CUR="$LIVE_PID"
  while [ -n "$CUR" ] && [ "$CUR" != "1" ]; do
    KEEP_PIDS="$KEEP_PIDS $CUR"
    CUR=$(ps -o ppid= -p "$CUR" 2>/dev/null | tr -d ' ')
  done
fi

should_keep() {
  local pid=$1
  [ -z "$pid" ] && return 1
  [ -z "$LIVE_PID" ] && return 0
  case " $KEEP_PIDS " in
    *" $pid "*) return 0;;
    *) return 1;;
  esac
}

KILLED=0
# nodemon server.js 또는 node server.js (backend 경로) 인데 유지 대상이 아닌 것만 종료
while read -r line; do
  pid=$(echo "$line" | awk '{print $1}')
  [ -z "$pid" ] && continue
  should_keep "$pid" && continue
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null && { echo "Killed duplicate PID: $pid"; KILLED=$((KILLED+1)); } || true
  fi
done < <(ps -eo pid,cmd --no-headers 2>/dev/null | grep -E "nodemon server\.js|node server\.js" | grep -v grep || true)

if [ "$KILLED" -gt 0 ]; then
  echo "Cleaned $KILLED duplicate process(es). Backend on port $BACKEND_PORT preserved."
else
  echo "No duplicate backend processes to clean. Port $BACKEND_PORT: ${LIVE_PID:-none}."
fi
