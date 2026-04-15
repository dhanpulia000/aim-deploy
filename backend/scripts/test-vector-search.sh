#!/bin/bash
# 벡터 검색 서비스 테스트 스크립트

set -e

echo "🧪 벡터 검색 서비스 테스트"
echo ""

BASE_URL="${1:-http://localhost:8080}"
API_URL="$BASE_URL/api/vector-search"

echo "📡 서버: $BASE_URL"
echo ""

# 1. 서비스 상태 확인
echo "1️⃣  서비스 상태 확인..."
STATUS_RESPONSE=$(curl -s "$API_URL/status" || echo "ERROR")
if echo "$STATUS_RESPONSE" | grep -q "success"; then
    echo "✅ 서비스 상태 확인 성공"
    echo "$STATUS_RESPONSE" | jq '.' 2>/dev/null || echo "$STATUS_RESPONSE"
else
    echo "❌ 서비스 상태 확인 실패"
    echo "$STATUS_RESPONSE"
    exit 1
fi

echo ""
echo "2️⃣  이슈 임베딩 생성 테스트..."
echo "   (실제 이슈 ID가 필요합니다)"
echo "   curl -X POST $API_URL/embed \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"issueId\":\"test_issue\",\"text\":\"테스트 이슈 내용\"}'"
echo ""

echo "3️⃣  벡터 검색 테스트..."
echo "   curl -X POST $API_URL \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"text\":\"서버 접속 문제\",\"limit\":5}'"
echo ""

echo "✅ 테스트 가이드 완료"
echo ""
echo "💡 실제 테스트를 하려면 인증 토큰이 필요합니다."
echo "   브라우저에서 로그인 후 개발자 도구의 Network 탭에서"
echo "   Authorization 헤더를 확인하세요."
