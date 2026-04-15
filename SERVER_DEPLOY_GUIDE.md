# 서버 배포 가이드

Cursor로 접속한 원격 서버에 프로그램을 배포하는 방법입니다.

## 방법 1: Git을 사용한 배포 (권장)

### 전제 조건
- 서버에 Git이 설치되어 있어야 함
- GitHub 저장소에 코드가 푸시되어 있어야 함

### 배포 단계

#### 1. 서버에 SSH 접속
```bash
ssh user@server-ip
# 또는 Cursor에서 이미 원격 연결되어 있다면 터미널 사용
```

#### 2. 프로젝트 디렉토리로 이동
```bash
cd /path/to/deployment
# 예: cd /var/www/wallboard
```

#### 3. 저장소 클론 (처음 배포하는 경우)
```bash
git clone https://github.com/NodeplugKorea2026/AIM.git
cd AIM
```

#### 4. 또는 기존 저장소 업데이트
```bash
cd /path/to/existing/project
git pull origin main
```

#### 5. 의존성 설치
```bash
# 루트 디렉토리
npm install

# 백엔드 디렉토리
cd backend
npm install
```

#### 6. 환경 변수 설정
```bash
# backend/.env 파일 생성/수정
cd backend
nano .env
# 또는
vi .env
```

필수 환경 변수:
```env
DATABASE_URL="file:./prisma/dev.db"
# 또는 PostgreSQL
# DATABASE_URL="postgresql://user:password@localhost:5432/wallboard?schema=public"

PORT=8080
NODE_ENV=production
JWT_SECRET=your-production-secret-key
OPENAI_API_KEY=your-openai-key
```

#### 7. Prisma 설정
```bash
cd backend
npx prisma generate
npx prisma migrate deploy
```

#### 8. 프론트엔드 빌드
```bash
cd /path/to/project/root
npm run build
```

#### 9. 서버 시작
```bash
# PM2 사용 (권장)
pm2 start backend/server.js --name wallboard
pm2 save

# 또는 직접 실행
cd backend
node server.js
```

## 방법 2: SCP를 사용한 파일 전송

### 로컬에서 서버로 전체 프로젝트 전송

```powershell
# PowerShell에서 실행
# 전체 프로젝트 전송 (node_modules 제외)
scp -r -o "StrictHostKeyChecking=no" `
    --exclude="node_modules" `
    --exclude="dist" `
    --exclude=".git" `
    --exclude="*.db" `
    --exclude=".env" `
    . user@server-ip:/path/to/deployment/
```

### 또는 tar 압축 후 전송
```powershell
# 로컬에서 압축
tar -czf wallboard.tar.gz --exclude="node_modules" --exclude="dist" --exclude=".git" --exclude="*.db" --exclude=".env" .

# 서버로 전송
scp wallboard.tar.gz user@server-ip:/path/to/deployment/

# 서버에서 압축 해제
ssh user@server-ip "cd /path/to/deployment && tar -xzf wallboard.tar.gz"
```

## 방법 3: rsync를 사용한 동기화

```powershell
# PowerShell에서 실행
rsync -avz --exclude="node_modules" --exclude="dist" --exclude=".git" --exclude="*.db" --exclude=".env" `
    ./ user@server-ip:/path/to/deployment/
```

## 방법 4: Cursor 원격 기능 활용

### Cursor에서 원격 서버에 직접 배포

1. **Cursor에서 원격 서버 연결**
   - Cursor → Remote Explorer → SSH Targets
   - 서버 연결 설정

2. **터미널에서 직접 작업**
   - Cursor의 통합 터미널 사용
   - 위의 Git 방법 또는 파일 전송 방법 사용

## 배포 스크립트 생성

서버에서 실행할 배포 스크립트를 만들 수 있습니다:

### deploy.sh (서버용)
```bash
#!/bin/bash
set -e

echo "=== 배포 시작 ==="

# 프로젝트 디렉토리로 이동
cd /path/to/project

# Git에서 최신 코드 가져오기
echo "Git에서 최신 코드 가져오기..."
git pull origin main

# 의존성 설치
echo "의존성 설치 중..."
npm install
cd backend && npm install && cd ..

# Prisma 설정
echo "Prisma 설정 중..."
cd backend
npx prisma generate
npx prisma migrate deploy
cd ..

# 프론트엔드 빌드
echo "프론트엔드 빌드 중..."
npm run build

# 서버 재시작 (PM2 사용 시)
echo "서버 재시작 중..."
pm2 restart wallboard

echo "=== 배포 완료 ==="
```

스크립트 실행 권한 부여:
```bash
chmod +x deploy.sh
./deploy.sh
```

## 서버 설정 체크리스트

### 필수 확인사항
- [ ] Node.js 설치 확인 (`node --version`)
- [ ] npm 설치 확인 (`npm --version`)
- [ ] Git 설치 확인 (`git --version`)
- [ ] 포트 8080이 열려있는지 확인
- [ ] 방화벽 설정 확인
- [ ] PM2 설치 (선택사항, `npm install -g pm2`)

### 서버 시작 방법

#### PM2 사용 (권장)
```bash
# PM2 설치
npm install -g pm2

# 서버 시작
pm2 start backend/server.js --name wallboard

# 자동 시작 설정
pm2 startup
pm2 save

# 로그 확인
pm2 logs wallboard
```

#### systemd 서비스로 등록
```bash
# /etc/systemd/system/wallboard.service 파일 생성
sudo nano /etc/systemd/system/wallboard.service
```

서비스 파일 내용:
```ini
[Unit]
Description=Wallboard Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/project/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

서비스 활성화:
```bash
sudo systemctl daemon-reload
sudo systemctl enable wallboard
sudo systemctl start wallboard
sudo systemctl status wallboard
```

## 문제 해결

### 포트가 이미 사용 중인 경우
```bash
# 포트 사용 중인 프로세스 확인
lsof -i :8080
# 또는
netstat -tulpn | grep 8080

# 프로세스 종료
kill -9 <PID>
```

### 권한 문제
```bash
# 파일 권한 설정
chmod -R 755 /path/to/project
chown -R user:user /path/to/project
```

### 환경 변수 문제
```bash
# .env 파일 확인
cat backend/.env

# 환경 변수 로드 확인
cd backend
node -e "require('dotenv').config(); console.log(process.env.DATABASE_URL)"
```

## 빠른 배포 명령어 (한 줄)

```bash
cd /path/to/project && git pull origin main && npm install && cd backend && npm install && cd .. && npm run build && cd backend && pm2 restart wallboard
```

