# 크롤러 본문 수집 로직 점검 결과

## 발견된 문제

### 1. 메인 크롤러 (naverCafe.worker.js)

**문제:**
- 로그인 팝업이 감지되면 `requiresLogin = true`로 설정됨
- `requiresLogin = true`일 때 aggressive fallback이 실행되지 않음 (2304줄)
- 본문 추출이 실패하거나 빈 문자열이면 그대로 저장됨

**수정 내용:**
- aggressive fallback이 `requiresLogin` 상태와 관계없이 실행되도록 수정
- 본문이 추출되면 `requiresLogin`을 `false`로 재설정하도록 개선

### 2. 보조 크롤러 (naverCafeBackfill.worker.js)

**문제:**
- aggressive fallback 로직이 없음
- 본문 추출 실패 시 재시도 없음

**수정 내용:**
- aggressive fallback 로직 추가
- 본문 추출 성공 시 `requiresLogin` 재평가 로직 추가

### 3. RawLog Processor (rawLogProcessor.worker.js)

**문제:**
- 로그인 필요 게시글일 때 제목을 본문으로 사용
- 이후 `requiresLogin`이 `false`로 수정되어도 본문은 이미 제목으로 설정됨

**수정 내용:**
- 로그인 필요 게시글도 본문을 빈 문자열로 유지 (제목을 본문으로 사용하지 않음)

### 4. Issue 생성 서비스 (naverCafeIssues.service.js)

**이미 수정됨:**
- `detail`이 `summary`와 동일하면 `detail`을 비우는 로직 추가 (557-562줄)

## 테스트 결과

### 실제 게시글 테스트
- URL: https://cafe.naver.com/f-e/cafes/29359582/articles/2271332
- 테스트 스크립트: **본문 추출 성공** (510자)
- 크롤러 실행 시: **본문 0자** (실패)

### 원인 분석
1. 로그인 팝업이 잘못 감지됨 (`requiresLogin = true`)
2. aggressive fallback이 실행되지 않음
3. 본문 추출 실패로 0자 저장

## 수정 사항 요약

### ✅ 수정 완료

1. **naverCafe.worker.js**
   - aggressive fallback이 `requiresLogin` 상태와 관계없이 실행되도록 수정
   - 본문 추출 성공 시 `requiresLogin` 재평가 로직 개선
   - 제목을 본문으로 사용하지 않도록 수정

2. **naverCafeBackfill.worker.js**
   - aggressive fallback 로직 추가
   - 본문 추출 성공 시 `requiresLogin` 재평가 로직 추가

3. **rawLogProcessor.worker.js**
   - 로그인 필요 게시글도 본문을 빈 문자열로 유지

4. **naverCafeIssues.service.js**
   - `detail`이 `summary`와 동일하면 `detail`을 비우는 로직 (이미 적용됨)

## 다음 단계

1. 크롤러 재시작 후 테스트
2. 최근 수집된 게시글의 본문 추출 성공률 확인
3. 필요 시 추가 최적화




