import json
import time
import asyncio
from typing import AsyncGenerator
import litellm
from utils import close_and_parse_json

# Configure litellm (optional custom settings)
litellm.drop_params = True

async def stream_agent_actions(model: str, messages: list, api_key: str) -> AsyncGenerator[str, None]:
    """
    Streams a response from litellm, parsing the JSON stream dynamically,
    and yielding complete/incomplete AgentAction JSON objects to mimic the
    TypeScript SSE interface expected by TldrawAgent stream handling.

    Detects client disconnects via asyncio.CancelledError so that we stop
    consuming tokens from the upstream LLM provider when the user cancels.
    """

    buffer = '{"actions": [{"_type":'
    cursor = 0
    maybe_incomplete_action = None
    start_time = int(time.time() * 1000)
    response = None

    try:
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            api_key=api_key,
            stream=True,
            temperature=0,
            max_tokens=8192
        )

        async for chunk in response:
            content = chunk.choices[0].delta.content or ""
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

    except Exception as e:
        print(f"Error in stream_agent_actions: {e}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
