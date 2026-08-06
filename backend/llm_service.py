import asyncio
import json
import os
import traceback
from collections.abc import AsyncGenerator

import litellm

from action_stream import ActionStreamEmitter

# Configure litellm (optional custom settings)
litellm.drop_params = True

MAX_COMPLETION_TOKENS = int(os.getenv("MAX_COMPLETION_TOKENS", "8192"))

# Anthropic honours assistant message prefill (the model continues from the
# partial assistant turn), which locks the response into our JSON shape.
# Gemini and OpenAI do not support prefill - the model restarts its own
# response - so seeding the buffer would corrupt parsing for them.
PREFILL_CONTENT = '{"actions": [{"_type":'


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _extract_usage(chunk) -> dict | None:
    """Pull a token-usage record off a stream chunk, if it carries one."""
    usage = getattr(chunk, "usage", None)
    if not usage:
        return None
    prompt_tokens = getattr(usage, "prompt_tokens", None)
    completion_tokens = getattr(usage, "completion_tokens", None)
    if prompt_tokens is None and completion_tokens is None:
        return None
    return {
        "promptTokens": prompt_tokens or 0,
        "completionTokens": completion_tokens or 0,
    }


def _build_usage_payload(model: str, usage: dict) -> dict:
    """
    Turn raw token counts into the usage event the client's meter consumes.

    Cost is best-effort: litellm only knows prices for models in its catalog, so
    an unknown or brand-new model reports tokens with a null cost rather than
    failing the request.
    """
    prompt_tokens = usage["promptTokens"]
    completion_tokens = usage["completionTokens"]

    cost_usd = None
    try:
        prompt_cost, completion_cost = litellm.cost_per_token(
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )
        cost_usd = prompt_cost + completion_cost
    except Exception:
        # Unknown pricing is not an error worth surfacing - the token counts
        # are still useful on their own.
        pass

    return {
        "usage": {
            "model": model,
            "promptTokens": prompt_tokens,
            "completionTokens": completion_tokens,
            "totalTokens": prompt_tokens + completion_tokens,
            "costUsd": cost_usd,
        }
    }


async def stream_agent_actions(model: str, messages: list, api_key: str) -> AsyncGenerator[str, None]:
    """
    Streams a response from litellm, parsing the JSON stream dynamically,
    and yielding complete/incomplete AgentAction JSON objects to mimic the
    TypeScript SSE interface expected by TldrawAgent stream handling.

    A final `usage` event carries token counts and estimated cost so the client
    can show the user what the turn cost them - this is a BYOK app, so the bill
    is theirs.

    Detects client disconnects via asyncio.CancelledError so that we stop
    consuming tokens from the upstream LLM provider when the user cancels.
    """

    provider = model.split('/')[0].lower() if '/' in model else ""
    use_prefill = provider == "anthropic"

    if use_prefill:
        local_messages = list(messages)
        local_messages.append({"role": "assistant", "content": PREFILL_CONTENT})
        emitter = ActionStreamEmitter(prefill=PREFILL_CONTENT)
    else:
        local_messages = messages
        emitter = ActionStreamEmitter()

    response = None
    finish_reason = None
    usage: dict | None = None

    try:
        response = await litellm.acompletion(
            model=model,
            messages=local_messages,
            api_key=api_key,
            stream=True,
            temperature=0,
            max_tokens=MAX_COMPLETION_TOKENS,
            # Ask for a usage summary on the final chunk. Providers that don't
            # support it drop the param (litellm.drop_params), in which case we
            # simply report no usage.
            stream_options={"include_usage": True},
        )

        async for chunk in response:
            chunk_usage = _extract_usage(chunk)
            if chunk_usage:
                usage = chunk_usage

            # The usage-only final chunk has no choices - reading choices[0]
            # unguarded would crash the stream right at the finish line.
            choices = getattr(chunk, "choices", None)
            if not choices:
                continue

            choice = choices[0]
            if choice.finish_reason:
                finish_reason = choice.finish_reason

            for payload in emitter.feed(choice.delta.content or ""):
                yield _sse(payload)

        for payload in emitter.finish(finish_reason):
            yield _sse(payload)

        if usage:
            yield _sse(_build_usage_payload(model, usage))

    except asyncio.CancelledError:
        # Client disconnected - close the upstream LLM stream to stop burning tokens
        if response is not None:
            try:
                await response.aclose()
            except Exception:
                pass
        return

    except Exception:
        # Log the full error server-side, but don't leak provider/request
        # details (which may echo parts of the request) to the client.
        traceback.print_exc()
        yield _sse({'error': 'The model request failed. Check your API key and model, then try again.'})
