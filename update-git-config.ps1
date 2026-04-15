# Git 사용자 정보 업데이트 스크립트

Write-Host "=== Git 사용자 정보 업데이트 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "현재 설정:" -ForegroundColor Yellow
Write-Host "  사용자명: $(git config user.name)" -ForegroundColor Gray
Write-Host "  이메일: $(git config user.email)" -ForegroundColor Gray
Write-Host ""

Write-Host "새로운 GitHub 계정 정보를 입력하세요:" -ForegroundColor Yellow
$newUsername = Read-Host "GitHub 사용자명"
$newEmail = Read-Host "GitHub 이메일"

Write-Host ""
Write-Host "설정을 업데이트하시겠습니까? (Y/N)" -ForegroundColor Yellow
$confirm = Read-Host

if ($confirm -eq "Y" -or $confirm -eq "y") {
    git config --global user.name $newUsername
    git config --global user.email $newEmail
    
    Write-Host ""
    Write-Host "✅ Git 설정이 업데이트되었습니다!" -ForegroundColor Green
    Write-Host "  사용자명: $(git config user.name)" -ForegroundColor Gray
    Write-Host "  이메일: $(git config user.email)" -ForegroundColor Gray
} else {
    Write-Host "취소되었습니다." -ForegroundColor Yellow
}

