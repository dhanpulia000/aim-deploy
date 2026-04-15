# 환경 변수 설정 가이드

## 필수 환경 변수

### 1. 데이터베이스

```env
DATABASE_URL="file:./prisma/dev.db"
```

### 2. OpenAI API (AI 분류 기능 사용 시)

```env
OPENAI_API_KEY=sk-...                    # OpenAI API 키
OPENAI_BASE_URL=https://api.openai.com/v1  # 기본값 (변경 불필요)
OPENAI_MODEL=gpt-4o-mini                  # 기본값 (변경 불필요)
```

### 3. Discord 봇 (Discord 모니터링 사용 시)

```env
DISCORD_BOT_TOKEN=...                     # Discord 봇 토큰
DISCORD_GUILD_ID=...                      # Discord 서버 ID (선택)
DISCORD_CHANNEL_IDS=...                   # 모니터링할 채널 ID (쉼표로 구분, 선택)
```

### 4. Naver Cafe (Naver Cafe 크롤링 사용 시)

```env
NAVER_CAFE_SCAN_INTERVAL_MS=60000         # 스캔 간격 (밀리초, 기본: 60000)
BROWSER_HEADLESS=true                     # 헤드리스 모드 (기본: true)
NAVER_CAFE_COOKIE=...                     # Naver Cafe 쿠키 (선택)
```

### 5. 서버 포트

```env
PORT=8080                                  # HTTP 서버 포트 (기본: 8080)
# WebSocket은 HTTP 서버에 통합되어 단일 포트(8080) 사용
# WS_PORT는 사용되지 않음 (레거시 호환성을 위해 남겨둠)
```

### 6. JWT 인증

```env
JWT_SECRET=your_secret_key_here            # JWT 토큰 서명 키
JWT_EXPIRES_IN=7d                         # 토큰 만료 시간 (기본: 7d)
```

### 7. RawLog 프로세서

```env
RAWLOG_PROCESS_INTERVAL_MS=30000           # RawLog 처리 간격 (밀리초, 기본: 30000)
```

### 8. 파트너 영상 아카이빙 (YouTube / TikTok / 인스타그램)

```env
# YouTube (필수: YouTube 행이 있는 경우)
YOUTUBE_API_KEY=your_youtube_api_key_here

# TikTok (Apify 기반, 선택: TikTok 행이 있는 경우)
TIKTOK_APIFY_API_TOKEN=your_apify_api_token_here
# 선택: Apify Actor ID (기본값: gratenes/tiktok-media-and-metadata-retriever)
TIKTOK_APIFY_ACTOR_ID=gratenes/tiktok-media-and-metadata-retriever

# 인스타그램 (Apify 기반, 선택: 인스타그램 행이 있는 경우. TIKTOK_APIFY_API_TOKEN 재사용 가능)
INSTAGRAM_APIFY_API_TOKEN=your_apify_api_token_here
# 선택: Apify Actor ID (기본값: apify/instagram-post-scraper)
INSTAGRAM_APIFY_ACTOR_ID=apify/instagram-post-scraper

# 파트너 영상 아카이빙 → Discord 알림 (선택: 설정 시 수집 완료 후 Embed 전송, 중복 전송 방지)
PARTNER_ARCHIVING_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## .env 파일 예시

```env
# 데이터베이스
DATABASE_URL="file:./prisma/dev.db"

# OpenAI API 설정
OPENAI_API_KEY=sk-proj-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

# Discord 봇 (선택)
DISCORD_BOT_TOKEN=...

# Naver Cafe (선택)
NAVER_CAFE_SCAN_INTERVAL_MS=60000
BROWSER_HEADLESS=true

# 서버 포트
PORT=8080
# WebSocket은 HTTP 서버에 통합되어 단일 포트(8080) 사용
# WS_PORT는 사용되지 않음 (레거시 호환성을 위해 남겨둠)

# JWT 인증
JWT_SECRET=DEV_SECRET_CHANGE_IN_PRODUCTION
JWT_EXPIRES_IN=7d

# RawLog 프로세서
RAWLOG_PROCESS_INTERVAL_MS=30000
```

## 설정 확인

### 1. 환경 변수 로드 확인

서버 시작 시 로그에서 확인:

```
[dotenv] injecting env (N) from .env
```

### 2. OpenAI API 키 확인

서버 로그에서:

```
[AIClassifier] AI API key not configured
```

또는

```
[AIClassifier] Classification successful
```

### 3. 환경 변수 테스트

Node.js 콘솔에서:

```javascript
require('dotenv').config();
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '설정됨' : '설정 안됨');
```

## 보안 주의사항

⚠️ **중요**:

1. `.env` 파일은 절대 Git에 커밋하지 마세요
2. API 키는 공개 저장소에 업로드하지 마세요
3. 프로덕션 환경에서는 환경 변수 관리 시스템 사용 권장
4. `.gitignore`에 `.env`가 포함되어 있는지 확인

## 문제 해결

### 환경 변수가 로드되지 않는 경우

1. `.env` 파일 위치 확인: `backend/.env`
2. 파일 인코딩 확인: UTF-8
3. 서버 재시작 확인
4. `require('dotenv').config()` 호출 확인

### API 키가 인식되지 않는 경우

1. 따옴표 확인: 따옴표 없이 입력
   ```env
   OPENAI_API_KEY=sk-...  # ✅ 올바름
   OPENAI_API_KEY="sk-..."  # ❌ 따옴표 제거
   ```
2. 공백 확인: 키 앞뒤 공백 제거
3. 서버 재시작 확인




















