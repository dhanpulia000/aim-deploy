# AIMGLOBAL

실시간 모니터링 업무를 위한 AIMGLOBAL 웹 애플리케이션입니다.

Discord와 네이버 카페에서 발생하는 이슈를 실시간으로 모니터링하고, 에이전트의 처리 상황을 한눈에 파악할 수 있습니다.

## 주요 기능

- **실시간 이슈 모니터링**: Discord, 네이버 카페, 시스템에서 발생하는 이슈 실시간 추적
- **에이전트 상태 표시**: 각 에이전트의 현재 상태, 처리 중인 티켓, 오늘 처리량 등 표시
- **KPI 대시보드**: 열린 이슈 수, Sev1 이슈, SLA 임박 이슈, 평균 처리 시간 등의 핵심 지표
- **필터링**: 소스 및 심각도별 필터링 기능
- **WebSocket 지원**: 실시간 데이터 업데이트를 위한 WebSocket 연동 준비

## 기술 스택

### 프론트엔드 (Frontend)
- **TypeScript**: 정적 타입 언어 (JavaScript의 확장)
- **React 18**: UI 라이브러리 (컴포넌트 기반)
- **Tailwind CSS**: 유틸리티 기반 CSS 프레임워크
- **Vite**: 빠른 빌드 도구 및 개발 서버

### 백엔드 (Backend)
- **JavaScript (Node.js)**: 서버 사이드 런타임 환경
- **Express.js**: 웹 애플리케이션 프레임워크
- **Prisma**: ORM (Object-Relational Mapping) - 데이터베이스 관리
- **SQLite**: 경량 데이터베이스
- **WebSocket (ws)**: 실시간 양방향 통신

### 주요 라이브러리
- **XLSX**: Excel 파일 처리
- **Google Sheets API**: Google 스프레드시트 연동
- **Multer**: 파일 업로드 처리
- **CORS**: Cross-Origin Resource Sharing 지원
- **Helmet**: 보안 헤더 설정

## 시작하기

### 설치

```bash
npm install
```

### 개발 서버 실행

**프론트엔드:**
```bash
npm run dev
```
브라우저에서 **http://localhost:5175** 를 엽니다. (원본 프로젝트가 5173을 쓰는 경우와 겹치지 않도록 AIMGLOBAL 기본값)

**백엔드:**
```bash
cd backend
npm run dev
```
백엔드 서버는 **http://localhost:9080** 에서 실행됩니다. (원본 8080과 동시 기동 가능)

**주의사항:**
- 프론트엔드와 백엔드를 모두 실행해야 정상 작동합니다.
- 포트는 루트 `.env.development` 의 `VITE_DEV_PORT` / `VITE_BACKEND_URL` 과 `backend/.env` 의 `PORT` 로 바꿀 수 있습니다.
- WebSocket은 백엔드 서버(기본 9080)에 통합되어 있습니다.

### 빌드

```bash
npm run build
```

빌드된 파일은 `dist` 폴더에 생성됩니다.

### 프로덕션 미리보기

```bash
npm run preview
```

## WebSocket 연동

WebSocket은 백엔드 서버(기본 9080)에 통합되어 있습니다. 프론트엔드는 자동으로 연결됩니다.

**개발 환경:**
- 프론트엔드: http://localhost:5175 (`.env.development` 로 변경 가능)
- 백엔드 API: http://localhost:9080/api
- WebSocket: ws://127.0.0.1:9080 (자동 연결, `VITE_BACKEND_PORT` 로 조정)

**프로덕션 환경:**
- WebSocket은 현재 호스트의 동일한 포트를 사용합니다.

WebSocket 연결은 `src/hooks/useRealtime.ts`에서 자동으로 관리됩니다.

## 프로젝트 구조

```
├── src/                    # 프론트엔드 소스 (TypeScript/React)
│   ├── App.tsx            # 메인 애플리케이션 컴포넌트
│   ├── Dashboard.tsx      # 대시보드 컴포넌트
│   ├── Admin.tsx          # 관리자 페이지
│   ├── Login.tsx          # 로그인 페이지
│   ├── components/        # 재사용 가능한 컴포넌트
│   ├── types/             # TypeScript 타입 정의
│   └── data/              # 데이터 서비스
├── backend/                # 백엔드 소스 (JavaScript/Node.js)
│   ├── server.js          # Express 서버 진입점
│   ├── controllers/       # 컨트롤러 (비즈니스 로직)
│   ├── services/          # 서비스 레이어
│   ├── routes/            # API 라우트 정의
│   ├── middlewares/       # 미들웨어
│   ├── utils/             # 유틸리티 함수
│   ├── prisma/            # Prisma 스키마 및 마이그레이션
│   └── data/              # 데이터 파일 (제외됨)
├── index.html             # HTML 템플릿
├── package.json           # 프론트엔드 의존성
├── tsconfig.json          # TypeScript 설정
├── vite.config.ts         # Vite 설정
└── tailwind.config.js     # Tailwind CSS 설정
```

## 개발 언어 요약

이 프로젝트는 **풀스택 웹 애플리케이션**으로 구성되어 있습니다:

- **프론트엔드**: TypeScript + React (TSX 파일)
- **백엔드**: JavaScript + Node.js (JS 파일)
- **데이터베이스**: Prisma ORM을 통한 SQLite
- **스타일링**: Tailwind CSS
- **빌드 도구**: Vite (프론트엔드), Node.js (백엔드)

## 라이센스

MIT

