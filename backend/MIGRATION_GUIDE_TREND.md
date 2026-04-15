# 스키마 변경 마이그레이션 가이드

## 변경 사항

### 1. MonitoredBoard 모델 확장
- `name` (String?): 게시판 이름 필드 추가
- `url` (String?): 타겟 URL 필드 추가
- `isActive` (Boolean, default: true): enabled와 동일한 목적 (호환성)
- `checkInterval` (Int, default: 60): interval과 동일한 목적 (호환성)

### 2. ReportItemIssue 모델 확장
- `trend` (String?): 동향/토픽 요약 필드 추가 (3단어 이내)

## 마이그레이션 명령어

### 개발 환경 (빠른 적용)
```bash
cd backend
npx prisma db push
```

### 프로덕션 환경 (마이그레이션 파일 생성)
```bash
cd backend
npx prisma migrate dev --name add_trend_and_monitored_board_fields
```

### Prisma 클라이언트 재생성
```bash
cd backend
npx prisma generate
```

## 주의사항

1. **데이터 손실 가능성**: 
   - `MonitoredBoard`에 새 필드 추가는 기존 데이터에 영향을 주지 않습니다 (nullable 필드)
   - `ReportItemIssue.trend` 필드도 nullable이므로 기존 데이터에 영향을 주지 않습니다

2. **기존 필드 호환성**:
   - `MonitoredBoard.enabled`와 `isActive`는 동일한 목적으로 사용 가능
   - `MonitoredBoard.interval`와 `checkInterval`는 동일한 목적으로 사용 가능
   - 기존 코드는 `enabled`와 `interval`를 계속 사용할 수 있습니다

3. **AI 분류 결과**:
   - AI 분류 시 `trend` 필드가 자동으로 채워집니다
   - 기존 이슈는 `trend`가 null로 유지됩니다

## 검증

마이그레이션 후 다음을 확인하세요:

```sql
-- MonitoredBoard 새 필드 확인
SELECT id, name, url, isActive, checkInterval FROM MonitoredBoard LIMIT 5;

-- ReportItemIssue trend 필드 확인
SELECT id, summary, trend FROM ReportItemIssue WHERE trend IS NOT NULL LIMIT 5;
```

## 롤백 (필요시)

스키마 변경을 되돌리려면:

```bash
cd backend
# 마이그레이션 히스토리 확인
npx prisma migrate status

# 특정 마이그레이션으로 롤백
npx prisma migrate resolve --rolled-back <migration_name>
```

또는 수동으로 스키마 파일을 이전 버전으로 되돌린 후:

```bash
npx prisma db push --force-reset  # ⚠️ 주의: 모든 데이터 삭제
```

