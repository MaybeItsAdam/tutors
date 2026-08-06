"""
Tests for the stream loop in llm_service, with litellm.acompletion replaced by
a fake async stream. No network, no keys.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest

import llm_service


def content_chunk(text, finish_reason=None):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=text), finish_reason=finish_reason)],
        usage=None,
    )


def usage_only_chunk(prompt_tokens=10, completion_tokens=5):
    """The final chunk some providers send: usage attached, no choices."""
    return SimpleNamespace(
        choices=[],
        usage=SimpleNamespace(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens),
    )


class FakeStream:
    """Async-iterable standing in for litellm's streaming response."""

    def __init__(self, chunks, raise_after=None):
        self._chunks = list(chunks)
        self._raise_after = raise_after
        self._index = 0
        self.aclosed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._raise_after is not None and self._index >= self._raise_after:
            raise self._raise_after_error
        if self._index >= len(self._chunks):
            raise StopAsyncIteration
        chunk = self._chunks[self._index]
        self._index += 1
        return chunk

    def raises(self, error):
        self._raise_after_error = error
        return self

    async def aclose(self):
        self.aclosed = True


@pytest.fixture
def fake_acompletion(monkeypatch):
    """Patch litellm.acompletion; returns a holder with captured kwargs + stream."""
    holder = SimpleNamespace(kwargs=None, stream=FakeStream([]))

    async def acompletion(**kwargs):
        holder.kwargs = kwargs
        return holder.stream

    monkeypatch.setattr(llm_service.litellm, "acompletion", acompletion)
    return holder


def collect(agen):
    """Drain an async generator synchronously and parse the SSE events."""

    async def _run():
        return [item async for item in agen]

    lines = asyncio.run(_run())
    return [json.loads(line[len("data: "):].strip()) for line in lines]


DOC = '{"actions": [{"_type": "think", "text": "hi"}]}'


class TestCompletionKwargs:
    def test_openai_gets_json_mode(self, fake_acompletion):
        collect(llm_service.stream_agent_actions("openai/gpt-4o", [], "key"))
        assert fake_acompletion.kwargs["response_format"] == {"type": "json_object"}

    def test_gemini_gets_json_mode(self, fake_acompletion):
        collect(llm_service.stream_agent_actions("gemini/gemini-2.0-flash", [], "key"))
        assert fake_acompletion.kwargs["response_format"] == {"type": "json_object"}

    def test_anthropic_gets_prefill_not_json_mode(self, fake_acompletion):
        collect(llm_service.stream_agent_actions("anthropic/claude-sonnet-5", [], "key"))

        assert "response_format" not in fake_acompletion.kwargs
        messages = fake_acompletion.kwargs["messages"]
        assert messages[-1] == {"role": "assistant", "content": llm_service.PREFILL_CONTENT}

    def test_non_anthropic_messages_are_not_prefilled(self, fake_acompletion):
        collect(llm_service.stream_agent_actions("openai/gpt-4o", [{"role": "user", "content": "x"}], "key"))
        assert fake_acompletion.kwargs["messages"] == [{"role": "user", "content": "x"}]

    def test_timeout_is_set(self, fake_acompletion):
        collect(llm_service.stream_agent_actions("openai/gpt-4o", [], "key"))
        assert fake_acompletion.kwargs["timeout"] == llm_service.LLM_TIMEOUT_SECONDS


class TestStreamLoop:
    def test_actions_stream_and_usage_comes_last(self, fake_acompletion):
        fake_acompletion.stream = FakeStream([content_chunk(DOC), usage_only_chunk()])

        events = collect(llm_service.stream_agent_actions("openai/gpt-4o", [], "key"))

        completes = [e for e in events if e.get("complete") is True]
        assert [e["text"] for e in completes] == ["hi"]
        assert "usage" in events[-1]
        assert events[-1]["usage"]["totalTokens"] == 15

    def test_usage_only_final_chunk_does_not_crash(self, fake_acompletion):
        fake_acompletion.stream = FakeStream([usage_only_chunk()])

        events = collect(llm_service.stream_agent_actions("openai/gpt-4o", [], "key"))

        assert any("usage" in e for e in events)

    def test_truncated_turn_reports_usage_before_the_error(self, fake_acompletion):
        # The client throws on the first error event, so usage must precede it
        # or a billed-but-truncated turn is never counted.
        truncated = '{"actions": [{"_type": "think", "text": "half'
        fake_acompletion.stream = FakeStream(
            [content_chunk(truncated, finish_reason="length"), usage_only_chunk()]
        )

        events = collect(llm_service.stream_agent_actions("openai/gpt-4o", [], "key"))

        usage_index = next(i for i, e in enumerate(events) if "usage" in e)
        error_index = next(i for i, e in enumerate(events) if "error" in e)
        assert usage_index < error_index

    def test_provider_error_yields_one_generic_error_and_closes_upstream(self, fake_acompletion):
        fake_acompletion.stream = FakeStream([content_chunk(DOC[:10])], raise_after=1).raises(
            RuntimeError("provider exploded: secret request details")
        )

        events = collect(llm_service.stream_agent_actions("openai/gpt-4o", [], "key"))

        errors = [e for e in events if "error" in e]
        assert len(errors) == 1
        assert "secret" not in errors[0]["error"]
        assert fake_acompletion.stream.aclosed

    def test_cancellation_propagates_and_closes_upstream(self, fake_acompletion):
        fake_acompletion.stream = FakeStream([content_chunk(DOC[:10])], raise_after=1).raises(
            asyncio.CancelledError()
        )

        async def _run():
            agen = llm_service.stream_agent_actions("openai/gpt-4o", [], "key")
            async for _ in agen:
                pass

        with pytest.raises(asyncio.CancelledError):
            asyncio.run(_run())
        assert fake_acompletion.stream.aclosed
