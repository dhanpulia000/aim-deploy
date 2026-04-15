# Personal Access Token을 사용하여 직접 푸시하는 스크립트
# 사용법: 이 스크립트를 실행하고 토큰을 입력하세요

Write-Host "GitHub Personal Access Token을 입력하세요:" -ForegroundColor Yellow
Write-Host "(토큰은 화면에 표시되지 않습니다)" -ForegroundColor Gray
$token = Read-Host -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
$plainToken = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

# 원격 URL에 토큰 포함
$username = "NodeplugKorea2026"
$repoUrl = "https://${plainToken}@github.com/NodeplugKorea2026/AIM.git"

Write-Host "`n원격 URL 업데이트 중..." -ForegroundColor Cyan
git remote set-url origin $repoUrl

Write-Host "`n푸시 중..." -ForegroundColor Cyan
git push -u origin main

# 원격 URL을 토큰 없이 다시 설정 (보안)
Write-Host "`n원격 URL을 안전하게 복원 중..." -ForegroundColor Cyan
git remote set-url origin https://github.com/NodeplugKorea2026/AIM.git

# 토큰 메모리에서 제거
$plainToken = $null
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

Write-Host "`n완료!" -ForegroundColor Green

