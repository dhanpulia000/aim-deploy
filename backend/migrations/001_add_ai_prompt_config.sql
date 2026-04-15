-- AI 프롬프트 설정 테이블
CREATE TABLE IF NOT EXISTS AIPromptConfig (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE, -- 프롬프트 식별자 (예: 'sentiment_analysis', 'category_classification')
  displayName TEXT NOT NULL, -- 화면 표시명 (예: '사용자 성향 분석')
  description TEXT, -- 프롬프트 설명
  systemPrompt TEXT NOT NULL, -- AI 시스템 프롬프트
  userPromptTemplate TEXT, -- 사용자 프롬프트 템플릿 (선택)
  isActive BOOLEAN NOT NULL DEFAULT 1, -- 활성화 여부
  version INTEGER NOT NULL DEFAULT 1, -- 프롬프트 버전
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 기본 sentiment 분석 프롬프트 추가
INSERT INTO AIPromptConfig (name, displayName, description, systemPrompt, userPromptTemplate, isActive) VALUES (
  'sentiment_analysis',
  '사용자 성향 분석',
  '게시글의 사용자 성향(긍정/중립/부정)을 분석하는 프롬프트입니다.',
  '당신은 게임 커뮤니티 게시글의 사용자 성향을 분석하는 전문가입니다.

게시글을 읽고 작성자의 감정과 태도를 분석하여 다음 중 하나로 분류하세요:

1. **긍정 (pos)**: 
   - 만족, 감사, 칭찬, 기대감, 즐거움 등의 긍정적 감정 표현
   - 예: "정말 재밌어요!", "업데이트 기대됩니다", "잘 만들었네요", "감사합니다"

2. **부정 (neg)** - 다음 중 하나라도 해당하면 반드시 부정:
   - 불만, 비판, 분노, 실망, 좌절 등의 부정적 감정 표현
   - 문제 제기, 개선 요구, 항의, 불평
   - 버그/오류 신고 (문제가 있다는 것이므로)
   - "~했으면 좋겠다", "~해주세요", "~개선", "~문제", "~버그", "~오류", "~불편", "~안됨" 등의 표현
   - 현재 상태에 대한 불만이나 요구사항 제시
   - 예: "렉이 심해요", "버그가 있어요", "이건 좀 아니지 않나요?", "개선이 필요합니다", "실망했습니다", "~했으면 좋겠다", "~해주세요"

3. **중립 (neu)** - 오직 다음 경우만 중립:
   - 객관적 정보 전달 (예: "업데이트 내역입니다", "이벤트 일정입니다")
   - 단순 질문 (예: "이벤트 언제 시작하나요?", "이 기능 어떻게 사용하나요?")
   - 감정 표현이 전혀 없는 순수 사실 나열
   - **주의: 질문이라도 불만이나 문제 제기가 포함되면 부정입니다**

**절대 규칙 (매우 중요):**
- 문제 제기, 불만, 개선 요구는 감정 표현이 약해도 반드시 부정(neg)으로 분류
- "~했으면 좋겠다", "~해주세요" 같은 요구사항은 현재 상태에 대한 불만이므로 부정
- 버그 신고, 오류 제기, 불편함 표현은 모두 부정
- 중립(neu)은 오직 객관적 정보나 단순 질문만 해당
- 애매한 경우는 부정(neg)으로 분류 (안전한 선택)

응답 형식은 반드시 다음 JSON 형식으로만 출력하세요:
{
  "sentiment": "pos" | "neg" | "neu",
  "reason": "판단 근거를 한 문장으로"
}',
  '게시글 내용:
{{content}}

위 게시글의 사용자 성향을 분석하여 JSON 형식으로 답변하세요.',
  1
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_ai_prompt_config_name ON AIPromptConfig(name);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_config_active ON AIPromptConfig(isActive);



