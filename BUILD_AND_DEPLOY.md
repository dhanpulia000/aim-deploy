# 배포용 빌드 생성 가이드

## 배포 구조

이 프로젝트는 **프론트엔드와 백엔드를 통합 배포**하는 방식입니다:
- 프론트엔드: Vite로 빌드하여 `dist/` 폴더에 생성
- 백엔드: Express 서버가 `dist/` 폴더의 정적 파일을 서빙

## 빌드 단계

### 1. 프론트엔드 빌드

```bash
# 프로젝트 루트에서 실행
npm run build
```

**빌드 결과:**
- 빌드된 파일이 `dist/` 폴더에 생성됩니다
- `dist/index.html`, `dist/assets/` 등이 생성됩니다

**빌드 스크립트 확인:**
- `package.json`의 `"build": "vite build"` 스크립트 사용
- `vite.config.ts`에서 빌드 설정 확인 가능
  - 출력 디렉토리: `dist`
  - 빌드 전 기존 파일 삭제: `emptyOutDir: true`

### 2. 백엔드 설정 확인

백엔드는 자동으로 `dist/` 폴더를 서빙합니다:

**`backend/app.js` 설정:**
```javascript
// 프론트엔드 빌드 파일 서빙 (dist 폴더)
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// 기본 라우트: 프론트엔드 index.html 서빙
app.get('*', (req, res, next) => {
  // API 경로는 제외
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }
  
  // dist/index.html 반환
  const indexPath = path.join(distPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    // 에러 처리...
  });
});
```

## 전체 배포 프로세스

### 개발 환경에서 배포용 빌드 생성

```bash
# 1. 프론트엔드 빌드
npm run build

# 2. 백엔드 의존성 확인 (필요시)
cd backend
npm install

# 3. Prisma 클라이언트 생성 (필요시)
npx prisma generate

# 4. 데이터베이스 마이그레이션 (필요시)
npx prisma migrate deploy

# 5. 백엔드 서버 시작
cd backend
npm start
# 또는
node server.js
```

### 프로덕션 환경 변수 설정

**`backend/.env` 파일:**
```env
# 데이터베이스
DATABASE_URL="file:./prisma/dev.db"
# 또는 PostgreSQL (프로덕션)
# DATABASE_URL="postgresql://user:password@localhost:5432/wallboard?schema=public"

# 서버
PORT=9080
WS_PORT=9081
NODE_ENV=production

# JWT
JWT_SECRET=your-production-secret-key

# 기타 설정...
```

## 배포 체크리스트

### 빌드 전 확인사항

- [ ] 모든 코드 변경사항 커밋
- [ ] 환경 변수 파일 (`.env`) 확인
- [ ] 데이터베이스 마이그레이션 필요 여부 확인

### 빌드 실행

- [ ] `npm run build` 실행
- [ ] `dist/` 폴더가 생성되었는지 확인
- [ ] 빌드 에러가 없는지 확인

### 배포 후 확인사항

- [ ] 백엔드 서버가 정상적으로 시작되는지 확인
- [ ] 프론트엔드가 정상적으로 로드되는지 확인
- [ ] API 엔드포인트가 정상 작동하는지 확인
- [ ] 정적 파일 (이미지 등)이 정상 로드되는지 확인

## 빌드 스크립트 상세

### package.json

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:check": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

- `npm run build`: 프로덕션 빌드 생성
- `npm run build:check`: TypeScript 타입 체크 후 빌드
- `npm run preview`: 빌드된 파일 미리보기 (로컬 테스트용)

### vite.config.ts

```typescript
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true  // 빌드 전 기존 파일 삭제
  }
})
```

## 배포 시나리오

### 시나리오 1: 단일 서버 배포

```bash
# 1. 빌드
npm run build

# 2. 백엔드 서버 시작
cd backend
npm start
```

서버는 `http://localhost:9080`(AIMGLOBAL 기본, 원본과 분리)에서 실행되며:
- 프론트엔드: `http://localhost:9080/`
- API: `http://localhost:9080/api/*`
- 업로드 파일: `http://localhost:9080/uploads/*`

### 시나리오 2: 프로덕션 서버 배포

```bash
# 1. 코드 배포
git pull origin main

# 2. 의존성 설치
npm install
cd backend && npm install

# 3. 프론트엔드 빌드
npm run build

# 4. Prisma 설정
cd backend
npx prisma generate
npx prisma migrate deploy

# 5. 환경 변수 설정
# backend/.env 파일 확인/수정

# 6. 서버 시작 (PM2, systemd 등 사용)
pm2 start backend/server.js
# 또는
node backend/server.js
```

## 문제 해결

### dist 폴더가 없는 경우

백엔드 서버 시작 시 다음 메시지가 표시됩니다:
```json
{
  "message": "Wallboard API Server",
  "note": "Frontend not built. Run \"npm run build\" to build the frontend."
}
```

**해결 방법:**
```bash
npm run build
```

### 빌드 에러 발생 시

1. TypeScript 타입 체크:
```bash
npm run build:check
```

2. 의존성 재설치:
```bash
rm -rf node_modules package-lock.json
npm install
```

3. Vite 캐시 삭제:
```bash
rm -rf node_modules/.vite
npm run build
```

### 정적 파일이 로드되지 않는 경우

1. `dist/` 폴더가 올바른 위치에 있는지 확인
2. 백엔드 서버의 `app.js`에서 `distPath` 설정 확인
3. 파일 권한 확인

## 참고 사항

- 개발 환경에서는 Vite 개발 서버(`npm run dev`)를 별도로 실행할 수 있습니다
- 프로덕션에서는 백엔드 서버가 프론트엔드를 서빙하므로 별도의 프론트엔드 서버가 필요 없습니다
- `dist/` 폴더는 `.gitignore`에 포함되어 있으므로 각 환경에서 빌드해야 합니다









