# YouTube 자막 분석 환경 설정 가이드

YouTube Data API v3의 자막 다운로드 기능을 사용하기 위해서는 OAuth2 인증이 필요합니다.

## 1. Google Cloud Console 설정

### 1.1 프로젝트 선택/생성
1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 프로젝트 선택 또는 새 프로젝트 생성
3. 프로젝트에서 **API 및 서비스** > **라이브러리**로 이동

### 1.2 YouTube Data API v3 활성화
1. 검색창에 "YouTube Data API v3" 입력
2. **YouTube Data API v3** 선택
3. **사용 설정** 클릭

### 1.3 OAuth 동의 화면 구성
1. **API 및 서비스** > **OAuth 동의 화면**으로 이동
2. 사용자 유형 선택:
   - **내부**: Google Workspace 조직 내부 사용
   - **외부**: 일반 Google 계정 사용 (대부분의 경우)
3. 앱 정보 입력:
   - **앱 이름**: 예) "YouTube 자막 분석"
   - **사용자 지원 이메일**: 본인 이메일
   - **앱 로고**: 선택사항
4. **저장 후 계속** 클릭

**중요**: OAuth 동의 화면에는 두 가지 모드가 있습니다:

#### 테스트 모드 (권장 - 심사 불필요)
- ✅ **Google 검수(심사) 불필요**: 즉시 사용 가능
- ✅ **제한된 사용자만 사용**: 테스트 사용자 목록에 추가된 사용자만 사용 가능
- ✅ **내부 도구에 적합**: 자막 분석 같은 내부 도구에는 이 모드로 충분
- ⚠️ **제한사항**: 최대 100명의 테스트 사용자만 사용 가능

#### 프로덕션 모드 (심사 필요)
- ❌ **Google 검수(심사) 필요**: Google의 검수 과정을 거쳐야 함 (수일~수주 소요)
- ✅ **모든 사용자 사용 가능**: 제한 없이 모든 Google 계정 사용 가능
- ⚠️ **요구사항**: 
  - 개인정보 처리방침 URL 필요
  - 서비스 약관 URL 필요
  - 앱 로고 필요
  - 상세한 앱 설명 필요
  - Google 검수 통과 필요

**권장**: 내부 도구로 사용하는 경우 **테스트 모드**로 유지하세요. 심사 없이 즉시 사용할 수 있습니다.

### 1.4 범위(Scopes) 추가
1. **범위 추가 또는 삭제** 클릭
2. 다음 범위 추가:
   - `https://www.googleapis.com/auth/youtube.readonly` (YouTube 데이터 읽기)
3. **업데이트** 클릭
4. **저장 후 계속** 클릭

### 1.5 테스트 사용자 추가 (테스트 모드인 경우 필수)
**테스트 모드**로 사용하는 경우, 다음 사용자들을 테스트 사용자로 추가해야 합니다:

1. **테스트 사용자** 섹션에서 **+ 추가** 클릭
2. 자막 분석에 사용할 Google 계정 이메일 추가
   - 본인 계정
   - 서버에서 사용할 계정 (있는 경우)
   - 팀원 계정 (있는 경우)
3. **저장 후 계속** 클릭

**참고**: 
- 테스트 모드는 최대 100명까지 추가 가능
- 테스트 사용자로 추가되지 않은 계정은 OAuth 인증이 거부됩니다
- 프로덕션 모드로 전환하면 모든 사용자가 사용 가능하지만, Google 검수가 필요합니다

### 1.6 OAuth 2.0 클라이언트 ID 생성
1. **API 및 서비스** > **사용자 인증 정보**로 이동
2. **+ 사용자 인증 정보 만들기** > **OAuth 클라이언트 ID** 선택
3. 애플리케이션 유형: **웹 애플리케이션** 선택
4. 이름: 예) "YouTube 자막 분석 클라이언트"
5. 승인된 리디렉션 URI 추가:
   ```
   http://localhost:3000/auth/youtube/callback
   ```
   또는
   ```
   http://localhost:8080/auth/youtube/callback
   ```
   (실제 서버 포트에 맞게 설정)
6. **만들기** 클릭
7. **클라이언트 ID**와 **클라이언트 보안 비밀번호** 복사 (나중에 다시 볼 수 없음)

## 2. Refresh Token 발급

### 방법 1: 자동 스크립트 사용 (권장)

프로젝트에 포함된 스크립트를 사용하면 쉽게 Refresh Token을 받을 수 있습니다:

```bash
cd /home/young-dev/AIM/backend
node scripts/get-youtube-refresh-token.js
```

스크립트가 다음을 안내합니다:
1. 클라이언트 ID 입력
2. 클라이언트 보안 비밀번호 입력
3. 리디렉션 URI 입력 (기본값 사용 가능)
4. 브라우저에서 인증 URL 열기
5. 인증 코드 입력
6. Refresh Token 자동 발급 및 환경 변수 형식으로 출력

### 방법 2: 수동 발급

### 2.1 인증 URL 생성
다음 URL을 브라우저에서 열고, 위에서 생성한 클라이언트 ID와 범위를 사용:

```
https://accounts.google.com/o/oauth2/v2/auth?
  client_id=YOUR_CLIENT_ID&
  redirect_uri=http://localhost:3000/auth/youtube/callback&
  response_type=code&
  scope=https://www.googleapis.com/auth/youtube.readonly&
  access_type=offline&
  prompt=consent
```

**주의**: `YOUR_CLIENT_ID`를 실제 클라이언트 ID로 교체하세요.

### 2.2 인증 코드 받기
1. 위 URL을 브라우저에서 열기
2. Google 계정 로그인
3. 권한 승인
4. 리디렉션 후 URL에서 `code` 파라미터 값 복사
   - 예: `http://localhost:3000/auth/youtube/callback?code=4/0A...`

### 2.3 Refresh Token 교환
다음 명령어로 Refresh Token을 받습니다:

```bash
curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=YOUR_AUTHORIZATION_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=http://localhost:3000/auth/youtube/callback"
```

응답 예시:
```json
{
  "access_token": "ya29.a0...",
  "expires_in": 3599,
  "refresh_token": "1//0g...",  // 이 값을 복사
  "scope": "https://www.googleapis.com/auth/youtube.readonly",
  "token_type": "Bearer"
}
```

**중요**: `refresh_token` 값을 복사하세요. 이 값은 한 번만 표시됩니다.

## 3. 환경 변수 설정

### 3.1 .env 파일에 추가
`/home/young-dev/AIM/backend/.env` 파일에 다음 변수 추가:

```env
# YouTube API Key (기존)
YOUTUBE_API_KEY=your_api_key_here

# YouTube OAuth2 (자막 분석용)
YOUTUBE_CLIENT_ID=your_client_id_here
YOUTUBE_CLIENT_SECRET=your_client_secret_here
YOUTUBE_REFRESH_TOKEN=your_refresh_token_here
```

### 3.2 값 입력
- `YOUTUBE_CLIENT_ID`: 1.6에서 복사한 클라이언트 ID
- `YOUTUBE_CLIENT_SECRET`: 1.6에서 복사한 클라이언트 보안 비밀번호
- `YOUTUBE_REFRESH_TOKEN`: 2.3에서 받은 refresh_token

## 4. 서버 재시작

환경 변수 설정 후 서버를 재시작하세요:

```bash
cd /home/young-dev/AIM/backend
# 서버 재시작
```

## 5. 테스트

### 5.1 OAuth2 클라이언트 확인
서버 로그에서 다음 메시지가 없어야 합니다:
- ❌ "OAuth2 클라이언트가 설정되지 않아 자막 분석을 건너뜁니다"

### 5.2 자막 분석 테스트
파트너 영상 아카이빙 기능을 사용하여 자막이 있는 영상으로 테스트:
- 자막이 있는 영상의 경우 자동으로 자막을 다운로드하고 분석합니다
- 첫 분석 시 할당량 100 units 소비
- 이후 같은 영상은 캐시에서 조회하여 할당량 소비 없음

## 6. 문제 해결

### 6.1 "invalid_grant" 오류
- Refresh Token이 만료되었거나 잘못되었습니다
- 2단계를 다시 수행하여 새로운 Refresh Token을 발급받으세요

### 6.2 "access_denied" 오류
- **테스트 모드**인 경우: OAuth 동의 화면에서 테스트 사용자로 계정을 추가했는지 확인
  - 테스트 사용자 목록에 없는 계정은 인증이 거부됩니다
  - **API 및 서비스** > **OAuth 동의 화면** > **테스트 사용자**에서 계정 추가
- **프로덕션 모드**로 전환하려면:
  - Google 검수(심사) 과정을 거쳐야 합니다
  - 개인정보 처리방침, 서비스 약관 등이 필요합니다
  - 검수 통과까지 수일~수주가 소요될 수 있습니다
  - **권장**: 내부 도구는 테스트 모드로 유지하세요

### 6.3 "redirect_uri_mismatch" 오류
- Google Cloud Console의 리디렉션 URI와 실제 사용한 URI가 일치하는지 확인

### 6.4 자막이 없는 영상
- 모든 영상에 자막이 있는 것은 아닙니다
- 자막이 없는 영상은 캐시에 저장되어 재시도하지 않습니다

## 7. 할당량 정보

### 자막 관련 API 할당량
- `captions.list`: 50 units (자막 목록 조회)
- `captions.download`: 50 units (자막 다운로드)
- **총 100 units/영상** (최초 1회만, 이후 캐시 사용)

### 일일 할당량
- 기본: 10,000 units/일
- 자막 분석 100개 영상 = 10,000 units 소비

## 8. 보안 주의사항

⚠️ **중요**: 
- `.env` 파일은 절대 Git에 커밋하지 마세요
- `.gitignore`에 `.env`가 포함되어 있는지 확인하세요
- 클라이언트 ID와 보안 비밀번호는 외부에 노출하지 마세요

## 9. 참고 자료

- [YouTube Data API v3 문서](https://developers.google.com/youtube/v3)
- [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Cloud Console](https://console.cloud.google.com/)

