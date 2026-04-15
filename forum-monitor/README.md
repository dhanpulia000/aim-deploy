# PlayInZOI Forum Monitor (FastAPI)

Discourse 기반 `forum.playinzoi.com`의 게시글 동향을 **24시간 모니터링**하고, **변화 이력(TopicSnapshot)** 및 **rolling 24h 리포트(DailyTrendReport)** 를 생성하는 MVP입니다.

## 1) 로컬 실행 (WSL2/Ubuntu)

> Ubuntu에서 `venv` 생성이 실패하면 `python3.12-venv` 패키지를 먼저 설치해야 합니다.
>
> ```bash
> sudo apt update
> sudo apt install -y python3.12-venv
> ```

```bash
cd forum-monitor
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

### 환경변수

```bash
cp .env.example .env
```

`.env`에서 `DATABASE_URL`을 실제 Postgres로 맞춰주세요.

## 2) DB 마이그레이션

```bash
cd forum-monitor
. .venv/bin/activate
alembic upgrade head
```

## 3) 서버 실행

```bash
cd forum-monitor
. .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 9090 --reload
```

## 4) API 확인

```bash
curl -s http://127.0.0.1:9090/health | jq
curl -s http://127.0.0.1:9090/crawl/run -X POST -H 'content-type: application/json' -d '{"job_types":["categories","topic_list","topic_detail"]}' | jq
curl -s http://127.0.0.1:9090/categories | jq
curl -s http://127.0.0.1:9090/topics?page=1&page_size=20 | jq
curl -s http://127.0.0.1:9090/reports/daily/latest | jq
curl -s http://127.0.0.1:9090/reports/generate -X POST | jq
```

## 5) 테스트

```bash
cd forum-monitor
. .venv/bin/activate
pytest -q
```

## 운영 메모

- 이 구현은 HTML 스크래핑이 아니라 **Discourse JSON API** (`/categories.json`, `/c/.../l/latest.json`, `/t/{id}.json`)를 사용합니다.
- 요청 실패는 재시도(429/5xx 백오프)하며, 요청 간 딜레이는 `REQUEST_DELAY_MS`로 제어합니다.
- 기본 스케줄러는 앱 부팅 시 동작합니다. 테스트/개발에서 끄려면 `SCHEDULER_ENABLED=false`.

