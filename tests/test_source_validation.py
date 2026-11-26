"""コレクション専用ジェネレーターと、OpenAPIで公開する取得契約を検証する。"""

from time import monotonic, sleep

from fastapi.testclient import TestClient
from studio import create_app


def test_nested_generator_is_checked_before_preview_preset_save_and_start():
    app = create_app("api")
    spec = {
        "business": {
            "resources": [
                {
                    "name": "inventory",
                    "rows": 10,
                    "generator": {
                        "fields": [
                            {
                                "name": "code",
                                "generator": "template",
                                "template": "{missing:03d}",
                            }
                        ]
                    },
                },
            ]
        },
    }
    with TestClient(app) as client:
        for path in ("/api/preview", "/api/presets/bad-generator", "/api/start"):
            response = client.post(path, json=spec)
            assert response.status_code == 422, response.text
            assert "inventory" in response.text
        assert app.state.store.meta("desired") is None


def test_public_openapi_lists_query_names_and_unique_write_operations():
    with TestClient(create_app("api")) as client:
        schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert {p["name"] for p in paths["/source/rest/{name}"]["get"]["parameters"]} == {
        "name",
        "limit",
        "offset",
        "filter",
        "order_by",
        "select",
        "cursor",
    }
    assert {p["name"] for p in paths["/source/odata/{name}"]["get"]["parameters"]} == {
        "name",
        "$top",
        "$skip",
        "$filter",
        "$orderby",
        "$select",
        "$skiptoken",
    }
    assert (
        "application/xml"
        in paths["/source/odata/$metadata"]["get"]["responses"]["200"]["content"]
    )
    item = paths["/source/rest/{name}/{identity}"]
    assert len({operation["operationId"] for operation in item.values()}) == 3
    assert "304" in item["get"]["responses"] and "204" in item["delete"]["responses"]
    assert item["patch"]["requestBody"]["required"]
    assert "201" in paths["/source/rest/{name}"]["post"]["responses"]


def test_rest_writes_keep_their_http_status_and_etag_contract():
    app = create_app("api")
    with TestClient(app) as client:
        assert (
            client.post("/api/profiles", json={"allow_writes": True}).status_code == 200
        )
        assert (
            client.post(
                "/api/start",
                json={
                    "max_ticks": 1,
                    "business": {
                        "updates_per_tick": 0,
                        "resources": [{"name": "orders", "rows": 2}],
                    },
                },
            ).status_code
            == 200
        )
        deadline = monotonic() + 5
        while client.get("/api/state").json()["status"] == "starting":
            assert monotonic() < deadline
            sleep(0.01)

        collection = "/source/rest/orders"
        item = collection + "/example-order"
        row = {"id": "example-order", "value": 28}
        response = client.post(collection, json=row)
        assert response.status_code == 201 and response.json() == row
        assert client.post(collection, json=row).status_code == 409
        response = client.get(item)
        assert response.status_code == 200
        etag = response.headers["etag"]
        assert client.get(item, headers={"if-none-match": etag}).status_code == 304
        assert (
            client.patch(
                item, headers={"if-match": '"bad"'}, json={"value": 2}
            ).status_code
            == 412
        )
        response = client.patch(item, headers={"if-match": etag}, json={"value": 29})
        assert response.status_code == 204 and not response.content
        response = client.get(item)
        assert response.json()["value"] == 29 and response.headers["etag"] != etag

        response = client.request("DELETE", item, headers={"if-match": "*"}, json={})
        assert response.status_code == 204 and not response.content
        assert client.get(item).status_code == 404
