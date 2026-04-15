# 슬랙 이미지 업로드 기능 확인 체크리스트

## 구현 완료 사항

### 1. 코드 구현
- ✅ `slack.service.js`에 이미지 파일 업로드 기능 추가
- ✅ `files.upload` API 사용 (안정적인 레거시 API)
- ✅ FormData를 사용한 multipart/form-data 업로드
- ✅ 파일 존재 확인 및 에러 핸들링
- ✅ 파일 업로드 후 스레드로 상세 메시지 전송
- ✅ `form-data` 패키지 dependency 추가

### 2. 기능 흐름
1. 이슈에 `screenshotPath`가 있는지 확인
2. 파일이 존재하는지 확인
3. FormData로 파일 업로드
4. 업로드 성공 시 스레드로 상세 메시지 전송
5. 실패 시 텍스트 메시지만 전송 (fallback)

### 3. 확인 필요 사항

#### 환경 변수 설정
- `SLACK_BOT_TOKEN`: Slack Bot Token이 설정되어 있어야 함
- `SLACK_CHANNEL`: 기본 채널 (선택사항, 없으면 '#general' 사용)

#### Slack 앱 권한 설정
Slack 앱에 다음 권한이 필요합니다:
- `files:write` - 파일 업로드 권한
- `chat:write` - 메시지 전송 권한
- `channels:read` - 채널 읽기 권한 (채널 ID 확인용)

#### 테스트 방법
1. **이슈에 스크린샷이 있는 경우**:
   - 이슈 상세 패널에서 "슬랙 공유" 버튼 클릭
   - 슬랙 채널에서 이미지와 메시지가 함께 전송되는지 확인

2. **이슈에 스크린샷이 없는 경우**:
   - 기존처럼 텍스트 메시지만 전송되는지 확인

3. **파일이 없는 경우**:
   - 스크린샷 파일이 삭제되었거나 없는 경우
   - 텍스트 메시지만 전송되는지 확인 (에러 없이)

### 4. 개선 사항

#### 현재 구현
- `files.upload` API 사용 (레거시이지만 안정적)
- 파일 업로드 후 스레드로 메시지 전송
- 에러 발생 시 텍스트 메시지로 fallback

#### 향후 개선 가능 사항
- `files.uploadV2` API로 업그레이드 (더 최신 API)
- 이미지 압축 기능 추가 (용량 최적화)
- 여러 이미지 동시 업로드 지원

### 5. 로그 확인
서버 로그에서 다음 메시지를 확인할 수 있습니다:
- `Slack message with screenshot sent via Bot API` - 성공
- `Screenshot file not found, sending text message only` - 파일 없음
- `Slack file upload failed, sending text message only` - 업로드 실패
- `Failed to send Slack message via Bot API` - 전체 실패

### 6. 문제 해결

#### 파일 업로드가 실패하는 경우
1. Slack Bot Token 확인
2. Slack 앱 권한 확인 (`files:write`)
3. 파일 경로 확인 (`backend/uploads/screenshots/...`)
4. 파일 크기 확인 (Slack은 최대 1GB까지 지원)

#### 메시지는 전송되지만 이미지가 없는 경우
1. `screenshotPath`가 이슈에 저장되어 있는지 확인
2. 파일이 실제로 존재하는지 확인
3. Slack 앱 권한 확인














