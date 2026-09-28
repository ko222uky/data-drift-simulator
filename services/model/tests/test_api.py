from fastapi.testclient import TestClient

from model_service.api import create_app


def test_endpoints(settings):
    with TestClient(create_app(settings)) as client:
        engine = client.app.state.engine
        engine.initialize()
        engine.step()

        assert client.get("/health").json() == {"status": "ok"}
        status = client.get("/status").json()
        assert status["model"]["version"] == 1
        assert len(client.get("/metrics").json()) == 1
        assert client.get("/projection").json()["points"]

        assert client.post("/drift").status_code == 200
        assert client.get("/status").json()["drift"]["active"] is True

        updated = client.put("/config", json={"accuracy_threshold": 0.7}).json()
        assert updated["accuracy_threshold"] == 0.7
        assert client.put("/config", json={}).status_code == 422
        assert client.put("/config", json={"accuracy_threshold": 2}).status_code == 422

        assert client.post("/retrain").status_code == 202
        assert client.post("/pause").status_code == 200
        assert client.get("/status").json()["paused"] is True
        kinds = [e["kind"] for e in client.get("/events").json()]
        assert {"drift_started", "config_updated", "paused"} <= set(kinds)
