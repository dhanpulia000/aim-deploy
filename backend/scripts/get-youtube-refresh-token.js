#!/usr/bin/env node

/**
 * YouTube OAuth2 Refresh Token 발급 스크립트
 * 
 * 사용법:
 * 1. Google Cloud Console에서 OAuth2 클라이언트 ID와 보안 비밀번호를 받습니다
 * 2. 이 스크립트를 실행합니다:
 *    node scripts/get-youtube-refresh-token.js
 * 3. 브라우저에서 표시된 URL로 이동하여 인증합니다
 * 4. 리디렉션된 URL에서 code 파라미터를 복사합니다
 * 5. 스크립트에 code를 입력하면 refresh_token을 받을 수 있습니다
 */

const readline = require('readline');
const https = require('https');
const { exec } = require('child_process');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function getRefreshToken() {
  console.log('='.repeat(60));
  console.log('YouTube OAuth2 Refresh Token 발급');
  console.log('='.repeat(60));
  console.log('');

  // 1. 클라이언트 ID 입력
  const clientId = await question('1. Google Cloud Console에서 받은 클라이언트 ID를 입력하세요: ');
  if (!clientId) {
    console.error('❌ 클라이언트 ID가 필요합니다.');
    rl.close();
    return;
  }

  // 2. 클라이언트 보안 비밀번호 입력
  const clientSecret = await question('2. 클라이언트 보안 비밀번호를 입력하세요: ');
  if (!clientSecret) {
    console.error('❌ 클라이언트 보안 비밀번호가 필요합니다.');
    rl.close();
    return;
  }

  // 3. 리디렉션 URI 입력
  const redirectUri = await question('3. 리디렉션 URI를 입력하세요 (기본값: http://localhost:3000/auth/youtube/callback): ') || 'http://localhost:3000/auth/youtube/callback';

  // 4. 인증 URL 생성
  const scope = 'https://www.googleapis.com/auth/youtube.readonly';
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(scope)}&` +
    `access_type=offline&` +
    `prompt=consent`;

  console.log('');
  console.log('='.repeat(60));
  console.log('다음 URL을 브라우저에서 열어주세요:');
  console.log('='.repeat(60));
  console.log(authUrl);
  console.log('');
  
  // 브라우저 자동 열기 시도
  const platform = process.platform;
  let openCommand;
  
  if (platform === 'darwin') {
    openCommand = 'open';
  } else if (platform === 'win32') {
    openCommand = 'start';
  } else {
    openCommand = 'xdg-open';
  }
  
  console.log('🌐 브라우저를 자동으로 여는 중...');
  exec(`${openCommand} "${authUrl}"`, (error) => {
    if (error) {
      console.log('⚠️  브라우저를 자동으로 열 수 없습니다. 수동으로 URL을 복사하여 브라우저에 붙여넣으세요.');
    } else {
      console.log('✅ 브라우저가 열렸습니다.');
    }
    console.log('');
  });
  
  console.log('1. 브라우저에서 Google 계정으로 로그인하고 권한을 승인합니다');
  console.log('2. 리디렉션된 URL 전체를 복사하거나 "code" 파라미터 값만 복사합니다');
  console.log('   예 (전체 URL): http://localhost:8080/auth/youtube/callback?code=4/0A...');
  console.log('   예 (code만): 4/0A...');
  console.log('   💡 전체 URL을 입력해도 자동으로 code를 추출합니다');
  console.log('');

  // 5. 인증 코드 입력
  let authCode = await question('4. 인증 코드(code)를 입력하세요: ');
  if (!authCode) {
    console.error('❌ 인증 코드가 필요합니다.');
    rl.close();
    return;
  }
  
  // URL 전체를 입력한 경우 code 파라미터만 추출
  authCode = authCode.trim();
  if (authCode.includes('?code=') || authCode.includes('&code=')) {
    // URL에서 code 파라미터 추출
    const urlMatch = authCode.match(/[?&]code=([^&]+)/);
    if (urlMatch && urlMatch[1]) {
      authCode = decodeURIComponent(urlMatch[1]);
      console.log('');
      console.log('✅ URL에서 인증 코드를 추출했습니다.');
    }
  }
  
  if (!authCode || authCode.length < 10) {
    console.error('❌ 유효한 인증 코드가 아닙니다.');
    rl.close();
    return;
  }

  // 6. Refresh Token 교환
  console.log('');
  console.log('Refresh Token을 발급받는 중...');

  const tokenData = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: authCode,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });

  const options = {
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': tokenData.toString().length
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);

          if (response.error) {
            console.error('❌ 오류 발생:', response.error);
            console.error('오류 설명:', response.error_description);
            reject(new Error(response.error_description || response.error));
            return;
          }

          if (!response.refresh_token) {
            console.error('❌ Refresh Token을 받을 수 없습니다.');
            console.error('응답:', JSON.stringify(response, null, 2));
            console.error('');
            console.error('가능한 원인:');
            console.error('1. 이미 이 클라이언트 ID로 refresh_token을 받았을 수 있습니다');
            console.error('2. OAuth 동의 화면에서 "access_type=offline"과 "prompt=consent"가 필요합니다');
            reject(new Error('Refresh token not found in response'));
            return;
          }

          console.log('');
          console.log('='.repeat(60));
          console.log('✅ Refresh Token 발급 성공!');
          console.log('='.repeat(60));
          console.log('');
          console.log('다음 환경 변수를 .env 파일에 추가하세요:');
          console.log('');
          console.log('YOUTUBE_CLIENT_ID=' + clientId);
          console.log('YOUTUBE_CLIENT_SECRET=' + clientSecret);
          console.log('YOUTUBE_REFRESH_TOKEN=' + response.refresh_token);
          console.log('');
          console.log('='.repeat(60));
          console.log('⚠️  보안 주의: 이 정보는 안전하게 보관하세요!');
          console.log('='.repeat(60));

          resolve(response);
        } catch (error) {
          console.error('❌ 응답 파싱 오류:', error.message);
          console.error('원본 응답:', data);
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ 요청 오류:', error.message);
      reject(error);
    });

    req.write(tokenData.toString());
    req.end();
  });
}

// 스크립트 실행
getRefreshToken()
  .then(() => {
    rl.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 오류:', error.message);
    rl.close();
    process.exit(1);
  });

