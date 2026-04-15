# Backend Server

AIMGLOBAL 백엔드 — 다양한 데이터 소스 연동 API 서버입니다.

## 실행 방법

### 1. 기본 WebSocket 서버
```bash
node server.js
```

### 2. Google Sheets 연동 서버
```bash
node google-sheets-server.js
```
참고: `google-sheets-setup.md` 참조

### 3. Excel 파일 연동 서버
```bash
node excel-server.js
```
참고: `excel-setup.md` 참조

## 서버 설치

```bash
cd backend
npm install
```

## 엔드포인트

- REST API: http://localhost:9080 (기본값, 원본 8080과 분리)
- WebSocket: ws://127.0.0.1:9080 (HTTP 서버에 통합, 단일 포트 사용)

## 데이터 소스 선택

각 서버는 다른 데이터 소스를 사용합니다:

1. **server.js**: 메모리 내 Mock 데이터
2. **google-sheets-server.js**: Google Sheets 파일
3. **excel-server.js**: 로컬 Excel 파일

각각의 상세한 설정 방법은 해당 설정 가이드를 참조하세요.

## 데이터베이스 설정

현재 개발 환경에서는 SQLite를 사용하고 있으며, 프로덕션 환경에서 PostgreSQL로 전환할 수 있습니다.

자세한 내용은 `DATABASE_SETUP.md`를 참조하세요.

### 빠른 시작 (SQLite)

```bash
# 환경 변수 설정
echo 'DATABASE_URL="file:./prisma/dev.db"' > .env

# 마이그레이션 실행
npx prisma migrate deploy

# Prisma Client 생성
npx prisma generate
```

### PostgreSQL 사용 (프로덕션)

```bash
# 환경 변수 설정
echo 'DATABASE_URL="postgresql://user:password@localhost:5432/agent_ops_wallboard?schema=public"' > .env

# 마이그레이션 실행
npx prisma migrate deploy
```