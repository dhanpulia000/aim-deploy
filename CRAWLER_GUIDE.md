# 크롤러 실행 가이드

## 크롤러 종류

### 1. 자동 실행 크롤러 (서버 시작 시 자동 실행)

서버가 시작되면 다음 크롤러들이 자동으로 실행됩니다:

- **Naver Cafe 크롤러**: 네이버 카페 게시판 모니터링
- **Discord 크롤러**: Discord 채널 모니터링 (토큰 설정 시)
- **Slack 공지 수집**: Slack 공지사항 수집 (토큰 설정 시)
- **RawLog Processor**: RawLog를 Issue로 승격

### 2. 현재 실행 상태 확인

**웹 UI에서:**
1. 브라우저에서 `http://localhost:8080` 접속
2. 로그인 (admin@example.com / admin123)
3. 상단 메뉴에서 **"모니터링"** 클릭
4. **"상태"** 탭에서 크롤러 실행 상태 확인

**API로 확인:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8080/api/monitoring/status
```

## 크롤러 실행 방법

### 방법 1: 웹 UI에서 수동 실행 (권장)

1. **모니터링 페이지 접속**
   - 메뉴 → **"모니터링"** 클릭

2. **수동 크롤링 트리거**
   - **"상태"** 탭에서 **"지금 스캔"** 버튼 클릭
   - 또는 **"설정"** 탭에서 크롤링 간격 조정

3. **게시판 관리**
   - **"게시판"** 탭에서 모니터링할 게시판 추가/수정/삭제
   - 게시판 활성화/비활성화

### 방법 2: API로 수동 실행

**수동 크롤링 트리거:**
```bash
curl -X POST http://localhost:8080/api/monitoring/trigger-scan \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**Slack 공지 수집 트리거:**
```bash
curl -X POST http://localhost:8080/api/monitoring/trigger-slack-notice \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### 방법 3: 서버 재시작 (자동 크롤러 재시작)

```bash
# 서버 종료
pkill -f "node server.js"

# 서버 시작 (자동으로 크롤러도 시작됨)
cd /home/young-dev/AIM/backend
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
node server.js
```

## 크롤러 설정

### 환경 변수 (.env 파일)

**Naver Cafe 크롤러:**
```env
NAVER_CAFE_SCAN_INTERVAL_MS=300000  # 스캔 간격 (밀리초, 기본 5분)
BROWSER_HEADLESS=true                # 헤드리스 모드
NAVER_CAFE_COOKIE=...                # 네이버 카페 쿠키 (선택)
```

**Discord 크롤러:**
```env
DISCORD_BOT_TOKEN=...                # Discord 봇 토큰
DISCORD_GUILD_ID=...                 # Discord 서버 ID (선택)
DISCORD_CHANNEL_IDS=...              # 모니터링할 채널 ID (선택)
```

**Slack 크롤러:**
```env
SLACK_BOT_TOKEN=...                  # Slack 봇 토큰
SLACK_NOTICE_CHANNEL_ID=...          # 공지사항 채널 ID
```

### 웹 UI에서 설정

1. **모니터링** → **"설정"** 탭
2. 다음 설정 조정:
   - 스캔 간격 (초)
   - 쿨다운 시간 (초)
   - 네이버 카페 쿠키
   - 제외할 게시판 목록

## 현재 활성화된 모니터링 게시판

- 배틀그라운드 공식카페 - PUBG: BATTLEGROUNDS (ID: 1)
- 배틀그라운드 모바일 공식 카페 (ID: 2)

## 크롤러 상태 확인

### 웹 UI
- **모니터링** → **"상태"** 탭
- 워커 실행 상태 확인
- 마지막 실행 시간 확인

### 로그 확인
```bash
# 서버 로그 확인
tail -f /var/log/syslog | grep -i "crawler\|worker\|naver"

# 또는 서버 콘솔에서 직접 확인
# Cursor 터미널에서 서버 로그 확인
```

## 문제 해결

### 크롤러가 실행되지 않는 경우

1. **서버 재시작**
   ```bash
   pkill -f "node server.js"
   cd /home/young-dev/AIM/backend
   export NVM_DIR="$HOME/.nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
   node server.js
   ```

2. **Playwright 브라우저 설치 확인**
   ```bash
   cd /home/young-dev/AIM/backend
   npx playwright install
   ```

3. **환경 변수 확인**
   ```bash
   cd /home/young-dev/AIM/backend
   cat .env | grep -E "NAVER|DISCORD|SLACK"
   ```

### 크롤러가 데이터를 수집하지 않는 경우

1. **모니터링 게시판 활성화 확인**
   - 웹 UI → 모니터링 → 게시판 탭
   - 게시판이 활성화되어 있는지 확인

2. **키워드 설정 확인**
   - 웹 UI → 모니터링 → 키워드 탭
   - 모니터링 키워드가 설정되어 있는지 확인

3. **로그 확인**
   - 웹 UI → 모니터링 → 로그 탭
   - RawLog가 생성되는지 확인

## 참고

- 크롤러는 백그라운드에서 자동으로 실행됩니다
- 웹 UI에서 실시간으로 상태를 확인할 수 있습니다
- 수동으로 크롤링을 트리거할 수 있습니다

