# 화면이 비어있는 문제 해결 가이드

## 확인 사항

### 1. 브라우저 개발자 도구 확인 (가장 중요!)

**F12를 눌러 개발자 도구를 열고:**

1. **Console 탭 확인:**
   - 빨간색 에러 메시지가 있는지 확인
   - JavaScript 에러 확인
   - 에러 메시지를 복사해주세요

2. **Network 탭 확인:**
   - 페이지 새로고침 (F5)
   - 실패한 요청(빨간색)이 있는지 확인
   - 각 요청의 Status Code 확인:
     - 200: 성공
     - 404: 파일 없음
     - 500: 서버 오류
     - CORS error: CORS 문제

3. **Elements 탭 확인:**
   - `<div id="root"></div>` 안에 내용이 있는지 확인
   - React가 렌더링되었는지 확인

### 2. 일반적인 원인

#### A. JavaScript 파일 로드 실패
**증상:** Console에 "Failed to load resource" 에러
**해결:** 
- 브라우저 캐시 삭제 (Ctrl+Shift+Delete)
- 하드 새로고침 (Ctrl+F5)

#### B. API 연결 실패
**증상:** Console에 CORS 에러 또는 401/403 에러
**해결:**
- 로그인 상태 확인
- API 엔드포인트 확인

#### C. React 렌더링 실패
**증상:** Console에 React 에러
**해결:**
- 에러 메시지 확인
- 코드 문제일 수 있음

#### D. 빌드 파일 불일치
**증상:** 404 에러 (파일을 찾을 수 없음)
**해결:**
- 프론트엔드 재빌드 필요
- 서버 재시작

### 3. 즉시 시도할 수 있는 해결 방법

#### 방법 1: 브라우저 캐시 삭제
1. Ctrl+Shift+Delete (Windows) 또는 Cmd+Shift+Delete (Mac)
2. 캐시된 이미지 및 파일 선택
3. 삭제 후 페이지 새로고침

#### 방법 2: 하드 새로고침
- Ctrl+F5 (Windows) 또는 Cmd+Shift+R (Mac)

#### 방법 3: 시크릿 모드에서 테스트
- 시크릿/프라이빗 모드에서 접속
- 캐시 문제인지 확인

#### 방법 4: 다른 브라우저에서 테스트
- Chrome, Firefox, Edge 등 다른 브라우저 시도

### 4. 서버 측 확인

**프론트엔드 재빌드:**
```bash
cd /home/young-dev/AIM
npm run build
```

**서버 재시작:**
```bash
pkill -f "node server.js"
cd /home/young-dev/AIM/backend
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
node server.js
```

## 디버깅 정보 수집

브라우저 개발자 도구에서 다음 정보를 확인해주세요:

1. **Console 에러 메시지** (전체 복사)
2. **Network 탭의 실패한 요청** (URL과 Status Code)
3. **Elements 탭의 `<div id="root">` 내용**

이 정보를 알려주시면 정확한 원인을 찾을 수 있습니다!

