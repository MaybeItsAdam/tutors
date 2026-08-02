import json

from action_stream import TRUNCATED_MESSAGE, ActionStreamEmitter


def emit_all(chunks, prefill=""):
    """Run a chunk sequence through an emitter and return every payload."""
    emitter = ActionStreamEmitter(prefill=prefill)
    payloads = []
    for chunk in chunks:
        payloads.extend(emitter.feed(chunk))
    payloads.extend(emitter.finish())
    return payloads


def completed(payloads):
    """The actions that were reported complete, in order."""
    return [p for p in payloads if p.get("complete") is True]


def document(actions):
    return json.dumps({"actions": actions})


def think(text):
    return {"_type": "think", "text": text}


def split_at(text, marker):
    """Split a document immediately before `marker`."""
    index = text.index(marker)
    return [text[:index], text[index:]]


class TestMultipleActionsPerChunk:
    """
    Regression tests for actions being silently dropped.

    The emitter used to advance its cursor with `if len(actions) > cursor`,
    stepping at most one action per delta. Any chunk that carried the tail of
    one action plus one or more whole ones lost the remainder: never emitted,
    never applied to the canvas, no error. Providers batch deltas, so this
    showed up as "the model said it would do five things and only did one".
    """

    def test_chunk_completing_several_actions_emits_all_of_them(self):
        doc = document([think("a"), think("b"), think("c"), think("d")])
        # Second chunk carries the end of `a` plus the whole of b, c and d.
        chunks = split_at(doc, '{"_type": "think", "text": "b"}')

        texts = [p["text"] for p in completed(emit_all(chunks))]

        assert texts == ["a", "b", "c", "d"]

    def test_whole_response_in_a_single_chunk(self):
        doc = document([think("a"), think("b"), think("c")])

        texts = [p["text"] for p in completed(emit_all([doc]))]

        assert texts == ["a", "b", "c"]

    def test_every_action_completes_exactly_once(self):
        doc = document([think("a"), think("b"), think("c")])

        texts = [p["text"] for p in completed(emit_all([doc]))]

        assert len(texts) == len(set(texts))


class TestIncrementalStreaming:
    """Character-by-character delivery, the case that always worked."""

    def test_token_by_token_stream_completes_every_action(self):
        doc = document([think("alpha"), think("beta"), think("gamma")])

        texts = [p["text"] for p in completed(emit_all(list(doc)))]

        assert texts == ["alpha", "beta", "gamma"]

    def test_action_is_streamed_as_incomplete_before_it_completes(self):
        doc = document([think("alpha"), think("beta")])

        payloads = emit_all(list(doc))

        partials = [p for p in payloads if p.get("complete") is False]
        assert partials, "expected in-progress actions to stream to the client"
        # The client renders partials as they form, so they must precede the
        # completion of the action they belong to.
        first_complete = next(i for i, p in enumerate(payloads) if p.get("complete"))
        assert any(p.get("complete") is False for p in payloads[:first_complete])

    def test_payloads_carry_type_and_timing(self):
        doc = document([think("alpha")])

        payload = completed(emit_all([doc]))[0]

        assert payload["_type"] == "think"
        assert isinstance(payload["time"], int)


class TestTruncation:
    """A response cut off by the token ceiling must not commit its last action."""

    def test_length_finish_reason_reports_an_error(self):
        emitter = ActionStreamEmitter()
        emitter.feed('{"actions": [{"_type": "think", "text": "half writ')

        payloads = emitter.finish("length")

        assert payloads == [{"error": TRUNCATED_MESSAGE}]

    def test_actions_finished_before_truncation_are_kept(self):
        emitter = ActionStreamEmitter()
        payloads = emitter.feed(
            '{"actions": [{"_type": "think", "text": "done"},'
            ' {"_type": "think", "text": "half writ'
        )
        payloads.extend(emitter.finish("length"))

        assert [p["text"] for p in completed(payloads)] == ["done"]
        assert payloads[-1] == {"error": TRUNCATED_MESSAGE}

    def test_normal_finish_completes_the_trailing_action(self):
        emitter = ActionStreamEmitter()
        emitter.feed(document([think("only")]))

        payloads = emitter.finish("stop")

        assert [p["text"] for p in payloads] == ["only"]
        assert payloads[0]["complete"] is True


class TestPrefill:
    """Anthropic continues from a prefilled assistant turn."""

    def test_prefill_alone_emits_nothing(self):
        emitter = ActionStreamEmitter(prefill='{"actions": [{"_type":')

        assert emitter.feed("") == []
        assert emitter.finish() == []

    def test_prefilled_stream_parses_the_continuation(self):
        prefill = '{"actions": [{"_type":'
        rest = ' "think", "text": "continued"}]}'

        texts = [p["text"] for p in completed(emit_all([rest], prefill=prefill))]

        assert texts == ["continued"]


class TestDegenerateInput:
    """Nothing here should raise - a bad stream must not take the server down."""

    def test_empty_stream(self):
        assert emit_all([]) == []

    def test_prose_instead_of_json(self):
        assert emit_all(["I'm sorry, I can't help with that."]) == []

    def test_valid_json_without_an_actions_array(self):
        assert emit_all(['{"result": "ok"}']) == []

    def test_actions_is_not_a_list(self):
        assert emit_all(['{"actions": "nope"}']) == []

    def test_empty_actions_array(self):
        assert emit_all(['{"actions": []}']) == []
