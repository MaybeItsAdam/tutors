import json
import time
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
    """
    
    # We force the model to start formatting its JSON directly.
    # Note: Anthropic & Gemini support this via tool formatting or natively,
    # but since litellm acts as an abstraction we just append partial start if supported,
    # or rely on the LLM generating "{"actions": [{"_type":"...
    buffer = '{"actions": [{"_type":'
    cursor = 0
    maybe_incomplete_action = None
    start_time = int(time.time() * 1000)

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
                action = actions[cursor - 1] if cursor > 0 else None
                if action:
                    action["complete"] = True
                    action["time"] = int(time.time() * 1000) - start_time
                    yield f"data: {json.dumps(action)}\n\n"
                    maybe_incomplete_action = None
                cursor += 1
                
            action = actions[cursor - 1] if len(actions) >= cursor and cursor > 0 else None
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

    except Exception as e:
        print(f"Error in stream_agent_actions: {e}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
