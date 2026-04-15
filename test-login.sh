#!/bin/bash
echo "=== 로그인 API 테스트 ==="
echo ""
echo "1. 로그인 API 호출 테스트:"
curl -X POST http://localhost:9080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}' \
  -w "\nHTTP Status: %{http_code}\n" \
  -s | head -20
echo ""
echo "2. 서버 접속 확인:"
curl -s http://localhost:9080 | grep -o "<title>.*</title>"
echo ""
echo "=== 테스트 완료 ==="
echo ""
echo "브라우저에서 접속:"
echo "  - 로컬: http://localhost:9080"
echo "  - 네트워크: http://10.1.186.30:9080"
