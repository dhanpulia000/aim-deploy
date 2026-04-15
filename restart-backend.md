# 백엔드 서버 재시작 가이드

## 재시작 방법

### 1. 기존 서버 종료
```bash
# Ctrl+C를 눌러 현재 실행 중인 백엔드 서버 종료
```

### 2. 백엔드 재시작
```bash
cd backend
node server.js
```

또는

```bash
# 프로젝트 루트에서
npm run start-backend
```

### 3. 서버 실행 확인
- 백엔드 콘솔에 다음 메시지가 표시되면 성공:
  ```
  REST API: http://localhost:8080
  WebSocket: ws://localhost:8081
  ```

## 백엔드가 실행 중인지 확인
브라우저에서 `http://localhost:8080/api/data` 접속
- 데이터가 보이면 정상 실행 중

## 업로드 재시도
1. 브라우저 새로고침 (F5)
2. Dashboard 페이지로 이동
3. Mobile 일일보고서 업로드

