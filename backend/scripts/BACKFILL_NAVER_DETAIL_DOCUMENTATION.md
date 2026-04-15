# Backfill Naver Detail 기능 상세 문서

## 목차
1. [개요](#개요)
2. [시스템 아키텍처](#시스템-아키텍처)
3. [기능 상세 분석](#기능-상세-분석)
4. [코드 구현 현황](#코드-구현-현황)
5. [오류 분석 및 개선 사항](#오류-분석-및-개선-사항)
6. [최적화 제안](#최적화-제안)
7. [데이터 흐름](#데이터-흐름)
8. [참고 자료](#참고-자료)

---

## 개요

### 목적
`backfill-naver-detail` 스크립트는 Naver 카페 크롤링 과정에서 본문 내용이 `[이미지/미디어 포함]`으로만 저장된 이슈들의 `detail` 필드를 `RawLog` 테이블에 저장된 실제 본문 내용으로 복원하는 기능을 제공합니다.

### 배경
- 네이버 카페 크롤링 중 이미지/미디어가 포함된 게시글의 경우 본문 추출이 실패하여 플레이스홀더 텍스트로 저장됨
- `RawLog` 테이블에는 크롤링 당시의 원본 데이터가 보관되어 있음
- `ReportItemIssue`와 `RawLog`를 `externalPostId` 또는 `sourceUrl`로 매칭하여 본문 복원 가능

### 구현 버전
1. **JavaScript 버전**: `scripts/backfill-naver-detail.js` (메인 버전)
2. **Python 버전**: `scripts/backfill-naver-detail.ipynb` (분석/테스트용)

---

## 시스템 아키텍처

### 데이터베이스 스키마

#### ReportItemIssue 테이블
```sql
CREATE TABLE ReportItemIssue (
  id              TEXT PRIMARY KEY,
  detail          TEXT,           -- 복원 대상 필드
  summary         TEXT,
  externalPostId  TEXT,           -- RawLog 매칭 키 1
  sourceUrl       TEXT,           -- RawLog 매칭 키 2
  createdAt       DATETIME,
  updatedAt       DATETIME,
  -- ... 기타 필드
);
```

#### RawLog 테이블
```sql
CREATE TABLE RawLog (
  id          TEXT PRIMARY KEY,
  source      TEXT,           -- 'naver'
  content     TEXT,           -- 실제 본문 내용
  metadata    TEXT,           -- JSON: {externalPostId, url, ...}
  createdAt   DATETIME,
  -- ... 기타 필드
);
```

### 데이터 관계
```
RawLog (원본 데이터)
  ├─ metadata.externalPostId → ReportItemIssue.externalPostId
  └─ metadata.url → ReportItemIssue.sourceUrl
     ↓
ReportItemIssue.detail 업데이트
```

---

## 기능 상세 분석

### 1. 대상 이슈 조회

#### JavaScript 버전
```javascript
const issues = query(
  `SELECT id, summary, detail, externalPostId, sourceUrl, date, createdAt
   FROM ReportItemIssue
   WHERE detail = '[이미지/미디어 포함]'
     AND date >= ?
   ORDER BY createdAt DESC`,
  [sinceDate]  // 최근 N일
);
```

**특징**:
- 날짜 기반 필터링 (최근 N일)
- 명령행 인자로 일수 지정 가능 (`node scripts/backfill-naver-detail.js 3`)

#### Python 버전
```python
N = 100
cur.execute("""
SELECT id, summary, detail, externalPostId, sourceUrl
FROM ReportItemIssue
WHERE detail = '[이미지/미디어 포함]'
ORDER BY createdAt DESC
LIMIT ?
""", (N,))
```

**특징**:
- 개수 기반 제한 (최근 N개)
- 날짜 필터링 없음

### 2. RawLog 매칭 로직

#### 매칭 알고리즘

1. **검색 키 생성**
   ```python
   search_keys = []
   if external_post_id:
       search_keys.append(str(external_post_id))
   if source_url:
       search_keys.append(str(source_url))
   ```

2. **RawLog 조회 (LIKE 검색)**
   ```sql
   SELECT id, content, metadata, createdAt
   FROM RawLog
   WHERE source = 'naver'
     AND metadata LIKE ?
   ORDER BY createdAt DESC
   LIMIT 5
   ```

3. **정확한 매칭 검증**
   ```python
   meta = json.loads(candidate["metadata"])
   meta_post_id = meta.get("externalPostId")
   meta_url = meta.get("url")
   
   # externalPostId 매칭
   if (external_post_id and meta_post_id and 
       str(meta_post_id) == str(external_post_id)):
       matched_raw = candidate
       break
   # sourceUrl 매칭
   elif (source_url and meta_url and 
         str(meta_url) == str(source_url)):
       matched_raw = candidate
       break
   ```

**매칭 전략**:
- LIKE 검색으로 후보 추출 (성능 최적화)
- JSON 파싱 후 정확한 값 비교로 검증
- 여러 후보 중 가장 최근 것 선택 (ORDER BY createdAt DESC)

### 3. 본문 업데이트

#### 검증 로직
```python
raw_content = (matched_raw["content"] or "").strip()
if not raw_content or raw_content == '[이미지/미디어 포함]':
    # 유효하지 않은 본문은 스킵
    skipped_no_content += 1
    continue
```

#### 업데이트 실행

**JavaScript 버전**:
```javascript
execute(
  'UPDATE ReportItemIssue SET detail = ?, updatedAt = datetime(\'now\') WHERE id = ?',
  [rawContent, id]
);
```

**Python 버전**:
```python
cur.execute(
  "UPDATE ReportItemIssue SET detail = ?, updatedAt = ? WHERE id = ?",
  (raw_content, datetime.utcnow().isoformat(), issue_id)
)
conn.commit()  # 모든 업데이트 후 일괄 커밋
```

---

## 코드 구현 현황

### JavaScript 버전 (`backfill-naver-detail.js`)

```1:132:backend/scripts/backfill-naver-detail.js
const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

/**
 * [이미지/미디어 포함] 으로 저장된 Naver 이슈들의 detail을 RawLog 기반으로 복원하는 스크립트
 *
 * 사용법:
 *   node scripts/backfill-naver-detail.js 3   // 최근 3일
 */

async function main() {
  const days = Number(process.argv[2] || '3');
  if (Number.isNaN(days) || days <= 0) {
    console.log('❌ 일수는 1 이상의 숫자여야 합니다.');
    process.exit(1);
  }

  const now = new Date();
  const sinceDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]; // YYYY-MM-DD

  console.log(`🛠  최근 ${days}일(${sinceDate} ~ 오늘) 동안의 이슈 중 [이미지/미디어 포함] 본문을 복원합니다.`);

  try {
    const issues = query(
      `
      SELECT id, summary, detail, externalPostId, sourceUrl, date, createdAt
      FROM ReportItemIssue
      WHERE detail = '[이미지/미디어 포함]'
        AND date >= ?
      ORDER BY createdAt DESC
      `,
      [sinceDate]
    );

    console.log(`대상 이슈 수: ${issues.length}`);
    if (issues.length === 0) {
      console.log('✅ 업데이트할 이슈가 없습니다.');
      process.exit(0);
    }

    let updated = 0;
    let skippedNoRaw = 0;
    let skippedNoContent = 0;

    for (const issue of issues) {
      const { id, summary, externalPostId, sourceUrl } = issue;
      console.log(`\n▶ 이슈 처리: ${id} | ${summary?.substring(0, 40) || ''}`);

      const searchKeys = [];
      if (externalPostId) searchKeys.push(String(externalPostId));
      if (sourceUrl) searchKeys.push(String(sourceUrl));

      let matchedRaw = null;

      for (const key of searchKeys) {
        const raws = query(
          `
          SELECT id, content, metadata, createdAt
          FROM RawLog
          WHERE source = 'naver'
            AND metadata LIKE ?
          ORDER BY createdAt DESC
          LIMIT 5
          `,
          [`%${key}%`]
        );

        for (const raw of raws) {
          try {
            const meta = raw.metadata ? JSON.parse(raw.metadata) : {};
            const metaPostId = meta.externalPostId || null;
            const metaUrl = meta.url || null;
            if (
              (externalPostId && metaPostId && String(metaPostId) === String(externalPostId)) ||
              (sourceUrl && metaUrl && String(metaUrl) === String(sourceUrl))
            ) {
              matchedRaw = raw;
              break;
            }
          } catch (e) {
            logger.warn('[Backfill] Failed to parse RawLog metadata', {
              rawId: raw.id,
              error: e.message,
            });
          }
        }

        if (matchedRaw) break;
      }

      if (!matchedRaw) {
        console.log('  - ❌ 매칭되는 RawLog를 찾지 못했습니다.');
        skippedNoRaw++;
        continue;
      }

      const rawContent = (matchedRaw.content || '').trim();
      if (!rawContent || rawContent === '[이미지/미디어 포함]') {
        console.log('  - ⚠️ RawLog에도 유효한 본문이 없습니다.');
        skippedNoContent++;
        continue;
      }

      execute(
        'UPDATE ReportItemIssue SET detail = ?, updatedAt = datetime(\'now\') WHERE id = ?',
        [rawContent, id]
      );

      updated++;
      console.log(`  - ✅ detail 업데이트 완료 (RawLog: ${matchedRaw.id})`);
    }

    console.log('\n===== 결과 요약 =====');
    console.log(`총 대상 이슈: ${issues.length}`);
    console.log(`  ✅ 업데이트된 이슈: ${updated}`);
    console.log(`  ❌ RawLog 매칭 실패: ${skippedNoRaw}`);
    console.log(`  ⚠️ RawLog에 유효한 본문 없음: ${skippedNoContent}`);
    console.log('=====================');

    console.log('완료되었습니다.');
    process.exit(0);
  } catch (error) {
    logger.error('[Backfill] Failed to backfill naver detail', { error: error.message, stack: error.stack });
    console.error('❌ 오류 발생:', error.message);
    process.exit(1);
  }
}

main();
```

**주요 특징**:
- ✅ 날짜 기반 필터링으로 처리 범위 제어
- ✅ 로깅 시스템 활용 (`logger`)
- ✅ 명령행 인자로 유연한 실행
- ⚠️ 개별 UPDATE 실행 (트랜잭션 없음)
- ⚠️ 에러 카운트 추적 없음

### Python 버전 (`backfill-naver-detail.ipynb`)

```1:157:backend/scripts/backfill-naver-detail.ipynb
import json
import sqlite3
from datetime import datetime
import os

# DB 경로 설정
DB_PATH = 'prisma/dev.db'
if not os.path.exists(DB_PATH):
    # backend 디렉토리에서 실행하는 경우
    DB_PATH = os.path.join('..', 'prisma', 'dev.db')

print(f"DB 경로: {os.path.abspath(DB_PATH)}")

if not os.path.exists(DB_PATH):
    raise FileNotFoundError(f"데이터베이스 파일을 찾을 수 없습니다: {DB_PATH}")

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# 1) [이미지/미디어 포함]으로 저장된 이슈들 중 최근 N개만 조회
N = 100
cur.execute("""
SELECT id, summary, detail, externalPostId, sourceUrl
FROM ReportItemIssue
WHERE detail = '[이미지/미디어 포함]'
ORDER BY createdAt DESC
LIMIT ?
""", (N,))
rows = cur.fetchall()
print(f"대상 이슈 수: {len(rows)}")

if len(rows) == 0:
    print("✅ 업데이트할 이슈가 없습니다.")
    conn.close()
    exit(0)

# 2) RawLog에서 같은 externalPostId/url에 대한 content를 찾아 detail 교체
# JavaScript 버전(backfill-naver-detail.js)과 동일한 로직 사용
updated = 0
skipped_no_raw = 0
skipped_no_content = 0
error_count = 0

for row in rows:
    issue_id = row["id"]
    external_post_id = row.get("externalPostId")
    source_url = row.get("sourceUrl")
    summary = row.get("summary", "")[:40] if row.get("summary") else ""
    
    print(f"\n▶ 이슈 처리: {issue_id} | {summary}")
    
    if not external_post_id and not source_url:
        print("  - ⚠️ externalPostId와 sourceUrl이 모두 없습니다. 스킵합니다.")
        skipped_no_raw += 1
        continue
    
    search_keys = []
    if external_post_id:
        search_keys.append(str(external_post_id))
    if source_url:
        search_keys.append(str(source_url))
    
    matched_raw = None
    
    for key in search_keys:
        cur.execute("""
        SELECT id, content, metadata, createdAt
        FROM RawLog
        WHERE source = 'naver'
          AND metadata LIKE ?
        ORDER BY createdAt DESC
        LIMIT 5
        """, (f'%{key}%',))
        
        candidates = cur.fetchall()
        
        for candidate in candidates:
            try:
                meta = json.loads(candidate["metadata"]) if candidate["metadata"] else {}
                meta_post_id = meta.get("externalPostId")
                meta_url = meta.get("url")
                
                if (external_post_id and meta_post_id and 
                    str(meta_post_id) == str(external_post_id)):
                    matched_raw = candidate
                    break
                elif (source_url and meta_url and 
                      str(meta_url) == str(source_url)):
                    matched_raw = candidate
                    break
            except (json.JSONDecodeError, TypeError):
                continue
        
        if matched_raw:
            break
    
    if not matched_raw:
        print("  - ❌ 매칭되는 RawLog를 찾지 못했습니다.")
        skipped_no_raw += 1
        continue
    
    raw_content = (matched_raw["content"] or "").strip()
    if not raw_content or raw_content == '[이미지/미디어 포함]':
        print("  - ⚠️ RawLog에도 유효한 본문이 없습니다.")
        skipped_no_content += 1
        continue
    
    try:
        cur.execute(
            "UPDATE ReportItemIssue SET detail = ?, updatedAt = ? WHERE id = ?",
            (raw_content, datetime.utcnow().isoformat(), issue_id)
        )
        updated += 1
        print(f"  - ✅ detail 업데이트 완료 (RawLog ID: {matched_raw['id']})")
    except Exception as e:
        print(f"  - ❌ 업데이트 실패: {str(e)}")
        error_count += 1
        continue

try:
    conn.commit()
    print("\n===== 결과 요약 =====")
    print(f"총 대상 이슈: {len(rows)}")
    print(f"  ✅ 업데이트된 이슈: {updated}")
    print(f"  ❌ RawLog 매칭 실패: {skipped_no_raw}")
    print(f"  ⚠️ RawLog에 유효한 본문 없음: {skipped_no_content}")
    if error_count > 0:
        print(f"  ❌ 업데이트 에러: {error_count}")
    print("=====================")
except Exception as e:
    conn.rollback()
    print(f"\n❌ 커밋 실패: {str(e)}")
    print("변경사항이 롤백되었습니다.")
finally:
    conn.close()
    print("\n완료되었습니다.")
```

**주요 특징**:
- ✅ 일괄 커밋으로 트랜잭션 보장
- ✅ 에러 카운트 추적
- ✅ try-except-finally로 안전한 리소스 관리
- ⚠️ `exit(0)` 사용 (권장: `sys.exit(0)`)
- ⚠️ 날짜 필터링 없음
- ⚠️ 로깅 시스템 없음

---

## 오류 분석 및 개선 사항

### 1. 발견된 오류

#### 🔴 심각도: 높음

**오류 1: Python 버전의 `exit(0)` 사용**
```python
# 현재 코드
if len(rows) == 0:
    print("✅ 업데이트할 이슈가 없습니다.")
    conn.close()
    exit(0)  # ❌ exit()는 셸에서만 작동
```

**문제점**:
- `exit(0)`는 인터프리터 종료를 강제하여 다른 코드 실행을 방해할 수 있음
- Jupyter Notebook 환경에서 예상치 못한 동작 가능

**해결책**:
```python
import sys
# ...
if len(rows) == 0:
    print("✅ 업데이트할 이슈가 없습니다.")
    conn.close()
    sys.exit(0)  # ✅ 표준 라이브러리 사용
```

**오류 2: 트랜잭션 처리 불일치**

**JavaScript 버전**:
- 개별 `execute()` 호출로 각 UPDATE가 즉시 커밋
- 중간 오류 시 부분 업데이트 가능

**Python 버전**:
- 모든 UPDATE 후 일괄 커밋
- 더 안전하지만 메모리 사용량 증가 가능

**권장 사항**:
- 배치 크기 제한 (예: 100개씩 커밋)
- 진행 상황 저장 (중단 시 재개 가능)

#### 🟡 심각도: 중간

**오류 3: 날짜 필터링 불일치**

**JavaScript 버전**: 날짜 기반 필터링 (최근 N일)
**Python 버전**: 개수 기반 제한 (최근 N개)

**문제점**:
- 두 버전의 동작이 일관되지 않음
- Python 버전에서 오래된 데이터 처리 불가

**해결책**:
```python
from datetime import datetime, timedelta

# 날짜 기반 필터링 추가
days = 3  # 또는 명령행 인자로 받기
since_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

cur.execute("""
SELECT id, summary, detail, externalPostId, sourceUrl
FROM ReportItemIssue
WHERE detail = '[이미지/미디어 포함]'
  AND date >= ?
ORDER BY createdAt DESC
""", (since_date,))
```

**오류 4: LIKE 검색의 성능 문제**

```sql
WHERE metadata LIKE '%externalPostId%'
```

**문제점**:
- `%` 패턴으로 시작하는 LIKE는 인덱스 사용 불가
- 대량 데이터에서 성능 저하 가능

**개선 방안**:
- JSON 인덱싱 활용 (SQLite 3.38+)
- 또는 metadata에서 직접 검색하지 않고 별도 컬럼 사용

#### 🟢 심각도: 낮음

**오류 5: 로깅 시스템 미사용 (Python 버전)**

**현재**:
```python
print(f"  - ❌ 업데이트 실패: {str(e)}")
```

**권장**:
```python
import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

logger.error(f'업데이트 실패: {issue_id}', exc_info=True)
```

**오류 6: 진행 상황 추적 부족**

**현재**: 콘솔 출력만 사용

**개선**:
- 진행률 표시 (예: `Processing 50/100`)
- 중단 시 재개 가능한 체크포인트 저장

---

## 최적화 제안

### 1. 데이터베이스 쿼리 최적화

#### 현재 쿼리 분석

```sql
SELECT id, content, metadata, createdAt
FROM RawLog
WHERE source = 'naver'
  AND metadata LIKE '%externalPostId%'
ORDER BY createdAt DESC
LIMIT 5
```

**성능 문제**:
- `LIKE '%value%'`는 인덱스 사용 불가 (full table scan)
- JSON 파싱을 반복 수행

#### 최적화 방안

**방안 1: JSON 함수 활용 (SQLite 3.38+)**

```sql
SELECT id, content, metadata, createdAt
FROM RawLog
WHERE source = 'naver'
  AND (
    json_extract(metadata, '$.externalPostId') = ?
    OR json_extract(metadata, '$.url') = ?
  )
ORDER BY createdAt DESC
LIMIT 5
```

**장점**:
- 인덱스 사용 가능 (JSON 컬럼에 인덱스 생성 시)
- LIKE 패턴 매칭 불필요

**방안 2: 별도 인덱스 컬럼 추가**

```sql
-- 마이그레이션
ALTER TABLE RawLog ADD COLUMN externalPostId TEXT;
ALTER TABLE RawLog ADD COLUMN sourceUrl TEXT;
CREATE INDEX idx_rawlog_external_post_id ON RawLog(externalPostId);
CREATE INDEX idx_rawlog_source_url ON RawLog(sourceUrl);
```

**장점**:
- 가장 빠른 검색 성능
- LIKE 검색 제거

**단점**:
- 스키마 변경 필요
- 기존 데이터 마이그레이션 필요

### 2. 배치 처리 최적화

#### 현재: 개별 UPDATE

```python
for row in rows:
    # ... 매칭 로직 ...
    cur.execute("UPDATE ... WHERE id = ?", (raw_content, issue_id))
conn.commit()
```

#### 개선: 배치 업데이트

```python
updates = []  # [(issue_id, raw_content), ...]

for row in rows:
    # ... 매칭 로직 ...
    if matched_raw:
        updates.append((raw_content, datetime.utcnow().isoformat(), issue_id))

# 배치 업데이트
BATCH_SIZE = 100
for i in range(0, len(updates), BATCH_SIZE):
    batch = updates[i:i+BATCH_SIZE]
    cur.executemany(
        "UPDATE ReportItemIssue SET detail = ?, updatedAt = ? WHERE id = ?",
        batch
    )
    conn.commit()  # 배치마다 커밋
```

**장점**:
- 트랜잭션 오버헤드 감소
- 중간 오류 시 부분 복구 가능

### 3. 메모리 사용 최적화

#### 현재: 모든 결과를 메모리에 로드

```python
rows = cur.fetchall()  # 모든 행을 메모리에 로드
```

#### 개선: 스트리밍 처리

```python
cur.execute("SELECT ...")
while True:
    row = cur.fetchone()
    if row is None:
        break
    # 처리
    # 배치마다 커밋
```

**장점**:
- 대량 데이터 처리 시 메모리 사용량 감소

### 4. 병렬 처리 (선택적)

대량 데이터 처리 시 멀티프로세싱 활용:

```python
from multiprocessing import Pool

def process_issue(row):
    # 매칭 및 업데이트 로직
    return result

with Pool(processes=4) as pool:
    results = pool.map(process_issue, rows)
```

**주의사항**:
- 데이터베이스 연결은 프로세스별로 분리 필요
- 동시성 제어 (SQLite WAL 모드 활용)

---

## 데이터 흐름

### 전체 프로세스

```
1. 크롤링 단계 (naverCafe.worker.js / naverCafeBackfill.worker.js)
   ↓
   RawLog 저장
   ├─ content: 실제 본문 또는 '[이미지/미디어 포함]'
   └─ metadata: {externalPostId, url, ...}
   
2. 이슈 승격 단계 (naverCafeIssues.service.js)
   ↓
   ReportItemIssue 생성
   ├─ detail: RawLog.content 복사
   └─ externalPostId, sourceUrl: metadata에서 추출
   
3. 문제 발생: 이미지/미디어 포함 게시글
   ↓
   detail = '[이미지/미디어 포함]'
   
4. 백필 스크립트 실행 (backfill-naver-detail.js)
   ↓
   매칭: externalPostId 또는 sourceUrl
   ↓
   detail 업데이트: RawLog.content → ReportItemIssue.detail
```

### 매칭 전략 상세

```
ReportItemIssue
├─ externalPostId: "12345"
└─ sourceUrl: "https://cafe.naver.com/..."

RawLog (후보 1)
├─ metadata: {"externalPostId": "12345", "url": "..."}
└─ content: "실제 본문 내용"
   ✅ 매칭 성공 (externalPostId 일치)

RawLog (후보 2)
├─ metadata: {"externalPostId": "99999", "url": "https://cafe.naver.com/..."}
└─ content: "다른 게시글 내용"
   ❌ 매칭 실패 (externalPostId 불일치, URL도 불일치)
```

---

## 관련 시스템 컴포넌트

### 1. Naver Cafe 크롤러

**파일**: `workers/monitoring/naverCafe.worker.js`, `naverCafeBackfill.worker.js`

**역할**:
- 네이버 카페 게시글 크롤링
- `RawLog` 테이블에 원본 데이터 저장
- 이미지/미디어 포함 게시글 처리

**관련 코드**:
```javascript
// naverCafeBackfill.worker.js에서 RawLog 저장
await saveRawLog({
  source: 'naver',
  content: extractedContent || '[이미지/미디어 포함]',
  metadata: JSON.stringify({
    externalPostId: articleId,
    url: articleUrl,
    // ...
  })
});
```

### 2. 이슈 승격 서비스

**파일**: `services/naverCafeIssues.service.js`

**역할**:
- `RawLog` → `ReportItemIssue` 변환
- AI 분류 및 카테고리 할당
- 에이전트 할당

**관련 로직**:
```javascript
// detail이 summary와 동일하면 자동으로 비움
if (detail === summary) {
  detail = null;
}
```

### 3. 데이터베이스 라이브러리

**파일**: `libs/db.js`

**주요 함수**:
- `query(sql, params)`: SELECT 쿼리 실행
- `queryOne(sql, params)`: 단일 행 반환
- `execute(sql, params)`: INSERT/UPDATE/DELETE 실행

**특징**:
- better-sqlite3 사용 (동기식)
- WAL 모드 지원 (동시성)
- 연결 풀링 (싱글톤)

---

## 실행 방법

### JavaScript 버전

```bash
# 최근 3일간의 이슈 복원
node scripts/backfill-naver-detail.js 3

# 최근 7일간의 이슈 복원
node scripts/backfill-naver-detail.js 7
```

### Python 버전

```bash
# Jupyter Notebook에서 실행
jupyter notebook scripts/backfill-naver-detail.ipynb

# 또는 Python 스크립트로 변환 후 실행
jupyter nbconvert --to script backfill-naver-detail.ipynb
python backfill-naver-detail.py
```

---

## 개선된 코드 예시

### Python 버전 개선안

```python
import json
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path
import logging

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def get_db_path():
    """데이터베이스 경로 결정"""
    db_paths = [
        'prisma/dev.db',
        os.path.join('..', 'prisma', 'dev.db'),
        os.path.join(os.path.dirname(__file__), '..', 'prisma', 'dev.db')
    ]
    
    for path in db_paths:
        abs_path = os.path.abspath(path)
        if os.path.exists(abs_path):
            logger.info(f"DB 경로: {abs_path}")
            return abs_path
    
    raise FileNotFoundError("데이터베이스 파일을 찾을 수 없습니다.")

def find_matching_rawlog(cur, external_post_id, source_url):
    """RawLog에서 매칭되는 항목 찾기"""
    search_keys = []
    if external_post_id:
        search_keys.append(str(external_post_id))
    if source_url:
        search_keys.append(str(source_url))
    
    for key in search_keys:
        # JSON 함수 활용 (SQLite 3.38+)
        cur.execute("""
            SELECT id, content, metadata, createdAt
            FROM RawLog
            WHERE source = 'naver'
              AND (
                json_extract(metadata, '$.externalPostId') = ?
                OR json_extract(metadata, '$.url') = ?
              )
            ORDER BY createdAt DESC
            LIMIT 5
        """, (key, key))
        
        candidates = cur.fetchall()
        
        for candidate in candidates:
            try:
                meta = json.loads(candidate["metadata"]) if candidate["metadata"] else {}
                meta_post_id = meta.get("externalPostId")
                meta_url = meta.get("url")
                
                if (external_post_id and meta_post_id and 
                    str(meta_post_id) == str(external_post_id)):
                    return candidate
                elif (source_url and meta_url and 
                      str(meta_url) == str(source_url)):
                    return candidate
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning(f"메타데이터 파싱 실패: {candidate['id']}, {e}")
                continue
    
    return None

def main():
    # 명령행 인자 처리
    days = 3
    if len(sys.argv) > 1:
        try:
            days = int(sys.argv[1])
            if days <= 0:
                raise ValueError("일수는 1 이상이어야 합니다.")
        except ValueError as e:
            logger.error(f"❌ 잘못된 인자: {e}")
            sys.exit(1)
    
    since_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
    logger.info(f"🛠 최근 {days}일({since_date} ~ 오늘) 동안의 이슈 중 [이미지/미디어 포함] 본문을 복원합니다.")
    
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    
    try:
        cur = conn.cursor()
        
        # 대상 이슈 조회
        cur.execute("""
            SELECT id, summary, detail, externalPostId, sourceUrl
            FROM ReportItemIssue
            WHERE detail = '[이미지/미디어 포함]'
              AND date >= ?
            ORDER BY createdAt DESC
        """, (since_date,))
        
        rows = cur.fetchall()
        logger.info(f"대상 이슈 수: {len(rows)}")
        
        if len(rows) == 0:
            logger.info("✅ 업데이트할 이슈가 없습니다.")
            return
        
        # 통계
        updated = 0
        skipped_no_raw = 0
        skipped_no_content = 0
        error_count = 0
        
        # 배치 업데이트용 리스트
        updates = []
        BATCH_SIZE = 100
        
        for idx, row in enumerate(rows, 1):
            issue_id = row["id"]
            external_post_id = row.get("externalPostId")
            source_url = row.get("sourceUrl")
            summary = row.get("summary", "")[:40] if row.get("summary") else ""
            
            logger.info(f"[{idx}/{len(rows)}] 이슈 처리: {issue_id} | {summary}")
            
            if not external_post_id and not source_url:
                logger.warning("  - ⚠️ externalPostId와 sourceUrl이 모두 없습니다. 스킵합니다.")
                skipped_no_raw += 1
                continue
            
            # RawLog 매칭
            matched_raw = find_matching_rawlog(cur, external_post_id, source_url)
            
            if not matched_raw:
                logger.warning("  - ❌ 매칭되는 RawLog를 찾지 못했습니다.")
                skipped_no_raw += 1
                continue
            
            raw_content = (matched_raw["content"] or "").strip()
            if not raw_content or raw_content == '[이미지/미디어 포함]':
                logger.warning("  - ⚠️ RawLog에도 유효한 본문이 없습니다.")
                skipped_no_content += 1
                continue
            
            # 배치에 추가
            updates.append((
                raw_content,
                datetime.utcnow().isoformat(),
                issue_id
            ))
            updated += 1
            logger.info(f"  - ✅ detail 업데이트 예정 (RawLog ID: {matched_raw['id']})")
            
            # 배치 크기 도달 시 커밋
            if len(updates) >= BATCH_SIZE:
                try:
                    cur.executemany(
                        "UPDATE ReportItemIssue SET detail = ?, updatedAt = ? WHERE id = ?",
                        updates
                    )
                    conn.commit()
                    logger.info(f"배치 커밋 완료: {len(updates)}개 업데이트")
                    updates = []
                except Exception as e:
                    conn.rollback()
                    logger.error(f"배치 커밋 실패: {e}")
                    error_count += len(updates)
                    updates = []
        
        # 남은 업데이트 커밋
        if updates:
            try:
                cur.executemany(
                    "UPDATE ReportItemIssue SET detail = ?, updatedAt = ? WHERE id = ?",
                    updates
                )
                conn.commit()
                logger.info(f"최종 배치 커밋 완료: {len(updates)}개 업데이트")
            except Exception as e:
                conn.rollback()
                logger.error(f"최종 배치 커밋 실패: {e}")
                error_count += len(updates)
        
        # 결과 요약
        logger.info("\n===== 결과 요약 =====")
        logger.info(f"총 대상 이슈: {len(rows)}")
        logger.info(f"  ✅ 업데이트된 이슈: {updated}")
        logger.info(f"  ❌ RawLog 매칭 실패: {skipped_no_raw}")
        logger.info(f"  ⚠️ RawLog에 유효한 본문 없음: {skipped_no_content}")
        if error_count > 0:
            logger.error(f"  ❌ 업데이트 에러: {error_count}")
        logger.info("=====================")
        
    except Exception as e:
        conn.rollback()
        logger.error(f"❌ 오류 발생: {e}", exc_info=True)
        sys.exit(1)
    finally:
        conn.close()
        logger.info("완료되었습니다.")

if __name__ == "__main__":
    main()
```

---

## 테스트 전략

### 1. 단위 테스트

```python
def test_find_matching_rawlog():
    """RawLog 매칭 로직 테스트"""
    # Mock 데이터 준비
    # 매칭 테스트
    # 실패 케이스 테스트
    pass

def test_content_validation():
    """본문 유효성 검사 테스트"""
    assert is_valid_content("") == False
    assert is_valid_content("[이미지/미디어 포함]") == False
    assert is_valid_content("실제 본문 내용") == True
```

### 2. 통합 테스트

- 실제 데이터베이스에서 샘플 데이터로 테스트
- 롤백 가능한 환경에서 실행

### 3. 성능 테스트

- 대량 데이터 처리 시간 측정
- 메모리 사용량 모니터링

---

## 참고 자료

### 관련 파일

- `scripts/backfill-naver-detail.js`: JavaScript 메인 버전
- `scripts/backfill-naver-detail.ipynb`: Python 분석 버전
- `libs/db.js`: 데이터베이스 라이브러리
- `services/naverCafeIssues.service.js`: 이슈 승격 서비스
- `workers/monitoring/naverCafe.worker.js`: 메인 크롤러
- `workers/monitoring/naverCafeBackfill.worker.js`: 백필 크롤러

### 데이터베이스 스키마

- `prisma/schema.prisma`: 전체 스키마 정의
- `ReportItemIssue` 모델: 이슈 테이블
- `RawLog` 모델: 원본 로그 테이블

### 문서

- `CRAWLER_ARCHITECTURE.md`: 크롤러 아키텍처
- `DATA_FLOW_GUIDE.md`: 데이터 흐름 가이드
- `COMMENT_COUNT_ZERO_ISSUE.md`: 댓글 카운트 이슈 문서

---

## 변경 이력

| 날짜 | 버전 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| 2025-01-XX | 1.0 | 초기 문서 작성 | AI Assistant |

---

## 결론

`backfill-naver-detail` 스크립트는 네이버 카페 크롤링 과정에서 발생한 본문 누락 문제를 해결하는 중요한 유지보수 도구입니다. 현재 구현은 기본 기능을 잘 수행하지만, 다음과 같은 개선이 권장됩니다:

1. **일관성**: JavaScript와 Python 버전의 동작 통일
2. **성능**: JSON 함수 활용 또는 인덱스 컬럼 추가
3. **안정성**: 배치 처리 및 에러 핸들링 강화
4. **가시성**: 로깅 시스템 통합 및 진행 상황 추적

위의 개선 사항들을 적용하면 더욱 안정적이고 효율적인 백필 시스템을 구축할 수 있습니다.

