# 데이터베이스 마이그레이션 가이드

## 새로운 테이블 추가

다음 테이블들이 Prisma 스키마에 추가되었습니다:

1. **MonitoringKeyword** - 모니터링 키워드 관리
2. **MonitoringConfig** - 모니터링 설정 관리
3. **RawLog** - 원본 로그 저장 (이슈 승격 전 단계)

## 마이그레이션 실행 방법

### 방법 1: Prisma DB Push (개발 환경 권장)

```bash
cd backend
npx prisma db push
```

이 명령어는 스키마 변경사항을 데이터베이스에 직접 적용합니다.
- **장점**: 빠르고 간단함
- **단점**: 마이그레이션 히스토리가 생성되지 않음
- **권장**: 개발 환경에서만 사용

### 방법 2: Prisma Migrate (프로덕션 권장)

```bash
cd backend
npx prisma migrate dev --name add_monitoring_tables
```

이 명령어는 마이그레이션 파일을 생성하고 적용합니다.
- **장점**: 마이그레이션 히스토리 관리, 롤백 가능
- **단점**: 마이그레이션 파일 관리 필요
- **권장**: 프로덕션 환경에서 사용

### 방법 3: Prisma Migrate (이름 지정)

```bash
cd backend
npx prisma migrate dev --name add_monitoring_keyword_config_rawlog
```

## 마이그레이션 후 확인

마이그레이션이 성공적으로 완료되면 다음을 확인하세요:

1. **Prisma Client 재생성**:
   ```bash
   cd backend
   npx prisma generate
   ```

2. **데이터베이스 스키마 확인**:
   ```bash
   cd backend
   npx prisma studio
   ```
   브라우저에서 데이터베이스 구조를 확인할 수 있습니다.

## 새로 추가된 테이블 구조

### MonitoringKeyword
- `id`: Int (Primary Key, Auto Increment)
- `type`: String (discord/naver/system)
- `word`: String (키워드)
- `enabled`: Boolean (기본값: true)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**인덱스**: type, enabled, word

### MonitoringConfig
- `key`: String (Primary Key) - 설정 키 (예: 'crawler.interval')
- `value`: String - 설정 값 (JSON 문자열 또는 단순 문자열)
- `description`: String? - 설정 설명
- `createdAt`: DateTime
- `updatedAt`: DateTime

### RawLog
- `id`: String (Primary Key, CUID)
- `source`: String (discord/naver/system)
- `content`: String - 원본 내용
- `author`: String? - 작성자
- `timestamp`: DateTime - 원본 타임스탬프
- `isProcessed`: Boolean (기본값: false) - 이슈로 승격되었는지 여부
- `metadata`: String? - 추가 메타데이터 (JSON 문자열)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**인덱스**: source, isProcessed, timestamp, createdAt

## 주의사항

1. **백업**: 마이그레이션 전에 데이터베이스 백업을 권장합니다.
2. **환경 변수**: `DATABASE_URL` 환경 변수가 올바르게 설정되어 있는지 확인하세요.
3. **Prisma 버전**: Prisma 버전이 최신인지 확인하세요 (`npm list prisma`).

## 문제 해결

### 오류: "Migration failed"
- 데이터베이스 연결 확인
- 기존 마이그레이션 파일과 충돌 확인
- `prisma/migrations` 폴더 확인

### 오류: "Table already exists"
- 기존 테이블이 있는 경우, 스키마를 수정하거나 테이블을 삭제 후 재실행

### Prisma Client 오류
- `npx prisma generate` 실행하여 Prisma Client 재생성

## 다음 단계

마이그레이션이 완료되면:

1. 새로운 모니터링 모듈 통합
2. `RawLog` 테이블을 사용한 원본 데이터 수집 로직 구현
3. `MonitoringKeyword`를 사용한 키워드 필터링 로직 구현
4. `MonitoringConfig`를 사용한 설정 관리 로직 구현




















