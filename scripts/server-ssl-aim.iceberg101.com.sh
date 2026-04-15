#!/usr/bin/env bash
# aim.iceberg101.com SSL 발급·갱신 — 프록시 서버(61.74.194.125 등)에서 root 로 실행
# 사용 전: HTTP(80) 서버 블록에 acme-challenge 경로가 열려 있어야 함 (docs/nginx-openresty-aim.iceberg101.com.conf 참고)
set -euo pipefail

DOMAIN="${DOMAIN:-aim.iceberg101.com}"
WEBROOT="${WEBROOT:-/var/www/certbot}"
EMAIL="${SSL_EMAIL:-}" # 비우면 certbot 이 대화형으로 물을 수 있음 — 운영 시 --email 지정 권장

echo "=== Certbot webroot 로 인증서 발급: $DOMAIN ==="
sudo mkdir -p "$WEBROOT"

if ! command -v certbot >/dev/null 2>&1; then
  echo "certbot 설치: sudo apt-get update && sudo apt-get install -y certbot"
  exit 1
fi

EMAIL_ARGS=()
if [[ -n "$EMAIL" ]]; then
  EMAIL_ARGS=(--email "$EMAIL" --agree-tos --no-eff-email)
else
  EMAIL_ARGS=(--register-unsafely-without-email --agree-tos)
fi

sudo certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" "${EMAIL_ARGS[@]}"

echo ""
echo "=== Nginx/OpenResty 설정에 다음 경로가 맞는지 확인 ==="
echo "  ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;"
echo "  ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;"
echo ""
echo "테스트 후 리로드:"
echo "  sudo nginx -t && sudo systemctl reload nginx"
echo "  # OpenResty: sudo openresty -t && sudo openresty -s reload"
echo ""
echo "자동 갱신: sudo systemctl status certbot.timer  (또는 cron에 certbot renew)"
