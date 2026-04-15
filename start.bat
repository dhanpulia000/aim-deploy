@echo off
cd backend
start "Backend Server" cmd /k "set DATABASE_URL=file:C:/Users/Textree/Work/Monitor/Wallboard/backend/prisma/prisma/dev.db && node server.js"
cd ..
timeout /t 2 /nobreak >nul
start "Frontend Dev" cmd /k "npm run dev"
echo Servers started!
pause
