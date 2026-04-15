# Forum Monitoring Service (FastAPI)

PlayInZOI Discourse(`forum.playinzoi.com`)를 대상으로 **목록 수집(Discovery)** / **상세 수집(Normalize+Snapshot)** / **24h 동향 리포트(DailyTrendReport)** 를 생성하는 서브프로젝트입니다.

## 구성
- **API**: FastAPI (`uvicorn`)
- **DB**: PostgreSQL
- **Queue/Scheduler**: Celery + Redis + Celery Beat

## 로컬 실행 (Docker)

```bash
cd services/forum_monitoring
docker compose up --build
```

`docker-compose.yml`이 `DATABASE_URL` / `REDIS_URL`을 Compose 네트워크용(`postgres`, `redis` 호스트)으로 고정합니다. 로컬 개발용 `.env`에 `localhost:55432`가 있어도 API/워커 컨테이너는 항상 같은 스택의 DB에 붙습니다.

## 환경변수

`.env.example`을 복사해서 `.env`를 만들고 조정하세요.

```bash
cp .env.example .env
```

## 개발 실행 (로컬 파이썬)

```bash
cd services/forum_monitoring
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --host 0.0.0.0 --port 9090
```

## 워커 실행

```bash
celery -A app.workers.celery_app worker -l INFO
celery -A app.workers.celery_app beat -l INFO
```

