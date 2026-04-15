# 설치 및 실행 가이드

## 1단계: 의존성 설치

```bash
npm install
```

## 2단계: 백엔드 서버 실행 (새 터미널)

```bash
cd backend
node excel-server.js
```

성공하면:
```
REST API: http://localhost:8080
WebSocket: ws://localhost:8081
Excel 파일 생성: ...\backend\data\wallboard-data.xlsx
Excel 파일 연동 모드
```

## 3단계: 프론트엔드 실행 (새 터미널)

```bash
npm run dev
```

성공하면 브라우저가 자동으로 열리고 http://localhost:5173 에서 실행됩니다.

## 트러블슈팅

### vite를 찾을 수 없습니다
```bash
# node_modules 삭제 후 재설치
rm -rf node_modules package-lock.json  # Linux/Mac
del /s /q node_modules package-lock.json  # Windows

npm install
```

### 포트가 이미 사용 중입니다
다른 포트로 실행:
```bash
# vite.config.ts 수정
server: {
  port: 3001  // 다른 포트 번호
}
```

## Excel 파일 수정하기

1. `backend/data/wallboard-data.xlsx` 파일 열기
2. Agents 시트에서 에이전트 정보 수정
3. Tickets 시트에서 티켓 정보 추가/수정
4. 저장하면 5초 내 자동 반영

