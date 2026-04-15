# 네이버 크롤링 정책 회피 기법 분석

## 현재 구현된 기법

### 1. **Playwright 브라우저 자동화** ⭐ 핵심 기법

**방식:**
- 실제 Chromium 브라우저를 사용하여 크롤링
- JavaScript 실행, DOM 렌더링 등 실제 브라우저와 동일하게 동작

**효과:**
- 단순 HTTP 요청보다 탐지 어려움
- JavaScript 기반 보안 검사 우회 가능
- 실제 사용자처럼 보이는 행동 패턴 생성

**코드:**
```javascript
browser = await chromium.launch({
  headless: BROWSER_HEADLESS,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
```

### 2. **User-Agent 위장**

**방식:**
- 일반 Chrome 브라우저의 User-Agent 문자열 사용
- 실제 사용자와 동일한 헤더 설정

**효과:**
- 봇 탐지 시스템에서 일반 브라우저로 인식
- 기본적인 필터링 우회

**코드:**
```javascript
await page.setExtraHTTPHeaders({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
});
```

### 3. **쿠키 기반 인증**

**방식:**
- 로그인된 사용자의 쿠키를 복사하여 사용
- 실제 로그인 세션을 모방

**효과:**
- 멤버 전용 게시글 접근 가능
- 로그인된 사용자로 인식
- 일부 보안 검사 우회

**코드:**
```javascript
if (cookie) {
  const cookies = cookie.split(';').map(cookieStr => {
    const [name, value] = cookieStr.trim().split('=');
    return {
      name: name.trim(),
      value: value?.trim() || '',
      domain: '.naver.com',
      path: '/'
    };
  });
  await page.context().addCookies(cookies);
}
```

### 4. **요청 간 딜레이 (Rate Limiting 회피)**

**방식:**
- 각 게시글 처리 후 1초 대기
- 빠른 연속 요청 방지

**효과:**
- Rate Limiting 트리거 방지
- 자연스러운 사용자 행동 모방

**코드:**
```javascript
// 요청 간 딜레이 (서버 부하 방지)
await page.waitForTimeout(1000);
```

### 5. **스캔 간격 제어**

**방식:**
- 게시판별 스캔 간격 설정 (기본 60초)
- 마지막 스캔 시간 체크하여 중복 스캔 방지

**효과:**
- 과도한 요청 방지
- 서버 부하 최소화

**코드:**
```javascript
const SCAN_INTERVAL_MS = parseInt(process.env.NAVER_CAFE_SCAN_INTERVAL_MS) || 60000; // 기본 60초

if (board.lastScanAt) {
  const diffSec = (Date.now() - new Date(board.lastScanAt).getTime()) / 1000;
  if (diffSec < board.interval) {
    continue; // 스캔 스킵
  }
}
```

### 6. **Network Idle 대기**

**방식:**
- 페이지 로드 시 `networkidle` 옵션 사용
- 모든 네트워크 요청이 완료될 때까지 대기

**효과:**
- JavaScript로 동적 로드되는 콘텐츠도 수집 가능
- 완전히 렌더링된 페이지에서 데이터 추출

**코드:**
```javascript
await page.goto(board.listUrl, { 
  waitUntil: 'networkidle',
  timeout: 30000 
});
```

### 7. **페이지별 새 컨텍스트 사용**

**방식:**
- 각 게시판 스캔 시 새로운 페이지 생성
- 스캔 완료 후 페이지 닫기

**효과:**
- 세션 상태 분리
- 메모리 누수 방지
- 각 요청이 독립적으로 보임

**코드:**
```javascript
const page = await browser.newPage();
// ... 스캔 작업 ...
await page.close();
```

## 현재 사용하지 않는 고급 기법

### ❌ 미사용 기법들

1. **프록시 로테이션**
   - IP 주소 변경을 통한 탐지 회피
   - 현재: 단일 IP 사용

2. **Fingerprint 스푸핑**
   - 브라우저 핑거프린트 변경
   - Canvas, WebGL 등 고유 식별자 변경
   - 현재: 기본 Playwright 설정만 사용

3. **Stealth 플러그인**
   - `puppeteer-extra-plugin-stealth` 같은 도구
   - 자동화 탐지 우회 기능
   - 현재: 미사용

4. **랜덤 딜레이**
   - 고정된 1초 대기 대신 랜덤 딜레이
   - 더 자연스러운 패턴
   - 현재: 고정 1초

5. **마우스/키보드 이벤트 시뮬레이션**
   - 실제 사용자 행동 모방
   - 스크롤, 클릭 등 이벤트 생성
   - 현재: 미사용

## 정책 준수 여부

### ⚠️ 현재 상태

**준수하는 부분:**
- ✅ 공개 게시글만 크롤링 (쿠키 없을 때)
- ✅ 요청 간격 제어
- ✅ 서버 부하 최소화

**위반 가능성:**
- ⚠️ robots.txt 확인 없음
- ⚠️ 자동화 크롤링 금지 조항 위반 가능
- ⚠️ 대량 데이터 수집 시 정책 위반 가능

## 개선 권장사항

### 1. **robots.txt 확인 추가**

```javascript
// robots.txt 확인
const robotsTxt = await fetch('https://cafe.naver.com/robots.txt');
// 크롤링 허용 여부 확인
```

### 2. **랜덤 딜레이 적용**

```javascript
// 고정 딜레이 대신 랜덤 딜레이
const delay = 1000 + Math.random() * 2000; // 1-3초 랜덤
await page.waitForTimeout(delay);
```

### 3. **Stealth 플러그인 추가** (선택적)

```javascript
// puppeteer-extra-plugin-stealth 사용
// Playwright는 직접 지원하지 않으므로 별도 구현 필요
```

### 4. **User-Agent 로테이션**

```javascript
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36...',
  // ...
];
const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
```

### 5. **요청 빈도 제한 강화**

```javascript
// 더 긴 간격 설정
const SCAN_INTERVAL_MS = 300000; // 5분 (현재 60초)
```

## 법적/윤리적 고려사항

### ⚠️ 주의사항

1. **이용약관 위반 가능성**
   - 네이버는 자동화 크롤링을 금지할 수 있음
   - 계정 정지 위험

2. **개인정보보호법**
   - 게시글 내용 수집 시 개인정보 포함 가능
   - 적절한 처리 필요

3. **저작권**
   - 수집한 콘텐츠의 사용 범위 제한

### 권장사항

1. **공개 API 사용 검토**
   - 네이버에서 제공하는 공식 API 확인
   - 가능하면 API 사용

2. **사용자 동의**
   - 크롤링 대상 카페 관리자에게 사전 동의 요청

3. **제한적 사용**
   - 필요한 최소한의 데이터만 수집
   - 공개 게시글 위주로 제한

## 결론

현재 시스템은 **기본적인 정책 회피 기법**을 사용하고 있습니다:

✅ **사용 중:**
- Playwright 브라우저 자동화
- User-Agent 위장
- 쿠키 기반 인증
- 요청 간 딜레이
- 스캔 간격 제어

❌ **미사용:**
- 고급 탐지 회피 기법 (Stealth, Fingerprint 스푸핑)
- 프록시 로테이션
- 랜덤 딜레이
- 마우스/키보드 이벤트 시뮬레이션

**현재 방식은 기본적인 자동화 탐지를 우회하지만, 고급 탐지 시스템에는 취약할 수 있습니다.**




















