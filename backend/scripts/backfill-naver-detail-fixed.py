"""
수정된 버전: RawLog 매칭 로직이 정확한 externalPostId/url로 매칭하도록 수정
이 파일을 backfill-naver-detail.ipynb의 셀에 복사하여 사용하세요.
"""
import json
import sqlite3
import os
from datetime import datetime
from pathlib import Path

# DB 경로 설정 (스크립트 위치 기준으로 상대 경로 계산)
# 노트북에서는 Path(__file__)가 작동하지 않으므로 수동으로 경로 설정
# 예: script_dir = Path('/home/young-dev/AIM/backend/scripts')
script_dir = Path.cwd()  # 노트북에서는 현재 작업 디렉토리 사용
db_path = script_dir.parent / 'prisma' / 'dev.db'
DB_PATH = str(db_path.resolve())

print(f"DB 경로: {DB_PATH}")

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

# 2) RawLog에서 같은 externalPostId/url에 대한 content를 찾아 detail 교체
updated = 0
skipped_no_raw = 0
skipped_no_content = 0
error_count = 0

for row in rows:
    issue_id = row["id"]
    external_post_id = row.get("externalPostId")
    source_url = row.get("sourceUrl")
    summary = row.get("summary", "")[:40] if row.get("summary") else ""
    
    print(f"처리 중: {issue_id} | {summary}")
    
    if not external_post_id and not source_url:
        print(f"  - ⚠️ externalPostId와 sourceUrl이 모두 없습니다. 스킵합니다.")
        skipped_no_raw += 1
        continue
    
    # externalPostId 또는 sourceUrl로 RawLog 검색
    search_keys = []
    if external_post_id:
        search_keys.append(str(external_post_id))
    if source_url:
        search_keys.append(str(source_url))
    
    matched_raw = None
    
    for key in search_keys:
        # metadata에 키가 포함된 RawLog 검색
        cur.execute("""
        SELECT id, content, metadata, createdAt
        FROM RawLog
        WHERE source = 'naver' AND metadata LIKE ?
        ORDER BY createdAt DESC
        LIMIT 5
        """, (f'%{key}%',))
        
        candidates = cur.fetchall()
        
        for candidate in candidates:
            try:
                meta = json.loads(candidate["metadata"]) if candidate["metadata"] else {}
                meta_post_id = meta.get("externalPostId")
                meta_url = meta.get("url")
                
                # 정확한 매칭 확인
                if (external_post_id and meta_post_id and 
                    str(meta_post_id) == str(external_post_id)):
                    matched_raw = candidate
                    break
                elif (source_url and meta_url and 
                      str(meta_url) == str(source_url)):
                    matched_raw = candidate
                    break
            except json.JSONDecodeError:
                continue
        
        if matched_raw:
            break
    
    if not matched_raw:
        print(f"  - ❌ 매칭되는 RawLog를 찾지 못했습니다.")
        skipped_no_raw += 1
        continue
    
    raw_content = (matched_raw["content"] or "").strip()
    if not raw_content or raw_content == '[이미지/미디어 포함]':
        print(f"  - ⚠️ RawLog에도 유효한 본문이 없습니다.")
        skipped_no_content += 1
        continue
    
    try:
        cur.execute(
            "UPDATE ReportItemIssue SET detail = ?, updatedAt = ? WHERE id = ?",
            (raw_content, datetime.utcnow().isoformat(), issue_id),
        )
        updated += 1
        print(f"  - ✅ detail 업데이트 완료 (RawLog: {matched_raw['id']})")
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
    print(f"  ❌ 업데이트 에러: {error_count}")
    print("=====================")
except Exception as e:
    conn.rollback()
    print(f"\n❌ 커밋 실패: {str(e)}")
    print("변경사항이 롤백되었습니다.")
finally:
    conn.close()





