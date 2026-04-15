from fastapi.testclient import TestClient

from app.main import create_app


def test_health_ok():
    app = create_app()
    with TestClient(app) as c:
        r = c.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True

