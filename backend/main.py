"""
BYOK AI Tutoring Whiteboard — FastAPI Backend

This backend provides HTTP and WebSocket endpoints for AI model communication.
It supports BYOK (Bring Your Own Key) architecture where API keys are passed
from the frontend via request headers.

Run with: uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import json
import os
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
ALLOWED_PROVIDERS = {"openai", "anthropic", "gemini", "google"}

# Map each provider to a cheap model used for key validation calls.
_TEST_MODELS = {
    "openai": "openai/gpt-4o-mini",
    "anthropic": "anthropic/claude-haiku-4-5-20251001",
    "gemini": "gemini/gemini-2.0-flash",
    "google": "google/gemini-2.0-flash",
}


class ChatRequest(BaseModel):
    messages: list[dict]


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
    api_key, provider = _get_byok_provider(request)
    model = request.headers.get("X-Model", "").strip()
    if not model:
        raise HTTPException(status_code=400, detail="Missing X-Model header")

    litellm_model = f"{provider}/{model}"

    return StreamingResponse(
        llm_service.stream_agent_actions(model=litellm_model, messages=body.messages, api_key=api_key),
        media_type="text/event-stream"
    )


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    """
    WebSocket streaming endpoint for real-time AI responses.
    Streams structured JSON actions back to the frontend.

    The first message should include BYOK credentials.
    """
    await websocket.accept()

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            api_key = message.get("apiKey")
            provider = (message.get("provider") or "").strip().lower()
            if provider == "google":
                provider = "gemini"
            model = (message.get("model") or "").strip()
            messages = message.get("messages", [])

            if not api_key or not provider:
                await websocket.send_json({"error": "Missing apiKey or provider in message"})
                continue
            if provider not in ALLOWED_PROVIDERS:
                await websocket.send_json({"error": "Unknown provider"})
                continue
            if not model:
                await websocket.send_json({"error": "Missing model in message"})
                continue

            litellm_model = f"{provider}/{model}"

            try:
                async for chunk in llm_service.stream_agent_actions(
                    model=litellm_model, messages=messages, api_key=api_key
                ):
                    await websocket.send_text(chunk)
            except Exception as e:
                await websocket.send_json({"error": str(e)})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass


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
        )
        return {"status": "ok", "provider": provider, "valid": True}
    except Exception:
        # Don't expose provider error details to the client
        return {"status": "error", "provider": provider, "valid": False, "error": "Invalid API key or authentication failed"}
