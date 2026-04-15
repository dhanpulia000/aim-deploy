/**
 * 수동 스캔 트리거 테스트 스크립트
 */

const http = require('http');

const options = {
  hostname: '127.0.0.1',
  port: 8080,
  path: '/api/monitoring/trigger-scan',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // 실제 사용 시에는 JWT 토큰이 필요합니다
    // 'Authorization': 'Bearer YOUR_JWT_TOKEN'
  }
};

console.log('수동 스캔 트리거 테스트...\n');
console.log('⚠️  실제 사용 시에는 Admin 페이지에서 트리거하거나 JWT 토큰이 필요합니다.\n');

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      console.log('응답:', JSON.stringify(result, null, 2));
    } catch (e) {
      console.log('응답 (텍스트):', data);
    }
  });
});

req.on('error', (error) => {
  console.error('요청 실패:', error.message);
});

req.end();












