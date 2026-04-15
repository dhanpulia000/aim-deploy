# Safe Server Restart Script (PowerShell)
# Uses absolute paths to avoid path errors

$ErrorActionPreference = "Stop"

# Get absolute script directory
$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    $scriptDir = Get-Location
}

Write-Host "=== Server Restart Started ===" -ForegroundColor Green
Write-Host "Script Directory: $scriptDir" -ForegroundColor Gray
Write-Host ""

# Verify backend directory exists
$backendDir = Join-Path $scriptDir "backend"
$serverFile = Join-Path $backendDir "server.js"

if (-not (Test-Path $serverFile)) {
    Write-Host "ERROR: server.js not found at: $serverFile" -ForegroundColor Red
    exit 1
}

Write-Host "[1/3] Stopping all Node.js processes..." -ForegroundColor Cyan

# Stop processes on port 8080
try {
    $connections = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if ($conn.OwningProcess) {
            $pid = $conn.OwningProcess
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
} catch {
    Write-Host "  No processes found on port 8080" -ForegroundColor Gray
}

# Stop processes on port 5173 (Vite dev server)
try {
    $connections = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if ($conn.OwningProcess) {
            $pid = $conn.OwningProcess
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
} catch {
    Write-Host "  No processes found on port 5173" -ForegroundColor Gray
}

# Force stop all Node.js processes (safety measure)
try {
    $nodeProcesses = Get-Process -Name node -ErrorAction SilentlyContinue
    foreach ($proc in $nodeProcesses) {
        Write-Host "  Force stopping Node.js process (PID: $($proc.Id))" -ForegroundColor Yellow
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
} catch {
    Write-Host "  No Node.js processes found" -ForegroundColor Gray
}

Start-Sleep -Seconds 2
Write-Host "  Done" -ForegroundColor Green
Write-Host ""

# Start server
Write-Host "[2/3] Starting integrated server..." -ForegroundColor Cyan
Write-Host "  Server file: $serverFile" -ForegroundColor Gray
Write-Host "  Working directory: $backendDir" -ForegroundColor Gray

try {
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = "node"
    $processInfo.Arguments = "server.js"
    $processInfo.WorkingDirectory = $backendDir
    $processInfo.UseShellExecute = $true
    $processInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
    
    $process = [System.Diagnostics.Process]::Start($processInfo)
    
    Start-Sleep -Seconds 3
    
    Write-Host "  Server started successfully (PID: $($process.Id))" -ForegroundColor Green
    Write-Host "  - HTTP API: http://localhost:8080/api" -ForegroundColor Gray
    Write-Host "  - WebSocket: ws://localhost:8080" -ForegroundColor Gray
    Write-Host "  - Frontend: http://localhost:8080" -ForegroundColor Gray
} catch {
    Write-Host "  ERROR: Failed to start server" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[3/3] Verifying server is running..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

try {
    $connection = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
    if ($connection) {
        Write-Host "  Server is running on port 8080" -ForegroundColor Green
    } else {
        Write-Host "  Warning: Port 8080 not listening yet (may need more time)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Could not verify server status" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Server Restart Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Check server logs in the separate window." -ForegroundColor Yellow







