"""
BYOK AI Tutoring Whiteboard — FastAPI Backend

This backend provides HTTP endpoints for AI model communication.
It supports BYOK (Bring Your Own Key) architecture where API keys are passed
from the frontend via request headers.

Run with: uvicorn main:app --reload --port 8000
"""

import os
import time
from collections import defaultdict, deque

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import litellm
import llm_service

load_dotenv()

app = FastAPI(
    title="Tutor Whiteboard API",
    description="BYOK AI Tutoring Whiteboard Backend",
    version="0.1.0",
)

# CORS — allow origins from env (comma-separated) or fall back to Vite dev defaults
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:7072,http://127.0.0.1:7072")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

# Simple in-memory per-IP rate limiter (sliding window). Suitable for the
# local/single-instance deployments this backend targets; use a shared store
# (e.g. Redis) if this is ever deployed behind multiple workers.
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "30"))
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
_request_times: dict[str, deque] = defaultdict(deque)


def _check_rate_limit(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    times = _request_times[client_ip]
    while times and now - times[0] > RATE_LIMIT_WINDOW_SECONDS:
        times.popleft()
    if len(times) >= RATE_LIMIT_REQUESTS:
        raise HTTPException(status_code=429, detail="Too many requests, slow down")
    times.append(now)


class ChatRequest(BaseModel):
    messages: list[dict]


def _validate_chat_request(body: ChatRequest) -> None:
    if len(body.messages) > MAX_MESSAGES:
        raise HTTPException(status_code=413, detail="Too many messages in request")
    total_chars = 0
    for message in body.messages:
        content = message.get("content", "")
        if isinstance(content, str):
            total_chars += len(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict):
                    total_chars += len(str(part.get("text", "")))
                    image_url = part.get("image_url")
                    if isinstance(image_url, dict):
                        total_chars += len(str(image_url.get("url", "")))
        if total_chars > MAX_REQUEST_CHARS:
            raise HTTPException(status_code=413, detail="Request payload too large")


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
    _check_rate_limit(request)
    api_key, provider = _get_byok_provider(request)
    _validate_chat_request(body)
    model = request.headers.get("X-Model", "").strip()
    if not model:
        raise HTTPException(status_code=400, detail="Missing X-Model header")

    litellm_model = f"{provider}/{model}"

    return StreamingResponse(
        llm_service.stream_agent_actions(model=litellm_model, messages=body.messages, api_key=api_key),
        media_type="text/event-stream"
    )


@app.post("/api/test-key")
async def test_key(request: Request):
    """
    Test an API key by making a minimal request to the provider.
    Used by the BYOK settings modal to validate keys.
    """
    _check_rate_limit(request)
    api_key, provider = _get_byok_provider(request)
    litellm_model = _TEST_MODELS[provider]

    try:
        await litellm.acompletion(
            model=litellm_model,
            messages=[{"role": "user", "content": "hi"}],
            api_key=api_key,
            max_tokens=1,
        )
        return {"status": "ok", "provider": provider, "valid": True}
    except Exception:
        # Don't expose provider error details to the client
        return {"status": "error", "provider": provider, "valid": False, "error": "Invalid API key or authentication failed"}
