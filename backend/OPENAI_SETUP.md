# OpenAI API 키 설정 가이드

## 설정 방법

### 1. OpenAI API 키 발급

1. [OpenAI Platform](https://platform.openai.com/) 접속
2. 로그인 또는 계정 생성
3. API Keys 메뉴로 이동
4. "Create new secret key" 클릭
5. 키 이름 입력 후 생성
6. **생성된 키를 복사** (한 번만 표시되므로 안전하게 보관)

### 2. .env 파일에 추가

`backend/.env` 파일을 열고 다음 내용을 추가하세요:

```env
# OpenAI API 설정
OPENAI_API_KEY=sk-...                    # 여기에 실제 API 키 입력
OPENAI_BASE_URL=https://api.openai.com/v1  # 기본값 (변경 불필요)
OPENAI_MODEL=gpt-4o-mini                  # 기본값 (변경 불필요)
```

### 3. API 키 형식

- OpenAI: `sk-...`로 시작
- 예: `sk-proj-abc123def456...`

### 4. 서버 재시작

API 키를 설정한 후 백엔드 서버를 재시작하세요:

```bash
cd backend
npm start
```

## 모델 선택

### 기본 모델: `gpt-4o-mini`

- **장점**: 빠르고 저렴
- **비용**: 입력 ~$0.15/1M tokens, 출력 ~$0.60/1M tokens
- **용도**: 이슈 분류에 적합

### 다른 모델 옵션

`.env` 파일에서 `OPENAI_MODEL` 변경:

```env
# 더 정확한 분류를 원하는 경우
OPENAI_MODEL=gpt-4o

# 더 빠른 처리를 원하는 경우
OPENAI_MODEL=gpt-3.5-turbo
```

## 비용 예상

### 예상 비용 (gpt-4o-mini 기준)

- **이슈당**: 약 $0.001-0.002
- **월 1000개 이슈**: 약 $1-2
- **월 10000개 이슈**: 약 $10-20

### 비용 절감 방법

1. **텍스트 길이 제한**: 현재 3000자로 제한됨
2. **폴백 활용**: AI 실패 시 규칙 기반으로 자동 전환
3. **캐싱**: 동일한 내용은 캐시 사용 (향후 구현 가능)

## 확인 방법

### 1. 로그 확인

서버 로그에서 다음 메시지 확인:

```
[AIClassifier] Classification successful
```

또는

```
[AIClassifier] AI API key not configured, skipping AI classification
```

### 2. API 테스트

브라우저 콘솔 또는 Postman에서:

```javascript
// 이슈 생성 후 카테고리 확인
fetch('/api/issues?limit=1')
  .then(res => res.json())
  .then(data => {
    const issue = data.data.issues[0];
    console.log('Category:', issue.categoryGroup?.name, issue.category?.name);
    console.log('Importance:', issue.importance);
  });
```

### 3. 수동 테스트

Node.js 콘솔에서:

```javascript
const { classifyIssueWithAI } = require('./services/aiIssueClassifier');

const result = await classifyIssueWithAI({
  text: '게임 실행 중 크래시가 발생했습니다.'
});

console.log(result);
```

## 문제 해결

### API 키가 인식되지 않는 경우

1. `.env` 파일 위치 확인: `backend/.env`
2. 서버 재시작 확인
3. 환경 변수 형식 확인: 따옴표 없이 입력
   ```env
   OPENAI_API_KEY=sk-...  # ✅ 올바름
   OPENAI_API_KEY="sk-..."  # ❌ 따옴표 제거
   ```

### API 호출 실패

1. **인터넷 연결 확인**
2. **API 키 유효성 확인**: [OpenAI Platform](https://platform.openai.com/api-keys)에서 확인
3. **크레딧 확인**: OpenAI 계정에 충분한 크레딧이 있는지 확인
4. **Rate Limit**: 너무 많은 요청 시 일시적으로 실패할 수 있음

### AI 분류가 작동하지 않는 경우

1. **로그 확인**: `[AIClassifier]` 태그로 검색
2. **폴백 확인**: 규칙 기반 분류로 자동 전환되는지 확인
3. **API 키 확인**: 환경 변수가 제대로 로드되었는지 확인

## 보안 주의사항

⚠️ **중요**: `.env` 파일은 절대 Git에 커밋하지 마세요!

- `.env`는 `.gitignore`에 포함되어 있어야 함
- API 키는 절대 공개 저장소에 업로드하지 않음
- 프로덕션 환경에서는 환경 변수 관리 시스템 사용 권장

## 참고

- [OpenAI API 문서](https://platform.openai.com/docs)
- [OpenAI 가격 정보](https://openai.com/api/pricing/)
- [Prisma 환경 변수](https://www.prisma.io/docs/guides/development-environment/environment-variables)




















