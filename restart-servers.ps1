# 서버 재시작 스크립트 (PowerShell)
Write-Host "=== Server Restart Started ===" -ForegroundColor Green
Write-Host ""
Write-Host "Note: All services (HTTP, WebSocket, Frontend) are integrated on port 8080." -ForegroundColor Yellow
Write-Host "      Development environment can also use port 5173 (Vite dev server)." -ForegroundColor Yellow
Write-Host ""

# 현재 스크립트의 디렉토리로 이동
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# 1. 기존 프로세스 종료
Write-Host "[1/2] Stopping existing server processes..." -ForegroundColor Cyan

# 포트 8080 사용 프로세스 찾기 및 종료
$port8080 = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($port8080) {
    foreach ($connection in $port8080) {
        $pid = $connection.OwningProcess
        if ($pid) {
            try {
                $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
                if ($process -and $process.ProcessName -eq "node") {
                    Write-Host "  Stopping process on port 8080 (PID: $pid)" -ForegroundColor Yellow
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                }
            } catch {
                Write-Host "  Could not stop process $pid" -ForegroundColor Red
            }
        }
    }
}

# 포트 5173 사용 프로세스 찾기 및 종료 (Vite 개발 서버)
$port5173 = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if ($port5173) {
    foreach ($connection in $port5173) {
        $pid = $connection.OwningProcess
        if ($pid) {
            try {
                $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
                if ($process -and $process.ProcessName -eq "node") {
                    Write-Host "  Stopping process on port 5173 (PID: $pid) - Vite dev server" -ForegroundColor Yellow
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                }
            } catch {
                Write-Host "  Could not stop process $pid" -ForegroundColor Red
            }
        }
    }
}

# 모든 Node.js 프로세스 강제 종료 (안전장치)
Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  Force stopping Node.js process (PID: $($_.Id))" -ForegroundColor Yellow
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2
Write-Host "  Done" -ForegroundColor Green
Write-Host ""

# 2. 통합 서버 시작 (8080 포트)
Write-Host "[2/2] Starting integrated server (HTTP + WebSocket + Frontend)..." -ForegroundColor Cyan
$serverPath = Join-Path $scriptDir "backend\server.js"

if (Test-Path $serverPath) {
    $backendDir = Join-Path $scriptDir "backend"
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $backendDir -WindowStyle Normal
    Start-Sleep -Seconds 3
    Write-Host "  Integrated server started (Port 8080)" -ForegroundColor Green
    Write-Host "  - HTTP API: http://localhost:8080/api" -ForegroundColor Gray
    Write-Host "  - WebSocket: ws://localhost:8080" -ForegroundColor Gray
    Write-Host "  - Frontend: http://localhost:8080 (built files)" -ForegroundColor Gray
} else {
    Write-Host "  Error: backend\server.js not found" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Server Restart Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "To use Vite dev server in development environment:" -ForegroundColor Yellow
Write-Host "  npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "Check server logs in the separate window." -ForegroundColor Yellow







