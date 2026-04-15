# aim.iceberg101.com 도메인·HTTPS 해결

## 원인 (진단)

- DNS는 `aim.iceberg101.com` → 공인 IP(예: 61.74.194.125)로 정상 해석되는 경우가 많음.
- **HTTPS에서 `unrecognized name` / SNI 오류** → 443에서 **`server_name aim.iceberg101.com`** 과 맞는 **인증서·가상 호스트**가 없거나, 다른 기본 서버만 응답할 때 발생.

이 저장소만으로 **공인 서버의 OpenResty/Nginx에 직접 접속해 고칠 수는 없습니다.** 아래 파일을 **프록시가 돌아가는 머신**에 올려 적용해야 합니다.

## 적용 순서 (프록시 서버에서)

### 1) HTTP(80)로 ACME 경로 열기

저장소의 설정을 복사합니다.

- 설정 파일: [`docs/nginx-openresty-aim.iceberg101.com.conf`](docs/nginx-openresty-aim.iceberg101.com.conf)

**인증서가 아직 없을 때:** 설정 파일의 **`server { listen 443 ... }` 블록 전체를 잠시 주석 처리**하고 **80번 `server`만** 적용·reload 한 뒤 certbot으로 발급하고, 발급 후 443 블록을 다시 켭니다 (없는 `ssl_certificate` 를 가리키면 `nginx -t` 가 실패합니다).

1. [`docs/nginx-openresty-aim.iceberg101.com.conf`](docs/nginx-openresty-aim.iceberg101.com.conf) 를 OpenResty/Nginx에 포함 (`sites-enabled` 등). 최초에는 **443 블록 주석**.
2. `upstream aim_backend` 가 앱과 다르면 `127.0.0.1:8080` 을 실제 **IP:8080** 으로 수정.
3. `sudo mkdir -p /var/www/certbot`
4. `nginx -t` 후 reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
# OpenResty 예:
# sudo /usr/local/openresty/bin/openresty -t && sudo /usr/local/openresty/bin/openresty -s reload
```

### 2) Let’s Encrypt 인증서 발급 (80번 ACME가 열린 뒤)

```bash
cd /path/to/AIM
sudo SSL_EMAIL='you@yourdomain.com' ./scripts/server-ssl-aim.iceberg101.com.sh
```

또는 직접:

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d aim.iceberg101.com --email YOUR@EMAIL --agree-tos
```

### 3) 443 블록 활성화·경로 확인

`fullchain.pem` / `privkey.pem` 경로가 발급 결과와 일치하는지 확인 후 다시 `nginx -t` 및 reload.

### 4) 자동 갱신

```bash
sudo systemctl enable --now certbot.timer
# 또는 cron: certbot renew
```

## 앱 서버 쪽

- `node server.js` 가 **8080**에서 떠 있어야 하고, 배포 시 **`npm run build`** 로 `dist`가 있어야 백엔드가 프론트 정적 파일을 같이 줄 수 있습니다 (현재 `backend/app.js` 구조).
- 프로덕션에서는 **pm2/systemd** 로 백엔드를 상시 기동하는 것을 권장합니다.

## 임시 우회

- `http://aim.iceberg101.com` (HTTPS 아님) — 가능한 서버만 해당.
- **보안상 HTTPS 설정이 올바른 것이 정답**입니다.
