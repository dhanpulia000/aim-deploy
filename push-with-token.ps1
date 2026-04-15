# GitHub 푸시 스크립트 (Personal Access Token 사용)
# 사용법: 이 스크립트를 실행하면 토큰을 입력받아 푸시합니다

Write-Host "GitHub Personal Access Token을 입력하세요:" -ForegroundColor Yellow
Write-Host "(토큰은 화면에 표시되지 않습니다)" -ForegroundColor Gray
$token = Read-Host -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
$plainToken = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

# 원격 URL에 토큰 포함하여 푸시
$username = "NodeplugKorea2026"
$repoUrl = "https://${username}:${plainToken}@github.com/NodeplugKorea2026/AIM.git"

Write-Host "`n푸시 중..." -ForegroundColor Cyan
git push $repoUrl main

# 토큰 메모리에서 제거
$plainToken = $null
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

