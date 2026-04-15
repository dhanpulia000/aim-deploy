@echo off
echo 테스트 시작...

echo 백엔드 서버 실행...
start "Backend" cmd /k "cd /d %~dp0backend && node server.js"
timeout /t 2 /nobreak

echo 프론트엔드 서버 실행...
npm run dev

