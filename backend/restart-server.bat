@echo off
echo ========================================
echo 백엔드 서버 재시작
echo ========================================
echo.

echo [1/3] 실행 중인 Node.js 프로세스 확인...
tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I /N "node.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo 실행 중인 Node.js 프로세스가 있습니다.
    echo 프로세스를 종료합니다...
    taskkill /F /IM node.exe >NUL 2>&1
    timeout /t 2 /nobreak >NUL
    echo 프로세스 종료 완료.
) else (
    echo 실행 중인 Node.js 프로세스가 없습니다.
)
echo.

echo [2/3] 서버 시작 중...
cd /d "%~dp0"
start "Wallboard Backend Server" cmd /k "node server.js"
echo.

echo [3/3] 서버 시작 완료!
echo.
echo 서버가 새 창에서 실행됩니다.
echo 창을 닫으면 서버가 종료됩니다.
echo.
echo 잠시 후 브라우저에서 확인하세요:
echo - http://localhost:8080/api/health
echo.
pause























