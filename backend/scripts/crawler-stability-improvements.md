# 크롤러 및 이슈 승격 로직 안정성 강화

## 개선 사항 요약

### 1. 메인 크롤러 (naverCafe.worker.js)

#### 안정성 강화:
- **postData null/undefined 검사 추가** (2504줄)
  - postData가 유효하지 않으면 해당 게시글 스킵하고 다음 게시글 처리
  - 크리티컬: 이슈 승격 시 필수 데이터 누락 방지

- **안전한 문자열 처리**
  - postData.content와 postData.title에 타입 검사 추가
  - optional chaining만으로는 부족한 경우를 대비한 명시적 검사

- **키워드 필터링 시 안전한 문자열 연결**
  - null/undefined 값 처리

### 2. 보조 크롤러 (naverCafeBackfill.worker.js)

#### 안정성 강화:
- **postData null/undefined 검사 추가** (836줄 이후)
  - 유효하지 않은 postData 시 안전한 기본값 반환
  - 프로세스 중단 방지

- **타입 안전성 강화**
  - 모든 문자열 처리에 타입 검사 추가
  - null/undefined 방어 코드 추가

### 3. RawLog Processor (rawLogProcessor.worker.js)

#### 안정성 강화:
- **이슈 승격 실패 시 예외 처리 추가** (205줄)
  - try-catch 블록으로 전체 이슈 승격 프로세스 감싸기
  - 에러 발생 시에도 프로세스가 중단되지 않도록 보장

- **재시도 메커니즘**
  - 최대 5회까지 재시도
  - 실패 횟수에 따라 상태 관리 (PENDING → FAILED)

- **상세한 에러 로깅**
  - 모든 에러 상황을 로그에 기록
  - 디버깅 및 모니터링 용이

### 4. Issue 생성 서비스 (naverCafeIssues.service.js)

#### 안정성 강화:
- **입력 데이터 검증 추가** (301줄)
  - post 객체와 url의 유효성 검사
  - 잘못된 데이터로 인한 오류 사전 방지

- **기존 try-catch 유지**
  - 전체 함수가 try-catch로 감싸져 있음
  - 모든 예외 상황이 로그에 기록됨

## 핵심 원칙

1. **프로세스 중단 방지**: 어떤 에러가 발생해도 크롤러 프로세스가 중단되지 않도록 보장
2. **데이터 무결성**: 유효하지 않은 데이터는 스킵하되, 로그에 기록
3. **재시도 가능성**: 일시적인 에러는 재시도 가능하도록 상태 관리
4. **상세한 로깅**: 모든 에러 상황을 추적할 수 있도록 로그 기록

## 모니터링 포인트

- `[NaverCafeWorker] postData is invalid` - postData 누락 경고
- `[RawLogProcessor] Failed to promote RawLog to Issue (CRITICAL)` - 이슈 승격 실패
- `[NaverCafeIssues] Failed to upsert issue` - 이슈 생성/업데이트 실패

## 다음 단계

1. 실제 운영 환경에서 에러 로그 모니터링
2. 재시도 메커니즘 튜닝 (필요시)
3. 추가적인 안정성 강화 (필요시)




