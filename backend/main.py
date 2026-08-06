"""
BYOK AI Tutoring Whiteboard — FastAPI Backend

This backend provides HTTP endpoints for AI model communication.
It supports BYOK (Bring Your Own Key) architecture where API keys are passed
from the frontend via request headers.

Run with: uvicorn main:app --reload --port 8000
"""

import json
import logging
import os
import re
import time
from collections import defaultdict, deque

import litellm
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import llm_service

load_dotenv()

logger = logging.getLogger("tutor-whiteboard")

app = FastAPI(
    title="Tutor Whiteboard API",
    description="BYOK AI Tutoring Whiteboard Backend",
    version="0.1.0",
)

# Allowlist of providers. Models within a provider are not further restricted
# so users can use new models without a code change, but provider spoofing is blocked.
# "google" is accepted as an alias and normalized to "gemini" before this check.
ALLOWED_PROVIDERS = {"openai", "anthropic", "gemini"}

# Map each provider to a cheap model used for key validation calls.
_TEST_MODELS = {
    "openai": "openai/gpt-4o-mini",
    "anthropic": "anthropic/claude-haiku-4-5-20251001",
    "gemini": "gemini/gemini-2.0-flash",
}

# Request limits — generous for legitimate prompts (which include screenshots as
# data URLs) but bounded so the endpoint can't be used to relay arbitrary payloads.
MAX_MESSAGES = int(os.getenv("MAX_MESSAGES", "200"))
MAX_REQUEST_CHARS = int(os.getenv("MAX_REQUEST_CHARS", str(24 * 1024 * 1024)))

# Hard byte ceiling on request bodies, enforced by the guard middleware before
# any JSON parsing. Slightly above MAX_REQUEST_CHARS to leave headroom for
# JSON overhead on an otherwise-legitimate request.
MAX_BODY_BYTES = int(os.getenv("MAX_BODY_BYTES", str(32 * 1024 * 1024)))

# Simple in-memory per-IP rate limiter (sliding window). Suitable for the
# local/single-instance deployments this backend targets; use a shared store
# (e.g. Redis) if this is ever deployed behind multiple workers. Behind a
# reverse proxy every request shares the proxy's IP - run uvicorn with
# --proxy-headers --forwarded-allow-ips=<proxy> so scope["client"] is the real
# client address (see README).
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "30"))
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
_request_times: dict[str, deque] = defaultdict(deque)


def _evict_idle_clients(now: float) -> None:
    """
    Drop clients whose window has fully rolled off.

    Without this the map grows one entry per client IP for the lifetime of the
    process - unnoticeable on localhost, a slow leak anywhere else.
    """
    stale = [
        ip
        for ip, times in _request_times.items()
        if not times or now - times[-1] > RATE_LIMIT_WINDOW_SECONDS
    ]
    for ip in stale:
        del _request_times[ip]


def _is_rate_limited(client_ip: str) -> bool:
    now = time.monotonic()
    _evict_idle_clients(now)
    times = _request_times[client_ip]
    while times and now - times[0] > RATE_LIMIT_WINDOW_SECONDS:
        times.popleft()
    if len(times) >= RATE_LIMIT_REQUESTS:
        return True
    times.append(now)
    return False


async def _send_json(send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class ApiGuardMiddleware:
    """
    Pure-ASGI guard for /api/ routes: rate limiting and body-size caps applied
    BEFORE the request body is read or parsed.

    Previously both ran inside the endpoint, after FastAPI had already parsed
    an arbitrarily large JSON body into memory - the cost the limits exist to
    prevent was paid regardless, and uvicorn imposes no body cap of its own.

    Deliberately not BaseHTTPMiddleware: that wrapper buffers streaming
    responses and interferes with CancelledError propagation on disconnect,
    both of which the SSE chat endpoint depends on.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        client_ip = client[0] if client else "unknown"
        if _is_rate_limited(client_ip):
            await _send_json(send, 429, "Too many requests, slow down")
            return

        # Fast path: reject on the declared length without reading anything.
        for name, value in scope.get("headers") or []:
            if name == b"content-length":
                try:
                    if int(value) > MAX_BODY_BYTES:
                        await _send_json(send, 413, "Request body too large")
                        return
                except ValueError:
                    pass
                break

        # Slow path: cap the streamed body (chunked encoding has no declared
        # length). The raise happens inside FastAPI's body read, below its
        # exception middleware, so it surfaces as a clean 413 response.
        received = 0

        async def capped_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_BODY_BYTES:
                    raise HTTPException(status_code=413, detail="Request body too large")
            return message

        await self.app(scope, capped_receive, send)


# Middleware: last added is outermost. CORS must be added after the guard so
# it stays outermost and 413/429 responses still carry CORS headers (an
# opaque error in the browser otherwise).
app.add_middleware(ApiGuardMiddleware)

# CORS — allow origins from env (comma-separated) or fall back to Vite dev defaults.
# allow_credentials is off: auth rides in headers, not cookies, and credentialed
# CORS combined with a misconfigured "*" origin would reflect any origin.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:7072,http://127.0.0.1:7072")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
if "*" in _allowed_origins:
    logger.warning(
        "ALLOWED_ORIGINS contains '*': any website can call this relay. "
        "List explicit origins instead."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    messages: list[dict]


def _validate_chat_request(body: ChatRequest) -> None:
    if len(body.messages) > MAX_MESSAGES:
        raise HTTPException(status_code=413, detail="Too many messages in request")
    # Measure each message as serialized JSON. The previous version counted
    # only `text` and `image_url.url` fields, so a payload smuggled under any
    # other key sailed through the limit uncounted.
    total_chars = 0
    for message in body.messages:
        total_chars += len(json.dumps(message, separators=(",", ":"), default=str))
        if total_chars > MAX_REQUEST_CHARS:
            raise HTTPException(status_code=413, detail="Request payload too large")


# Model names are free text from a client header that ends up interpolated
# into f"{provider}/{model}" and provider URL paths. The character allowlist
# notably excludes "/" - a slash would smuggle an alternate litellm provider
# route through the interpolation. ":" is kept for OpenAI fine-tune ids.
_MODEL_NAME_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}")


def _get_byok_provider(request: Request) -> tuple[str, str]:
    """Extract and validate X-API-Key and X-Provider from BYOK request headers."""
    api_key = request.headers.get("X-API-Key", "")
    provider = request.headers.get("X-Provider", "").strip().lower()
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing X-API-Key header")
    if not provider:
        raise HTTPException(status_code=400, detail="Missing X-Provider header")
    if provider == "google":
        provider = "gemini"
    if provider not in ALLOWED_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider")
    return api_key, provider


def _get_model(request: Request) -> str:
    model = request.headers.get("X-Model", "").strip()
    if not model:
        raise HTTPException(status_code=400, detail="Missing X-Model header")
    if not _MODEL_NAME_PATTERN.fullmatch(model):
        raise HTTPException(status_code=400, detail="Invalid model name")
    return model


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "tutor-whiteboard-api"}


@app.post("/api/chat")
async def chat(request: Request, body: ChatRequest):
    """
    Streaming chat endpoint.
    Receives messages + canvas snapshot, calls the LLM, streams structured JSON actions.

    Headers:
        X-API-Key: The user's API key
        X-Provider: The provider (openai, anthropic, gemini, google)
        X-Model: The model name (e.g., gpt-4o, claude-sonnet-4-6)
    """
    api_key, provider = _get_byok_provider(request)
    _validate_chat_request(body)
    model = _get_model(request)

    litellm_model = f"{provider}/{model}"

    return StreamingResponse(
        llm_service.stream_agent_actions(model=litellm_model, messages=body.messages, api_key=api_key),
        media_type="text/event-stream",
        headers={
            # Keep intermediaries honest: never cache the stream, and tell
            # nginx-style proxies not to buffer it into one lump.
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/test-key")
async def test_key(request: Request):
    """
    Test an API key by making a minimal request to the provider.
    Used by the BYOK settings modal to validate keys.
    """
    api_key, provider = _get_byok_provider(request)
    litellm_model = _TEST_MODELS[provider]

    try:
        await litellm.acompletion(
            model=litellm_model,
            messages=[{"role": "user", "content": "hi"}],
            api_key=api_key,
            max_tokens=1,
            # This is a UX ping from the settings modal - without a timeout a
            # black-holed connection hangs it for litellm's ~600s default.
            timeout=10,
        )
        return {"status": "ok", "provider": provider, "valid": True}
    except litellm.AuthenticationError:
        return {
            "status": "error",
            "provider": provider,
            "valid": False,
            "error": "Invalid API key",
        }
    except litellm.Timeout:
        return {
            "status": "error",
            "provider": provider,
            "valid": False,
            "error": "The provider did not respond in time. Try again.",
        }
    except Exception:
        # Network down, provider outage, rate limit... - none of these mean
        # the key is bad, and none of the detail should leak to the client.
        return {
            "status": "error",
            "provider": provider,
            "valid": False,
            "error": "Could not reach the provider to validate the key",
        }
