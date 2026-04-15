# RAG 환경 구축 및 AI 챗봇 기능 구현 가능성 검토

## 📋 검토 개요

PostgreSQL + pgvector를 활용한 RAG(Retrieval-Augmented Generation) 환경 구축 및 유형별 업무 가이드를 데이터화하여 AI 챗봇으로 에이전트들에게 도움을 주는 기능 추가 가능성 검토

## ✅ 현재 시스템 상태

### 1. 인프라 준비 상태

#### ✅ 이미 구현된 기능
- **PostgreSQL + pgvector 연결 코드**: `backend/libs/db-postgres.js`
- **벡터 검색 서비스**: `backend/services/vectorSearch.service.js`
- **임베딩 생성 서비스**: `backend/services/embedding.service.js`
- **벡터 검색 API**: `backend/controllers/vectorSearch.controller.js`
- **API 라우트**: `/api/vector-search`, `/api/vector-search/embed`, `/api/vector-search/status`

#### ⚠️ 설정 필요
- **PostgreSQL 연결**: `PG_VECTOR_URL` 환경 변수 설정 필요
- **pgvector 확장**: PostgreSQL에 `vector` 확장 설치 필요

### 2. 기존 데이터 구조

#### ✅ 카테고리 시스템
- `CategoryGroup`: 카테고리 그룹 (예: "게임플레이", "불법프로그램", "커뮤니티")
- `Category`: 세부 카테고리 (예: "버그/오류", "계정도용", "이벤트")
- 이슈 분류에 사용 중

#### ✅ 에이전트 매뉴얼
- `public/agent-manual.html`: HTML 형식의 매뉴얼 존재
- 이슈 처리 방법, 분류 기준 등 상세 가이드 포함

## 🎯 구현 가능성 분석

### ✅ **구현 가능** - 높은 가능성

현재 시스템은 RAG 환경 구축에 필요한 대부분의 인프라가 이미 준비되어 있습니다.

### 필요한 작업

#### 1. PostgreSQL + pgvector 설정 (1-2시간)
```bash
# 환경 변수 설정
PG_VECTOR_URL=postgresql://user:password@localhost:5432/vector_db

# PostgreSQL에 pgvector 확장 설치
CREATE EXTENSION vector;
```

#### 2. 업무 가이드 데이터베이스 설계 (2-3시간)

**새로운 테이블 구조:**
```sql
-- 업무 가이드 메타데이터 (SQLite)
CREATE TABLE IF NOT EXISTS WorkGuide (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  categoryGroupId INTEGER,
  categoryId INTEGER,
  guideType TEXT, -- 'classification', 'handling', 'escalation', 'general'
  priority INTEGER DEFAULT 0,
  tags TEXT, -- JSON array
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (categoryGroupId) REFERENCES CategoryGroup(id),
  FOREIGN KEY (categoryId) REFERENCES Category(id)
);

-- 업무 가이드 벡터 임베딩 (PostgreSQL)
CREATE TABLE IF NOT EXISTS guide_embeddings (
  id TEXT PRIMARY KEY,
  guide_id TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guide_id)
);
```

#### 3. 업무 가이드 데이터 수집 및 임베딩 (4-6시간)

**데이터 소스:**
- `agent-manual.html` 파싱
- 카테고리별 처리 가이드
- 이슈 유형별 대응 방법
- 에스컬레이션 기준

**임베딩 생성:**
- 기존 `embedding.service.js` 활용
- 가이드별로 청크 단위로 분할하여 임베딩 생성
- PostgreSQL에 저장

#### 4. RAG 기반 챗봇 API 구현 (6-8시간)

**새로운 API 엔드포인트:**
```javascript
// POST /api/chat/ask
// Body: { question: string, context?: { categoryId?, issueId? } }
// Response: { answer: string, sources: Array<{guideId, title, relevance}> }
```

**구현 로직:**
1. 사용자 질문을 벡터 임베딩으로 변환
2. 유사한 가이드 검색 (벡터 유사도)
3. 컨텍스트 필터링 (카테고리, 이슈 유형 등)
4. 검색된 가이드를 컨텍스트로 OpenAI API 호출
5. 응답 생성 및 소스 가이드 반환

#### 5. 챗봇 UI 컴포넌트 구현 (8-10시간)

**새로운 컴포넌트:**
- `src/components/ChatBot.tsx`: 챗봇 인터페이스
- `src/pages/Agent/AgentAssistant.tsx`: 에이전트 어시스턴트 페이지
- 이슈 상세 페이지에 통합 가능

**기능:**
- 실시간 채팅 인터페이스
- 컨텍스트 인식 (현재 보고 있는 이슈 정보 활용)
- 가이드 소스 표시
- 카테고리별 필터링

#### 6. 유형별 가이드 관리 UI (6-8시간)

**관리자 페이지:**
- 가이드 CRUD 기능
- 카테고리별 분류
- 임베딩 재생성 기능
- 가이드 검색 및 미리보기

## 📊 예상 작업 시간

| 작업 | 예상 시간 | 우선순위 |
|------|----------|----------|
| PostgreSQL + pgvector 설정 | 1-2시간 | 높음 |
| 데이터베이스 설계 | 2-3시간 | 높음 |
| 가이드 데이터 수집 및 임베딩 | 4-6시간 | 높음 |
| RAG 챗봇 API 구현 | 6-8시간 | 높음 |
| 챗봇 UI 구현 | 8-10시간 | 중간 |
| 가이드 관리 UI | 6-8시간 | 낮음 |
| **총 예상 시간** | **27-37시간** | - |

## 🎨 구현 예시

### 1. 챗봇 API 예시

```javascript
// POST /api/chat/ask
{
  "question": "계정 도용 이슈는 어떻게 처리하나요?",
  "context": {
    "categoryId": 42,
    "issueId": "abc123"
  }
}

// Response
{
  "success": true,
  "data": {
    "answer": "계정 도용 이슈는 다음과 같이 처리합니다:\n1. 즉시 계정 잠금 처리\n2. 사용자에게 2차 비밀번호 설정 안내\n3. ...",
    "sources": [
      {
        "guideId": "guide_001",
        "title": "계정 도용 처리 가이드",
        "relevance": 0.95,
        "excerpt": "..."
      }
    ]
  }
}
```

### 2. 챗봇 UI 예시

```tsx
<ChatBot
  context={{
    issueId: currentIssue?.id,
    categoryId: currentIssue?.categoryId,
    categoryGroupId: currentIssue?.categoryGroupId
  }}
  onGuideSelect={(guideId) => {
    // 가이드 상세 보기
  }}
/>
```

## 🔧 기술 스택 활용

### 기존 기술 스택 재사용
- ✅ **OpenAI API**: 이미 사용 중 (분류, 감정 분석)
- ✅ **PostgreSQL + pgvector**: 코드 구현 완료
- ✅ **벡터 검색**: 서비스 구현 완료
- ✅ **임베딩 생성**: 서비스 구현 완료
- ✅ **React + TypeScript**: 프론트엔드 프레임워크

### 추가 필요 기술
- **OpenAI Chat API**: GPT-4 또는 GPT-3.5-turbo 사용
- **청크 분할**: 긴 가이드를 의미 단위로 분할
- **컨텍스트 관리**: 대화 히스토리 관리

## ⚠️ 고려사항

### 1. 비용
- **임베딩 생성**: 가이드 수에 따라 초기 비용 발생
- **챗봇 API**: 사용량에 따라 비용 발생 (GPT-3.5-turbo 권장)

### 2. 성능
- 벡터 검색 인덱스 최적화 필요
- 캐싱 전략 고려 (자주 묻는 질문)

### 3. 데이터 품질
- 가이드 내용의 정확성 및 최신성 유지
- 정기적인 업데이트 프로세스 필요

### 4. 보안
- 에이전트 권한별 접근 제어
- 민감 정보 필터링

## 🚀 구현 단계 제안

### Phase 1: 인프라 설정 (1주)
1. PostgreSQL + pgvector 설정
2. 데이터베이스 스키마 설계 및 생성
3. 가이드 데이터 수집 및 임베딩

### Phase 2: 백엔드 구현 (1주)
1. RAG 챗봇 API 구현
2. 가이드 관리 API 구현
3. 테스트 및 최적화

### Phase 3: 프론트엔드 구현 (1주)
1. 챗봇 UI 컴포넌트 구현
2. 가이드 관리 UI 구현
3. 통합 및 테스트

### Phase 4: 배포 및 모니터링 (3일)
1. 프로덕션 배포
2. 사용자 피드백 수집
3. 성능 모니터링

## ✅ 결론

**구현 가능성: 매우 높음 (95%)**

현재 시스템은 RAG 환경 구축에 필요한 대부분의 인프라가 이미 준비되어 있습니다. 
PostgreSQL + pgvector 설정만 완료하면 바로 구현을 시작할 수 있습니다.

**추천 사항:**
1. 먼저 PostgreSQL + pgvector 환경 설정
2. 소규모 프로토타입으로 개념 검증
3. 점진적으로 기능 확장

**예상 개발 기간: 3-4주**
