# 모든 서버 재시작 스크립트

# 스크립트 파일의 절대 경로 가져오기
$scriptPath = $MyInvocation.MyCommand.Path
if (-not $scriptPath) {
    $scriptPath = $PSCommandPath
}
if (-not $scriptPath) {
    # 현재 실행 디렉토리에서 스크립트 찾기
    $scriptPath = Get-ChildItem -Path $PWD -Filter "restart-all-servers.ps1" -File | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $scriptPath) {
    Write-Host "오류: 스크립트 파일을 찾을 수 없습니다." -ForegroundColor Red
    exit 1
}

$scriptDir = Split-Path -Parent $scriptPath
$projectRoot = $scriptDir

Write-Host "=== 서버 재시작 시작 ===" -ForegroundColor Cyan
Write-Host "프로젝트 루트: $projectRoot" -ForegroundColor Gray

# 현재 디렉토리를 프로젝트 루트로 변경
Set-Location $projectRoot

# 1. 기존 프로세스 종료
Write-Host "`n[1/4] 기존 서버 프로세스 종료 중..." -ForegroundColor Yellow

# 포트 8080, 5173 사용 중인 프로세스 종료
$ports = @(8080, 5173)
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if ($conn.State -eq "Listen") {
            $processId = $conn.OwningProcess
            if ($processId -gt 0) {
                Write-Host "  포트 $port 사용 중인 프로세스 종료 (PID: $processId)" -ForegroundColor Gray
                Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# Node.js 프로세스 중 WallboardV2 관련 프로세스 종료
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like "*WallboardV2*"
} | ForEach-Object {
    Write-Host "  Node.js 프로세스 종료 (PID: $($_.Id))" -ForegroundColor Gray
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2
Write-Host "  완료" -ForegroundColor Green

# 2. 백엔드 서버 시작
Write-Host "`n[2/4] 백엔드 서버 시작 중..." -ForegroundColor Yellow

$backendPath = Join-Path $projectRoot "backend"
if (Test-Path $backendPath) {
    Write-Host "  백엔드 경로: $backendPath" -ForegroundColor Gray
    
    Write-Host "  node server.js 실행 중 (새 창에서 열림)..." -ForegroundColor Gray
    Start-Process -FilePath "cmd" -ArgumentList "/k", "cd /d `"$backendPath`" && node server.js" -WindowStyle Normal
    
    Start-Sleep -Seconds 3
    
    # 백엔드 서버 시작 확인
    $backendStarted = $false
    for ($i = 0; $i -lt 10; $i++) {
        $listening = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
        if ($listening) {
            $backendStarted = $true
            Write-Host "  백엔드 서버 시작됨 (포트 8080)" -ForegroundColor Green
            break
        }
        Start-Sleep -Seconds 1
    }
    
    if (-not $backendStarted) {
        Write-Host "  경고: 백엔드 서버가 시작되지 않았을 수 있습니다." -ForegroundColor Yellow
    }
} else {
    Write-Host "  오류: backend 디렉토리를 찾을 수 없습니다. (경로: $backendPath)" -ForegroundColor Red
}

Set-Location $projectRoot

# 3. 프론트엔드 서버 시작
Write-Host "`n[3/4] 프론트엔드 서버 시작 중..." -ForegroundColor Yellow

$packageJsonPath = Join-Path $projectRoot "package.json"
if (Test-Path $packageJsonPath) {
    Write-Host "  프론트엔드 경로: $projectRoot" -ForegroundColor Gray
    Write-Host "  npm run dev 실행 중 (새 창에서 열림)..." -ForegroundColor Gray
    Start-Process -FilePath "cmd" -ArgumentList "/k", "cd /d `"$projectRoot`" && npm run dev" -WindowStyle Normal
    
    Start-Sleep -Seconds 3
    
    # 프론트엔드 서버 시작 확인
    $frontendStarted = $false
    for ($i = 0; $i -lt 10; $i++) {
        $listening = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
        if ($listening) {
            $frontendStarted = $true
            Write-Host "  프론트엔드 서버 시작됨 (포트 5173)" -ForegroundColor Green
            break
        }
        Start-Sleep -Seconds 1
    }
    
    if (-not $frontendStarted) {
        Write-Host "  경고: 프론트엔드 서버가 시작되지 않았을 수 있습니다." -ForegroundColor Yellow
    }
} else {
    Write-Host "  오류: package.json을 찾을 수 없습니다." -ForegroundColor Red
}

# 4. 최종 상태 확인
Write-Host "`n[4/4] 서버 상태 확인 중..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

$backendStatus = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
$frontendStatus = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue

Write-Host "`n=== 서버 재시작 완료 ===" -ForegroundColor Cyan
if ($backendStatus) {
    Write-Host "  백엔드 서버: 실행 중 (포트 8080)" -ForegroundColor Green
} else {
    Write-Host "  백엔드 서버: 실행 안 됨" -ForegroundColor Red
}

if ($frontendStatus) {
    Write-Host "  프론트엔드 서버: 실행 중 (포트 5173)" -ForegroundColor Green
} else {
    Write-Host "  프론트엔드 서버: 실행 안 됨" -ForegroundColor Red
}

Write-Host "`n서버 로그는 별도 창에서 확인하세요." -ForegroundColor Gray

