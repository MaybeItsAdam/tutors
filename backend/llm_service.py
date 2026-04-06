import json
import time
import asyncio
from typing import AsyncGenerator
import litellm

# Configure litellm (optional custom settings)
litellm.drop_params = True

async def stream_agent_actions(
    model: str,
    messages: list,
    api_key: str,
    tools: list | None = None,
) -> AsyncGenerator[str, None]:
    """
    Streams a response from litellm using the tool use (function calling) API.

    Each tool call made by the model is emitted as an SSE event with the same
    shape as an AgentAction: { _type, <params>, complete, time }.

    The `tools` parameter should be a list of OpenAI-format tool definitions:
    [{ "type": "function", "function": { "name", "description", "parameters" } }]

    Detects client disconnects via asyncio.CancelledError to stop consuming
    upstream tokens when the user cancels.
    """

    response = None

    try:
        kwargs: dict = dict(
            model=model,
            messages=messages,
            api_key=api_key,
            stream=True,
            temperature=0,
            max_tokens=8192,
        )

        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        response = await litellm.acompletion(**kwargs)

        # Accumulate streaming tool call deltas by index
        # Each entry: { id, name, args_str }
        tool_call_accumulator: dict[int, dict] = {}
        start_time = int(time.time() * 1000)

        async for chunk in response:
            choice = chunk.choices[0]
            delta = choice.delta

            # Accumulate tool call fragments
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_call_accumulator:
                        tool_call_accumulator[idx] = {"id": "", "name": "", "args": ""}
                    entry = tool_call_accumulator[idx]
                    if tc.id:
                        entry["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            entry["name"] = tc.function.name
                        if tc.function.arguments:
                            entry["args"] += tc.function.arguments

            # When a round of tool calls is complete, emit them and reset
            if choice.finish_reason == "tool_calls":
                for tc in tool_call_accumulator.values():
                    try:
                        args = json.loads(tc["args"]) if tc["args"] else {}
                        action = {
                            "_type": tc["name"],
                            **args,
                            "complete": True,
                            "time": int(time.time() * 1000) - start_time,
                        }
                        yield f"data: {json.dumps(action)}\n\n"
                    except json.JSONDecodeError as e:
                        print(f"Failed to parse tool call args for {tc['name']}: {e}")

                tool_call_accumulator = {}
                start_time = int(time.time() * 1000)

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
