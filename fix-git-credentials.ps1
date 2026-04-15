# Git 자격 증명 수정 스크립트

Write-Host "=== Git 자격 증명 확인 및 수정 ===" -ForegroundColor Cyan
Write-Host ""

# 현재 Git 설정 확인
Write-Host "현재 Git 설정:" -ForegroundColor Yellow
Write-Host "  사용자명: $(git config user.name)" -ForegroundColor Gray
Write-Host "  이메일: $(git config user.email)" -ForegroundColor Gray
Write-Host ""

# Windows Credential Manager에서 GitHub 자격 증명 확인
Write-Host "Windows Credential Manager에서 GitHub 자격 증명 확인 중..." -ForegroundColor Yellow
Write-Host ""
Write-Host "다음 명령어로 저장된 자격 증명을 확인할 수 있습니다:" -ForegroundColor Cyan
Write-Host "  cmdkey /list | findstr git" -ForegroundColor White
Write-Host ""

# 자격 증명 삭제 옵션
Write-Host "저장된 GitHub 자격 증명을 삭제하려면:" -ForegroundColor Yellow
Write-Host "  cmdkey /delete:git:https://github.com" -ForegroundColor White
Write-Host ""

# Git 설정 변경 옵션
Write-Host "Git 사용자 정보를 변경하려면:" -ForegroundColor Yellow
Write-Host "  git config --global user.name 'YourGitHubUsername'" -ForegroundColor White
Write-Host "  git config --global user.email 'your-email@example.com'" -ForegroundColor White
Write-Host ""

Write-Host "=== 확인 사항 ===" -ForegroundColor Cyan
Write-Host "1. GitHub에 로그인한 계정이 koyoung.ice@gmail.com인지 확인" -ForegroundColor White
Write-Host "2. 이 계정이 NodeplugKorea2026 조직의 멤버인지 확인" -ForegroundColor White
Write-Host "3. Personal Access Token을 이 계정으로 생성했는지 확인" -ForegroundColor White
Write-Host ""

