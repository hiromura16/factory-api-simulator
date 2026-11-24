"""業務取得APIの手順見本を、通信や状態変更なしで確認する。"""

from fastapi.testclient import TestClient

from models import Profile, Resource, Spec
from studio import create_app


def test_business_preview_renders_safe_relative_requests():
    """認証値を伏せ、選択中のコレクションに対応するパスだけを組み立てる。"""
    app = create_app("api")
    with TestClient(app) as client:
        app.state.store.save_profile(Profile(id="fixture", auth_mode="api_key", token="synthetic-token-for-tests"))
        spec = Spec(profile_id="fixture")
        spec.business.resources = [Resource(name="stock", rows=27), Resource(name="works", rows=13)]
        spec.business.page_size = 4
        spec.business.fault = "rate_limit"
        spec.business.fault_every = 1
        before = client.get("/api/state").json()
        response = client.post("/api/preview", json=spec.model_dump(mode="json"))
        assert response.status_code == 200
        assert "synthetic-token-for-tests" not in response.text
        result = response.json()
        assert result["writes"] is False
        plan = result["request_preview"]
        assert plan["profile"]["header_example"] == "X-API-Key: <キー>"
        assert plan["profile"]["writes_allowed"] is False
        assert plan["fault_every"] == 1
        assert plan["metadata_path"] == "/source/odata/$metadata"
        assert plan["resources"] == [
            {"name": "stock", "initial_rows": 27,
             "rest_path": "/source/rest/stock?limit=4", "odata_path": "/source/odata/stock?$top=4"},
            {"name": "works", "initial_rows": 13,
             "rest_path": "/source/rest/works?limit=4", "odata_path": "/source/odata/works?$top=4"},
        ]
        assert client.get("/api/state").json() == before


def test_business_preview_accepts_editing_an_unregistered_profile():
    """プリセット編集中の未登録プロファイルは見本を残し、未登録と表示する。"""
    with TestClient(create_app("api")) as client:
        spec = Spec(profile_id="unconfigured")
        response = client.post("/api/preview", json=spec.model_dump(mode="json"))
        assert response.status_code == 200
        assert response.json()["request_preview"]["profile"] == {
            "profile_id": "unconfigured", "available": False,
        }
