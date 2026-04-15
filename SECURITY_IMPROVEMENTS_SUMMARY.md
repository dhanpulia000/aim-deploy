# 보안 개선 작업 요약

## ✅ 완료된 작업

### 1. 코드 보안 개선

#### CORS 정책 강화
- **파일**: `backend/app.js`
- **변경 사항**:
  - 프로덕션 환경에서 `ALLOWED_ORIGINS` 환경 변수로 허용 오리진 제어
  - 개발 환경에서는 기존 동작 유지 (모든 오리진 허용)
  - 업로드 파일 경로(`/uploads`)에도 동일한 정책 적용

#### WebSocket 보안 강화
- **파일**: `backend/server.js`
- **변경 사항**:
  - 프로덕션 환경에서 Origin 검증 추가
  - `verifyClient` 콜백으로 무단 접근 방지

#### Rate Limiting 적용
- **파일**: `backend/routes/auth.routes.js`
- **변경 사항**:
  - 로그인 엔드포인트: 1분당 5회 제한
  - 사용자 생성 엔드포인트: 1분당 3회 제한

### 2. 의존성 취약점 수정

- **파일**: `package.json`
- **변경 사항**:
  - `lodash >=4.17.22`로 강제 업데이트 (overrides 추가)
  - `recharts`의 하위 의존성 취약점 해결

### 3. 파일 권한 개선

- **`.env` 파일**: `664` → `600` (소유자만 읽기/쓰기)
- **`uploads` 디렉토리**: 
  - 디렉토리: `755`
  - 파일: `644`

## 📋 다음 단계 (수동 작업 필요)

### 1. 환경 변수 설정

`backend/.env` 파일에 다음 변수 추가:

```env
# 프로덕션 환경 설정
NODE_ENV=production

# 허용할 오리진 목록 (쉼표로 구분)
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### 2. 의존성 업데이트

```bash
cd /home/young-dev/AIM
npm install
```

### 3. 서버 재시작

변경 사항 적용을 위해 서버 재시작:

```bash
# PM2 사용 시
pm2 restart aimforglobal-backend

# 또는 직접 실행 시
# 서버 종료 후 재시작
```

### 4. 방화벽 설정 (권장)

```bash
# UFW 활성화
sudo ufw enable

# 필요한 포트만 허용
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp    # HTTP (Nginx 리버스 프록시)
sudo ufw allow 443/tcp   # HTTPS

# 8080은 내부에서만 접근 가능하도록 설정
# (리버스 프록시를 사용하는 경우)
```

### 5. 리버스 프록시 설정 (권장)

Nginx를 사용하여 외부에는 80/443 포트만 노출하고, 내부적으로 8080 포트로 프록시:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🔍 검증 방법

### 1. CORS 정책 확인

브라우저 개발자 도구에서:
- Network 탭에서 CORS 헤더 확인
- 프로덕션 환경에서 허용되지 않은 오리진에서 요청 시 차단 확인

### 2. Rate Limiting 확인

```bash
# 로그인 엔드포인트에 5회 이상 요청 시 429 에러 확인
for i in {1..6}; do
  curl -X POST http://localhost:8080/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"test"}'
  echo ""
done
```

### 3. WebSocket 보안 확인

프로덕션 환경에서:
- 허용되지 않은 오리진에서 WebSocket 연결 시도 시 차단 확인

### 4. 의존성 취약점 확인

```bash
npm audit --omit=dev
```

## 📝 참고 사항

- 모든 변경 사항은 **하위 호환성**을 유지합니다
- 개발 환경에서는 기존 동작이 유지됩니다
- 프로덕션 환경에서만 보안 정책이 강화됩니다

## ⚠️ 주의 사항

1. **환경 변수 설정 필수**: 프로덕션 환경에서는 반드시 `ALLOWED_ORIGINS`를 설정해야 합니다
2. **서버 재시작 필요**: 변경 사항 적용을 위해 서버를 재시작해야 합니다
3. **의존성 업데이트**: `npm install`을 실행하여 lodash 취약점이 수정되었는지 확인하세요

---

**작업 완료일**: 2026-01-23
