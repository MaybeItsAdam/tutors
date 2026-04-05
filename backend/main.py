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

# CORS — allow the Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:7072", "http://127.0.0.1:7072"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "tutor-whiteboard-api"}


@app.post("/api/chat")
async def chat(request: Request):
    """
    Synchronous chat endpoint.
    Receives a prompt + canvas snapshot, calls the LLM, returns structured JSON.

    Headers:
        X-API-Key: The user's API key
        X-Provider: The provider (openai, anthropic, google)
        X-Model: The model name (e.g., gpt-4o, claude-sonnet-4-20250514)
    """
    api_key = request.headers.get("X-API-Key")
    provider = request.headers.get("X-Provider")
    model = request.headers.get("X-Model")

    if not api_key:
        raise HTTPException(status_code=400, detail="Missing X-API-Key header")
    if not provider:
        raise HTTPException(status_code=400, detail="Missing X-Provider header")

    body = await request.json()
    messages = body.get("messages", [])

    # Prefix the model with the provider for LiteLLM routing
    litellm_model = f"{provider}/{model}"

    return StreamingResponse(
        llm_service.stream_agent_actions(model=litellm_model, messages=messages, api_key=api_key),
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
            provider = message.get("provider")
            model = message.get("model")
            messages = message.get("messages", [])

            if not api_key or not provider:
                await websocket.send_json({"error": "Missing apiKey or provider in message"})
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
    api_key = request.headers.get("X-API-Key")
    provider = request.headers.get("X-Provider")

    if not api_key or not provider:
        raise HTTPException(status_code=400, detail="Missing X-API-Key or X-Provider header")

    # Map provider to a litellm model for a minimal validation call
    test_models = {
        "openai": "openai/gpt-4o-mini",
        "anthropic": "anthropic/claude-haiku-4-5-20251001",
        "gemini": "gemini/gemini-2.0-flash",
        "google": "google/gemini-2.0-flash",
    }

    litellm_model = test_models.get(provider)
    if not litellm_model:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    try:
        response = await litellm.acompletion(
            model=litellm_model,
            messages=[{"role": "user", "content": "hi"}],
            api_key=api_key,
            max_tokens=1,
        )
        return {"status": "ok", "provider": provider, "valid": True}
    except Exception as e:
        return {"status": "error", "provider": provider, "valid": False, "error": str(e)}
