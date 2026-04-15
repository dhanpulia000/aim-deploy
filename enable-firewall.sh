#!/bin/bash
# 방화벽 백엔드 포트 허용 스크립트 (AIMGLOBAL 기본 9080)

echo "=== UFW 방화벽 설정 ==="
echo ""

# 현재 상태 확인
echo "1. 현재 UFW 상태:"
sudo ufw status numbered
echo ""

BACKEND_PORT="${BACKEND_PORT:-9080}"
# 백엔드 포트 허용
echo "2. ${BACKEND_PORT} 포트 허용 중..."
sudo ufw allow "${BACKEND_PORT}/tcp" comment "AIMGLOBAL"
echo ""

# SSH 포트 보호 (필수!)
echo "3. SSH 포트 확인..."
sudo ufw allow 22/tcp comment "SSH"
echo ""

# 방화벽 규칙 적용
echo "4. 방화벽 규칙 적용..."
sudo ufw reload
echo ""

# 최종 상태
echo "5. 최종 UFW 상태:"
sudo ufw status numbered
echo ""

echo "=== 설정 완료 ==="
echo ""
echo "브라우저에서 다음 주소로 접속하세요:"
echo "  http://10.1.186.30:${BACKEND_PORT}"
echo ""
echo "로그인 정보:"
echo "  이메일: admin@example.com"
echo "  비밀번호: admin123"

