@echo off
REM Server restart script (Windows Batch)
REM Using English to avoid encoding issues

echo === Server Restart Started ===
echo.
echo Note: All services are integrated on port 8080
echo       Development can use port 5173 (Vite dev server)
echo.

REM Change to script directory
cd /d "%~dp0"

REM 1. Stop existing processes
echo [1/2] Stopping existing server processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    echo   Stopping process on port 8080 (PID: %%a)
    taskkill /F /PID %%a >nul 2>&1
)
REM Stop Vite dev server if running
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    echo   Stopping process on port 5173 (PID: %%a) - Vite dev server
    taskkill /F /PID %%a >nul 2>&1
)
REM Force stop all Node.js processes
for /f %%a in ('tasklist /FI "IMAGENAME eq node.exe" /NH ^| findstr "node.exe"') do (
    echo   Force stopping Node.js process
    taskkill /F /IM node.exe >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo   Done
echo.

REM 2. Start integrated server (port 8080)
echo [2/2] Starting integrated server (HTTP + WebSocket + Frontend)...
if exist "backend\server.js" (
    start "Integrated Server (8080)" cmd /k "cd /d %~dp0backend && node server.js"
    timeout /t 3 /nobreak >nul
    echo   Integrated server started (Port 8080)
    echo   - HTTP API: http://localhost:8080/api
    echo   - WebSocket: ws://localhost:8080
    echo   - Frontend: http://localhost:8080 (built files)
) else (
    echo   Error: backend\server.js not found
)
echo.

echo === Server Restart Complete ===
echo.
echo To use Vite dev server in development:
echo   npm run dev
echo.
echo Check server logs in the separate window.
pause
