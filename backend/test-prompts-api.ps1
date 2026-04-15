Write-Host "`n=== AI 프롬프트 API 테스트 ===`n"

try {
    $token = (Invoke-RestMethod -Uri "http://localhost:8080/api/auth/login" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"email":"admin@example.com","password":"admin123"}').data.token
    $headers = @{"Authorization"="Bearer $token"}
    
    Write-Host "1. 프롬프트 목록 조회:"
    $prompts = Invoke-RestMethod -Uri "http://localhost:8080/api/ai-prompts" -Headers $headers
    Write-Host "  총 $($prompts.data.Count)개"
    $prompts.data | ForEach-Object {
        Write-Host "  - $($_.displayName) (v$($_.version), Active: $($_.isActive))"
    }
    
    Write-Host "`n2. sentiment_analysis 프롬프트 상세 조회:"
    $sentiment = Invoke-RestMethod -Uri "http://localhost:8080/api/ai-prompts/sentiment_analysis" -Headers $headers
    Write-Host "  이름: $($sentiment.data.displayName)"
    Write-Host "  버전: v$($sentiment.data.version)"
    Write-Host "  활성: $($sentiment.data.isActive)"
    Write-Host "  설명: $($sentiment.data.description)"
    
    Write-Host "`n✓ API 테스트 성공!"
} catch {
    Write-Host "오류: $_"
}

