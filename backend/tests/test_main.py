"""
Tests for the HTTP layer: header validation, the guard middleware (rate
limiting and body caps applied before parsing), and the test-key endpoint.
llm_service and litellm are stubbed - everything runs offline.
"""

import litellm
import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture(autouse=True)
def isolated_rate_limiter():
    main._request_times.clear()
    yield
    main._request_times.clear()


@pytest.fixture
def client(monkeypatch):
    async def fake_stream(model, messages, api_key):
        yield 'data: {"_type": "think", "text": "hi", "complete": true, "time": 1}\n\n'

    monkeypatch.setattr(main.llm_service, "stream_agent_actions", fake_stream)
    return TestClient(main.app)


HEADERS = {
    "X-API-Key": "test-key",
    "X-Provider": "anthropic",
    "X-Model": "claude-sonnet-5",
}


def chat(client, headers=HEADERS, json_body=None):
    return client.post("/api/chat", headers=headers, json=json_body or {"messages": []})


class TestHeaderValidation:
    def test_happy_path_streams(self, client):
        response = chat(client)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert '"think"' in response.text

    def test_missing_api_key(self, client):
        headers = {**HEADERS, "X-API-Key": ""}
        assert chat(client, headers).status_code == 400

    def test_missing_provider(self, client):
        headers = {k: v for k, v in HEADERS.items() if k != "X-Provider"}
        assert chat(client, headers).status_code == 400

    def test_unknown_provider(self, client):
        headers = {**HEADERS, "X-Provider": "mystery"}
        assert chat(client, headers).status_code == 400

    def test_google_is_an_alias_for_gemini(self, client):
        headers = {**HEADERS, "X-Provider": "google", "X-Model": "gemini-2.0-flash"}
        assert chat(client, headers).status_code == 200

    def test_missing_model(self, client):
        headers = {k: v for k, v in HEADERS.items() if k != "X-Model"}
        assert chat(client, headers).status_code == 400


class TestModelNameValidation:
    @pytest.mark.parametrize(
        "model",
        ["gpt-4o", "claude-sonnet-5", "gemini-2.0-flash", "ft:gpt-4o-mini:org::abc123", "o3"],
    )
    def test_real_model_names_are_accepted(self, client, model):
        assert chat(client, {**HEADERS, "X-Model": model}).status_code == 200

    @pytest.mark.parametrize(
        "model",
        [
            "openai/gpt-4o",  # "/" would smuggle an alternate litellm provider route
            "gpt 4o",
            "-leading-dash",
            "a" * 201,
            "model?",
        ],
    )
    def test_malformed_model_names_are_rejected(self, client, model):
        assert chat(client, {**HEADERS, "X-Model": model}).status_code == 400


class TestRequestLimits:
    def test_too_many_messages(self, client, monkeypatch):
        monkeypatch.setattr(main, "MAX_MESSAGES", 2)
        body = {"messages": [{"role": "user", "content": "x"}] * 3}
        assert chat(client, json_body=body).status_code == 413

    def test_oversized_payload_is_measured_serialized(self, client, monkeypatch):
        # The old validator counted only text/image_url fields; smuggling the
        # payload under any other key sailed through uncounted.
        monkeypatch.setattr(main, "MAX_REQUEST_CHARS", 100)
        body = {"messages": [{"role": "user", "content": [{"payload": "y" * 500}]}]}
        assert chat(client, json_body=body).status_code == 413

    def test_declared_content_length_over_cap_is_rejected_before_parsing(
        self, client, monkeypatch
    ):
        monkeypatch.setattr(main, "MAX_BODY_BYTES", 50)
        response = client.post(
            "/api/chat",
            headers={**HEADERS, "Origin": "http://localhost:7072"},
            json={"messages": [{"role": "user", "content": "x" * 200}]},
        )
        assert response.status_code == 413
        # CORS stays outermost, so even guard rejections carry CORS headers -
        # otherwise the browser reports an opaque error instead of a 413.
        assert response.headers.get("access-control-allow-origin")

    def test_streamed_body_over_cap_is_rejected(self, client, monkeypatch):
        # No Content-Length: chunked upload, caught by the capped receive.
        monkeypatch.setattr(main, "MAX_BODY_BYTES", 50)
        response = client.post(
            "/api/chat",
            headers=HEADERS,
            content=iter([b'{"messages": [{"role": "user", "content": "', b"x" * 200, b'"}]}']),
        )
        assert response.status_code == 413


class TestRateLimiting:
    def test_over_limit_returns_429(self, client, monkeypatch):
        monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 2)
        assert chat(client).status_code == 200
        assert chat(client).status_code == 200
        assert chat(client).status_code == 429

    def test_rate_limit_applies_before_body_parsing(self, client, monkeypatch):
        # A garbage body still counts and still gets a 429, proving the
        # limiter runs in the middleware, not after FastAPI's JSON parse.
        monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 1)
        chat(client)
        response = client.post("/api/chat", headers=HEADERS, content=b"not json at all")
        assert response.status_code == 429

    def test_health_is_not_rate_limited(self, client, monkeypatch):
        monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 1)
        chat(client)
        assert client.get("/health").status_code == 200


class TestSseHeaders:
    def test_stream_is_uncacheable_and_unbuffered(self, client):
        response = chat(client)
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"


class TestKeyValidation:
    def _post(self, client):
        return client.post(
            "/api/test-key", headers={"X-API-Key": "k", "X-Provider": "openai"}
        )

    def test_valid_key(self, client, monkeypatch):
        captured = {}

        async def acompletion(**kwargs):
            captured.update(kwargs)
            return None

        monkeypatch.setattr(main.litellm, "acompletion", acompletion)
        body = self._post(client).json()

        assert body["valid"] is True
        # A UX ping must not hang the settings modal for litellm's ~600s default.
        assert captured["timeout"] == 10

    def test_bad_key_is_distinguished_from_outages(self, client, monkeypatch):
        async def acompletion(**kwargs):
            raise litellm.AuthenticationError(
                message="bad key", llm_provider="openai", model="gpt-4o-mini"
            )

        monkeypatch.setattr(main.litellm, "acompletion", acompletion)
        body = self._post(client).json()

        assert body["valid"] is False
        assert body["error"] == "Invalid API key"

    def test_outage_is_not_reported_as_a_bad_key(self, client, monkeypatch):
        async def acompletion(**kwargs):
            raise RuntimeError("connection refused")

        monkeypatch.setattr(main.litellm, "acompletion", acompletion)
        body = self._post(client).json()

        assert body["valid"] is False
        assert "Invalid API key" not in body["error"]
