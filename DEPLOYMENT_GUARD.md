## 배포/변경 사이드이펙트 방지 가드

기능 추가/DB 테이블 변경이 생길 때, **사전에 깨짐을 잡아내기 위한 최소 자동화 세트**입니다.

### 핵심 원칙
- **DB 변경 전 반드시 백업** (WAL 포함 일관 백업)
- **마이그레이션 누락 금지** (코드만 바꾸고 migration 안 만들면 운영에서 바로 깨짐)
- **배포 전 스모크 체크** (핵심 API가 200을 주는지)
- **롤백 경로 확보** (백업 파일 + 재시작)

### 사용법 (운영 배포 전)

```bash
cd AIM
bash scripts/predeploy-guard.sh
```

기본 동작:
- SQLite 안전 백업 생성: `backend/scripts/sqlite-safe-backup.js`
- (옵션) `PRAGMA quick_check`: `SQLITE_STARTUP_QUICK_CHECK=true`일 때만 수행
- Prisma migration 누락 체크: `backend/scripts/check-pending-migrations.js`
- 백엔드 테스트: `backend/npm test` (SKIP 가능)
- 프론트 빌드: `npm run build` (SKIP 가능)
- 스모크 체크: `backend/scripts/smoke-check.js`

### 옵션
- **테스트 스킵**

```bash
SKIP_TESTS=1 bash scripts/predeploy-guard.sh
```

- **프론트 빌드 스킵**

```bash
SKIP_BUILD=1 bash scripts/predeploy-guard.sh
```

### 롤백(최소)
1) 가장 최신 백업 파일로 DB 복구 (필요 시)
2) `pm2 restart aimforglobal-backend`
3) 프론트는 이전 빌드 산출물(dist)을 되돌리거나, 배포 대상 정적파일을 이전 버전으로 교체

