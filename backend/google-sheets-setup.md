# Google Sheets 연동 설정 가이드

## 1단계: Google Cloud Console 설정

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 새 프로젝트 생성 또는 기존 프로젝트 선택
3. **API 및 서비스 > 라이브러리**에서 **Google Sheets API** 활성화
4. **API 및 서비스 > 사용자 인증 정보**로 이동
5. **+ 사용자 인증 정보 만들기 > 서비스 계정** 선택
6. 서비스 계정 이름 입력 후 **만들고 계속하기**
7. 역할은 기본값으로 두고 **계속하기**
8. **완료** 클릭

## 2단계: 서비스 계정 키 파일 생성

1. 생성된 서비스 계정을 클릭
2. **키** 탭으로 이동
3. **키 추가 > 새 키 만들기** 선택
4. JSON 형식 선택 후 **만들기**
5. 다운로드된 JSON 파일을 프로젝트에 저장

## 3단계: Google Sheets 준비

1. [Google Sheets](https://sheets.google.com/) 접속
2. 새 스프레드시트 생성
3. 두 개의 시트 생성:
   - **Agents**: 에이전트 정보
   - **Tickets**: 티켓 정보

### Agents 시트 구조
| id | name | status | handling | todayResolved | avgHandleSec | channelFocus |
|----|------|--------|----------|---------------|--------------|--------------|
| a1 | Jin | busy | 2 | 8 | 320 | PUBG PC |
| a2 | Ara | available | 0 | 5 | 410 | PUBG MOBILE,PUBG NEW STATE |

### Tickets 시트 구조
| id | title | source | createdAt | slaDeadlineAt | severity | sentiment | status | link | tags |
|----|-------|--------|-----------|---------------|----------|-----------|--------|------|------|
| t1 | 버그 보고 | discord | 2024-01-01 10:00 | 2024-01-01 12:00 | 1 | neg | new | # | 버그 |

## 4단계: 스프레드시트 공유

1. Google Sheets에서 **공유** 버튼 클릭
2. 서비스 계정 이메일 (예: `your-service@your-project.iam.gserviceaccount.com`) 추가
3. **편집자** 권한 부여
4. **완료** 클릭

## 5단계: 스프레드시트 ID 확인

Google Sheets URL에서 스프레드시트 ID 복사:
```
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
```

## 6단계: 서버 설정

1. `google-sheets-server.js` 파일 수정:
   - `SPREADSHEET_ID`: Google Sheets URL에서 복사한 ID
   - `credentials`: 다운로드한 JSON 키 파일 내용

2. 의존성 설치:
```bash
npm install google-spreadsheet
```

3. 서버 실행:
```bash
node google-sheets-server.js
```

## 업데이트 주기 설정

`google-sheets-server.js`의 `setInterval` 값 조정:
```javascript
setInterval(async () => {
  // 10000 = 10초마다 업데이트
}, 10000);
```

## 참고 사항

- Google Sheets API에는 할당량 제한이 있습니다 (초당 100요청)
- 인증 정보는 절대 공개 저장소에 커밋하지 마세요
- `.gitignore`에 인증 파일 추가:
  ```
  *.json
  !package.json
  credentials/
  ```

