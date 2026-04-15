# 스키마 업데이트 마이그레이션 가이드

## 변경 사항

### 1. MonitoredBoard 모델
- `name` 필드: 게시판 이름 (required로 권장, 현재는 nullable)
- `url` 필드: 타겟 URL (required로 권장, 현재는 nullable)
- `isActive` 필드: 활성화 여부 (기본값: true)
- `checkInterval` 필드: 체크 간격 (기본값: 60초)

### 2. ReportItemIssue 모델
- `trend` 필드: 동향/토픽 요약 (3단어 이내) - **이미 존재**

### 3. AI 분류 로직 개선
- 프롬프트에서 필드명 변경: `categoryGroupName` → `categoryGroup`, `categoryName` → `category`
- JSON 응답 형식 업데이트
- 하위 호환성 유지 (레거시 필드명도 지원)

## 마이그레이션 명령어

### 개발 환경 (빠른 적용)
```bash
cd backend
npx prisma db push
```

### 프로덕션 환경 (마이그레이션 파일 생성)
```bash
cd backend
npx prisma migrate dev --name add_trend_and_update_monitored_board
npx prisma generate
```

## 주의사항

1. **데이터 손실 가능성**: `MonitoredBoard`의 `name`과 `url`을 required로 변경하면 기존 null 값이 있는 경우 오류가 발생할 수 있습니다.
   - 해결: 기존 데이터를 먼저 업데이트하거나, nullable로 유지

2. **AI 분류 필드명 변경**: 
   - 새로운 필드명 (`categoryGroup`, `category`) 사용 권장
   - 레거시 필드명 (`categoryGroupName`, `categoryName`)도 계속 지원

3. **Prisma 클라이언트 재생성**: 스키마 변경 후 반드시 실행
   ```bash
   npx prisma generate
   ```

## 검증

마이그레이션 후 다음을 확인하세요:

1. `MonitoredBoard` 테이블의 필드 확인
2. `ReportItemIssue` 테이블의 `trend` 필드 확인
3. AI 분류가 정상적으로 작동하는지 테스트




















