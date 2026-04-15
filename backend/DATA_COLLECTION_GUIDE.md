# 수집 데이터 가이드

## 개요

모니터링 워커들이 수집하는 데이터의 구조와 필드를 설명합니다.

## RawLog 테이블 구조

### 기본 필드

| 필드명 | 타입 | 설명 |
|--------|------|------|
| `id` | String (CUID) | 고유 식별자 |
| `source` | String | 데이터 소스 ('naver', 'discord', 'system') |
| `content` | String | 원본 내용 (제목 + 본문 또는 메시지 내용) |
| `author` | String? | 작성자 (선택) |
| `timestamp` | DateTime | 원본 게시/메시지 시간 |
| `isProcessed` | Boolean | 이슈로 승격되었는지 여부 (기본: false) |
| `metadata` | String? | 추가 메타데이터 (JSON 문자열) |
| `createdAt` | DateTime | RawLog 생성 시간 |
| `updatedAt` | DateTime | 마지막 업데이트 시간 |

---

## 1. Naver Cafe 데이터

### 수집 과정

1. **게시판 목록 스캔**
   - `MonitoredBoard` 테이블의 활성화된 게시판을 주기적으로 스캔
   - 게시판 목록 페이지에서 게시글 링크, 제목, 작성자, 날짜 추출

2. **게시글 상세 페이지 접근**
   - 각 게시글의 상세 페이지로 이동
   - 제목, 본문, 작성자, 날짜 추출

3. **키워드 필터링**
   - `MonitoringKeyword` 테이블에서 `type='naver'` 키워드 로드
   - 제목 + 본문에 키워드가 포함된 경우만 수집

4. **RawLog 저장**

### RawLog 필드 (Naver Cafe)

#### 기본 필드
- **source**: `'naver'`
- **content**: `제목\n\n본문` 형식으로 저장
- **author**: 게시글 작성자 닉네임
- **timestamp**: 게시글 작성 시간 (파싱된 DateTime)

#### metadata (JSON 문자열)
```json
{
  "url": "https://cafe.naver.com/...",
  "title": "게시글 제목",
  "externalPostId": "12345678",
  "cafeGame": "PUBG_PC" | "PUBG_MOBILE",
  "monitoredBoardId": 1
}
```

#### 수집되는 정보 예시
```
제목: "게임 크래시 발생"
본문: "게임 실행 중 갑자기 크래시가 발생했습니다..."
작성자: "사용자123"
작성시간: "2025-11-25 14:30:00"
URL: "https://cafe.naver.com/pubgpc/12345678"
```

---

## 2. Discord 데이터

### 수집 과정

1. **Discord 봇 연결**
   - Discord.js를 사용하여 Discord 서버에 연결
   - 설정된 채널에서 메시지 수신

2. **메시지 필터링**
   - 봇 메시지는 무시
   - `DISCORD_CHANNEL_IDS`가 설정된 경우 해당 채널만 모니터링
   - `MonitoringKeyword` 테이블에서 `type='discord'` 키워드 로드
   - 메시지 내용에 키워드가 포함된 경우만 수집

3. **RawLog 저장**

### RawLog 필드 (Discord)

#### 기본 필드
- **source**: `'discord'`
- **content**: 메시지 내용 + 첨부파일 URL
- **author**: 메시지 작성자 (username 또는 tag)
- **timestamp**: 메시지 생성 시간

#### metadata (JSON 문자열)
```json
{
  "channelId": "123456789012345678",
  "channelName": "general",
  "messageId": "987654321098765432",
  "guildId": "111111111111111111",
  "url": "https://discord.com/channels/..."
}
```

#### 수집되는 정보 예시
```
메시지: "버그 리포트: 게임이 자꾸 튕겨요"
작성자: "User#1234"
채널: "general"
시간: "2025-11-25 14:30:00"
URL: "https://discord.com/channels/..."
```

---

## 3. 데이터 변환 (RawLog → Issue)

### RawLog 프로세서 워커

`rawLogProcessor.worker.js`가 30초마다 실행되어:

1. `isProcessed=false`인 RawLog 조회
2. 소스별로 Issue로 변환:
   - **Naver Cafe**: `upsertIssueFromNaverCafe()` 사용
   - **Discord**: 기본 Issue 생성
3. `isProcessed=true`로 업데이트

### 변환된 Issue 필드

#### Naver Cafe → Issue
- `summary`: 게시글 제목
- `detail`: 게시글 본문
- `source`: 'naver'
- `sourceUrl`: 원본 게시글 URL
- `externalPostId`: Naver Cafe article ID
- `externalSource`: 'NAVER_CAFE_PUBG_PC' 또는 'NAVER_CAFE_PUBG_MOBILE'
- `monitoredBoardId`: 모니터링된 게시판 ID
- 카테고리 자동 분류 적용

#### Discord → Issue
- `summary`: 메시지 내용 (처음 200자)
- `detail`: 전체 메시지 내용
- `source`: 'discord'
- `link`: Discord 메시지 URL
- `severity`: 3 (기본값)
- `status`: 'OPEN'

---

## 데이터 확인 방법

### 1. 모니터링 제어 페이지

**경로**: `/admin/monitoring` → "최근 로그" 탭

- 최근 50개의 RawLog 확인
- 소스, 작성자, 내용, 처리 상태, 수집 시간 표시

### 2. API 엔드포인트

#### RawLog 조회
```http
GET /api/monitoring/logs?limit=50&offset=0&source=naver&isProcessed=false
```

**응답 예시**:
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "clx123...",
        "source": "naver",
        "content": "게시글 제목\n\n게시글 본문...",
        "author": "사용자123",
        "timestamp": "2025-11-25T14:30:00.000Z",
        "isProcessed": false,
        "metadata": "{\"url\":\"...\",\"title\":\"...\",\"externalPostId\":\"12345678\",\"cafeGame\":\"PUBG_PC\",\"monitoredBoardId\":1}",
        "createdAt": "2025-11-25T14:35:00.000Z"
      }
    ],
    "total": 10,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

#### Issue 조회
```http
GET /api/issues?limit=100&source=naver
```

### 3. 데이터베이스 직접 조회

#### RawLog 조회
```sql
SELECT 
  id,
  source,
  SUBSTR(content, 1, 100) as content_preview,
  author,
  timestamp,
  isProcessed,
  createdAt
FROM RawLog
ORDER BY createdAt DESC
LIMIT 10;
```

#### Issue 조회 (RawLog에서 변환된 것)
```sql
SELECT 
  id,
  summary,
  source,
  sourceUrl,
  externalPostId,
  createdAt
FROM ReportItemIssue
WHERE source IN ('naver', 'discord')
ORDER BY createdAt DESC
LIMIT 10;
```

---

## 데이터 흐름 요약

```
1. 크롤링 워커 (Naver Cafe / Discord)
   ↓
2. 키워드 필터링
   ↓
3. RawLog 저장 (isProcessed=false)
   ↓
4. RawLog 프로세서 워커 (30초마다)
   ↓
5. Issue 생성 (isProcessed=true)
   ↓
6. 프론트엔드 이슈 큐 표시
```

---

## 주의사항

1. **키워드가 없으면**: 모든 내용이 수집됩니다
2. **중복 방지**: `externalPostId`와 `sourceUrl`로 중복 체크
3. **처리 상태**: `isProcessed=false`는 아직 Issue로 변환되지 않은 RawLog
4. **메타데이터**: JSON 문자열이므로 파싱 필요

---

## 예시 데이터

### Naver Cafe RawLog 예시

```json
{
  "id": "clx1234567890",
  "source": "naver",
  "content": "게임 크래시 발생\n\n게임 실행 중 갑자기 크래시가 발생했습니다. 재부팅해도 계속 발생합니다.",
  "author": "사용자123",
  "timestamp": "2025-11-25T14:30:00.000Z",
  "isProcessed": false,
  "metadata": "{\"url\":\"https://cafe.naver.com/pubgpc/12345678\",\"title\":\"게임 크래시 발생\",\"externalPostId\":\"12345678\",\"cafeGame\":\"PUBG_PC\",\"monitoredBoardId\":1}",
  "createdAt": "2025-11-25T14:35:00.000Z"
}
```

### Discord RawLog 예시

```json
{
  "id": "clx9876543210",
  "source": "discord",
  "content": "버그 리포트: 게임이 자꾸 튕겨요\nhttps://example.com/image.png",
  "author": "User#1234",
  "timestamp": "2025-11-25T14:30:00.000Z",
  "isProcessed": false,
  "metadata": "{\"channelId\":\"123456789012345678\",\"channelName\":\"general\",\"messageId\":\"987654321098765432\",\"guildId\":\"111111111111111111\",\"url\":\"https://discord.com/channels/...\"}",
  "createdAt": "2025-11-25T14:35:00.000Z"
}
```




















