import json
import os
import time
import asyncio
import traceback
from typing import AsyncGenerator
import litellm
from utils import close_and_parse_json

# Configure litellm (optional custom settings)
litellm.drop_params = True

MAX_COMPLETION_TOKENS = int(os.getenv("MAX_COMPLETION_TOKENS", "8192"))


async def stream_agent_actions(model: str, messages: list, api_key: str) -> AsyncGenerator[str, None]:
    """
    Streams a response from litellm, parsing the JSON stream dynamically,
    and yielding complete/incomplete AgentAction JSON objects to mimic the
    TypeScript SSE interface expected by TldrawAgent stream handling.

    Detects client disconnects via asyncio.CancelledError so that we stop
    consuming tokens from the upstream LLM provider when the user cancels.
    """

    # Anthropic honours assistant message prefill (the model continues from the
    # partial assistant turn), which locks the response into our JSON shape.
    # Gemini and OpenAI do not support prefill — the model restarts its own
    # response — so seeding the buffer would corrupt parsing for them.
    provider = model.split('/')[0].lower() if '/' in model else ""
    use_prefill = provider == "anthropic"

    if use_prefill:
        prefill_content = '{"actions": [{"_type":'
        local_messages = list(messages)
        local_messages.append({"role": "assistant", "content": prefill_content})
        buffer = prefill_content
    else:
        local_messages = messages
        buffer = ""

    cursor = 0
    maybe_incomplete_action = None
    start_time = int(time.time() * 1000)
    response = None
    finish_reason = None

    try:
        response = await litellm.acompletion(
            model=model,
            messages=local_messages,
            api_key=api_key,
            stream=True,
            temperature=0,
            max_tokens=MAX_COMPLETION_TOKENS
        )

        async for chunk in response:
            choice = chunk.choices[0]
            if choice.finish_reason:
                finish_reason = choice.finish_reason
            content = choice.delta.content or ""
            buffer += content

            partial_object = close_and_parse_json(buffer)
            if not partial_object:
                continue

            actions = partial_object.get("actions")
            if not isinstance(actions, list) or len(actions) == 0:
                continue

            if len(actions) > cursor:
                # Emit the previous action as complete (skip when cursor==0, there's no previous)
                if cursor > 0:
                    prev_action = actions[cursor - 1]
                    if prev_action:
                        prev_action["complete"] = True
                        prev_action["time"] = int(time.time() * 1000) - start_time
                        yield f"data: {json.dumps(prev_action)}\n\n"
                maybe_incomplete_action = None
                cursor += 1
                start_time = int(time.time() * 1000)

            action = actions[cursor - 1] if cursor > 0 else None
            if action:
                if not maybe_incomplete_action:
                    start_time = int(time.time() * 1000)
                maybe_incomplete_action = action
                action_copy = dict(action)
                action_copy["complete"] = False
                action_copy["time"] = int(time.time() * 1000) - start_time
                yield f"data: {json.dumps(action_copy)}\n\n"

        if maybe_incomplete_action:
            if finish_reason == "length":
                # The response was cut off by the token limit — the trailing
                # action is not trustworthy, so report an error instead of
                # committing a half-generated action as complete.
                yield f"data: {json.dumps({'error': 'Response was cut off by the model token limit. Try a smaller request.'})}\n\n"
            else:
                maybe_incomplete_action["complete"] = True
                maybe_incomplete_action["time"] = int(time.time() * 1000) - start_time
                yield f"data: {json.dumps(maybe_incomplete_action)}\n\n"

    except asyncio.CancelledError:
        # Client disconnected — close the upstream LLM stream to stop burning tokens
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
        yield f"data: {json.dumps({'error': 'The model request failed. Check your API key and model, then try again.'})}\n\n"
