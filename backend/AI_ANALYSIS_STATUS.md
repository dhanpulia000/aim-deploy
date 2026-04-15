# AI 내용 분석 기능 상태

## 현재 구현 상태

### ✅ 이미 구현된 기능

1. **AI 이슈 분류기** (`backend/services/aiIssueClassifier.js`)
   - OpenAI API (또는 호환 API) 사용
   - 게시글 내용을 카테고리로 자동 분류
   - 중요도(HIGH/MEDIUM/LOW) 자동 판단
   - 하이브리드 방식: AI 실패 시 규칙 기반으로 폴백

2. **적용 위치**
   - ✅ Naver Cafe 이슈 생성 시 (`naverCafeIssues.service.js`)
   - ✅ Excel 리포트 업로드 시 (`reports.service.js`)
   - ✅ 커뮤니티 스크래핑 데이터 임포트 시 (`articles.service.js`)

3. **RawLog → Issue 승격 시**
   - ✅ Naver Cafe RawLog: `upsertIssueFromNaverCafe`를 통해 AI 분류 적용됨
   - ⚠️ Discord RawLog: 현재 기본 Issue 생성만 수행 (AI 분류 미적용)

## AI 분류 동작 방식

### 1. 하이브리드 분류 시스템

```
RawLog → Issue 승격
  ↓
classifyIssueCategory() 호출
  ↓
1. AI 분류 시도 (classifyIssueWithAI)
   ├─ 성공 → AI 결과 사용
   └─ 실패 → 규칙 기반 분류로 폴백
  ↓
2. 규칙 기반 분류 (classifyIssueCategoryByRules)
   └─ 키워드 매칭으로 분류
```

### 2. AI 분류 프로세스

1. **카테고리 택소노미 로드**
   - DB에서 활성화된 카테고리 그룹/카테고리 조회
   - 프롬프트용 설명 텍스트 생성

2. **AI API 호출**
   - 모델: `gpt-4o-mini` (기본값, 환경변수로 변경 가능)
   - 입력: 게시글 제목 + 본문 + 댓글 스니펫 (최대 3000자)
   - 출력: JSON 형식 (카테고리, 중요도, 설명)

3. **결과 매핑**
   - AI가 반환한 카테고리 이름을 DB ID로 매핑
   - 정확한 매칭 실패 시 부분 매칭 시도

## 설정 방법

### 환경 변수 설정

`.env` 파일에 다음 변수 추가:

```env
# OpenAI API 설정
OPENAI_API_KEY=sk-...                    # OpenAI API 키 (필수)
OPENAI_BASE_URL=https://api.openai.com/v1  # API 엔드포인트 (선택, 기본값 사용)
OPENAI_MODEL=gpt-4o-mini                  # 사용할 모델 (선택, 기본: gpt-4o-mini)
```

### API 키 없을 때 동작

- AI 분류는 자동으로 비활성화됨
- 규칙 기반 분류로만 작동
- 에러 없이 정상 동작

## 현재 적용 상태

### ✅ 적용됨

1. **Naver Cafe 이슈**
   - `upsertIssueFromNaverCafe()` 함수에서 AI 분류 사용
   - 제목 + 본문 + 댓글 스니펫 분석
   - 카테고리 자동 분류 및 중요도 판단

2. **Excel 리포트**
   - 리포트 업로드 시 각 이슈에 AI 분류 적용
   - 프로젝트별 분류 규칙과 함께 사용

### ⚠️ 부분 적용

1. **Discord RawLog**
   - 현재 기본 Issue만 생성 (AI 분류 미적용)
   - 개선 가능: `rawLogProcessor.worker.js`에서 Discord RawLog 처리 시 AI 분류 추가

## 개선 가능한 부분

### 1. Discord RawLog에 AI 분류 적용

**현재 상태**:
```javascript
// rawLogProcessor.worker.js
// Discord는 기본 Issue만 생성
await prisma.reportItemIssue.create({
  data: {
    // ... 기본 필드만 설정
    severity: 3, // 고정값
    status: 'OPEN'
  }
});
```

**개선 방안**:
```javascript
// AI 분류 추가
const classification = await classifyIssueCategory({
  text: rawLog.content,
  prisma: prisma
});

await prisma.reportItemIssue.create({
  data: {
    // ... 기존 필드
    importance: classification.importance,
    categoryGroupId: classification.groupId,
    categoryId: classification.categoryId,
    severity: classification.importance === 'HIGH' ? 1 : 
              classification.importance === 'MEDIUM' ? 2 : 3
  }
});
```

### 2. 감정 분석 추가

**현재**: 감정 분석 없음 (기본값 'neu')

**개선 가능**:
- AI를 사용하여 긍정/부정/중립 감정 분석
- `sentiment` 필드에 자동 설정

### 3. 요약 생성

**현재**: `summary`는 제목 또는 처음 200자

**개선 가능**:
- AI를 사용하여 내용 요약 생성
- 핵심 내용만 추출하여 `summary`에 저장

## 비용 고려사항

### API 호출 비용

- **모델**: `gpt-4o-mini` (기본값)
  - 입력: ~$0.15 per 1M tokens
  - 출력: ~$0.60 per 1M tokens
- **예상 비용**: 이슈당 약 $0.001-0.002 (텍스트 길이에 따라 다름)

### 최적화 방안

1. **캐싱**: 동일한 내용은 캐시 사용
2. **배치 처리**: 여러 이슈를 한 번에 처리
3. **텍스트 길이 제한**: 3000자로 제한 (현재 적용됨)
4. **폴백 활용**: AI 실패 시 규칙 기반으로 자동 전환

## 테스트 방법

### 1. API 키 설정 확인

```bash
# .env 파일 확인
cat backend/.env | grep OPENAI
```

### 2. 로그 확인

```bash
# AI 분류 성공 로그
grep "AIClassifier.*Classification successful" backend/logs/*.log

# AI 분류 실패 로그 (폴백)
grep "AIClassifier.*AI classification failed" backend/logs/*.log
```

### 3. 수동 테스트

```javascript
// Node.js 콘솔에서
const { classifyIssueWithAI } = require('./services/aiIssueClassifier');

const result = await classifyIssueWithAI({
  text: '게임 실행 중 크래시가 발생했습니다. 재부팅해도 계속 발생합니다.'
});

console.log(result);
// 예상 출력:
// {
//   importance: 'HIGH',
//   groupId: 1,
//   categoryId: 1,
//   reason: '게임 크래시는 중요한 성능 문제입니다'
// }
```

## 결론

### ✅ 적용 가능 여부: **이미 적용됨**

1. **AI 분류 기능**: ✅ 구현 완료
2. **Naver Cafe**: ✅ 적용 중
3. **Discord**: ⚠️ 부분 적용 (개선 가능)
4. **폴백 시스템**: ✅ 규칙 기반으로 안전하게 작동

### 다음 단계

1. **환경 변수 설정**: `OPENAI_API_KEY` 추가
2. **Discord RawLog 개선**: AI 분류 적용
3. **모니터링**: 로그를 통해 AI 분류 성공률 확인
4. **비용 모니터링**: API 사용량 추적




















