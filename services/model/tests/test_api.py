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

        runs = client.get("/trainings").json()
        assert [r["version"] for r in runs] == [1]
        assert runs[0]["split_method"] == "random"  # the initial data is all interval 0
        assert len(runs[0]["history"]) == runs[0]["epochs_run"]

        tc = client.put("/training-config", json={"patience": 3, "weight_decay": 0.01}).json()
        assert (tc["patience"], tc["weight_decay"]) == (3, 0.01)
        assert client.get("/status").json()["training_config"]["patience"] == 3
        assert client.put("/training-config", json={"max_epochs": 0}).status_code == 422
        assert client.put("/training-config", json={}).status_code == 422
        assert client.put("/training-config", json={"split_method": "sideways"}).status_code == 422
        tc = client.put("/training-config", json={"split_method": "random"}).json()
        assert tc["split_method"] == "random"
        client.put("/training-config", json={"split_method": "temporal"})

        for _ in range(3):
            engine.step()
        engine.request("retrain")
        engine.run_pending()
        latest = client.get("/trainings?limit=1").json()[0]
        assert latest["version"] == 2
        assert latest["split_method"] == "temporal"
        # Trained on the window W (the last w intervals); validation is its newest part.
        assert latest["data_from_interval"] == latest["interval"] - engine.config.window_intervals + 1
        assert latest["data_from_interval"] < latest["val_from_interval"] <= latest["interval"]
        split = latest["interval_split"]
        assert [row[0] for row in split] == list(range(latest["data_from_interval"], latest["interval"] + 1))
        assert all((n_val == 0) == (i < latest["val_from_interval"]) for i, _, n_val in split)
        assert latest["config"]["patience"] == 3

        summary = client.get("/trainings?include_history=false").json()
        assert [r["version"] for r in summary] == [2, 1]
        assert all(r["history"] == [] for r in summary)
        one = client.get("/trainings/1").json()
        assert one["version"] == 1 and len(one["history"]) == one["epochs_run"]
        assert client.get("/trainings/99").status_code == 404

        assert client.post("/retrain").status_code == 202
        assert client.get("/status").json()["auto_retrain"] is True
        assert client.post("/auto-retrain/pause").status_code == 200
        assert client.get("/status").json()["auto_retrain"] is False
        assert client.post("/auto-retrain/resume").status_code == 200
        assert client.get("/status").json()["auto_retrain"] is True

        assert client.post("/centers/0", json={"x": 1.0, "y": 2.0}).status_code == 200
        assert client.post("/centers/0", json={"x": 1.0, "y": 2.0, "mode": "drift"}).status_code == 200
        assert client.post("/centers/99", json={"x": 0, "y": 0}).status_code == 404
        assert client.post("/centers/0", json={"x": 0, "y": 0, "mode": "teleport"}).status_code == 422

        assert client.post("/drift/continuous/start").status_code == 200
        assert client.get("/status").json()["drift"]["continuous"] is True
        assert client.post("/drift/continuous/stop").status_code == 200
        assert client.get("/status").json()["drift"]["continuous"] is False

        assert client.post("/pause").status_code == 200
        assert client.get("/status").json()["paused"] is True
        kinds = [e["kind"] for e in client.get("/events").json()]
        assert {"drift_started", "config_updated", "paused"} <= set(kinds)
