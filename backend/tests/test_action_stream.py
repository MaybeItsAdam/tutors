import json

from action_stream import NO_ACTIONS_MESSAGE, TRUNCATED_MESSAGE, ActionStreamEmitter


def emit_all(chunks, prefill="", finish_reason=None):
    """Run a chunk sequence through an emitter and return every payload."""
    # emit_interval_ms=0 parses on every delta, so tests observe the full
    # unthrottled emission sequence deterministically.
    emitter = ActionStreamEmitter(prefill=prefill, emit_interval_ms=0)
    payloads = []
    for chunk in chunks:
        payloads.extend(emitter.feed(chunk))
    payloads.extend(emitter.finish(finish_reason))
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
    """A response cut off by the token ceiling must not commit a half-written action."""

    def test_length_finish_reason_reports_an_error(self):
        emitter = ActionStreamEmitter(emit_interval_ms=0)
        emitter.feed('{"actions": [{"_type": "think", "text": "half writ')

        payloads = emitter.finish("length")

        assert payloads == [{"error": TRUNCATED_MESSAGE}]

    def test_actions_finished_before_truncation_are_kept(self):
        emitter = ActionStreamEmitter(emit_interval_ms=0)
        payloads = emitter.feed(
            '{"actions": [{"_type": "think", "text": "done"},'
            ' {"_type": "think", "text": "half writ'
        )
        payloads.extend(emitter.finish("length"))

        assert [p["text"] for p in completed(payloads)] == ["done"]
        assert payloads[-1] == {"error": TRUNCATED_MESSAGE}

    def test_normal_finish_completes_the_trailing_action(self):
        emitter = ActionStreamEmitter(emit_interval_ms=0)
        emitter.feed(document([think("only")]))

        payloads = emitter.finish("stop")

        assert [p["text"] for p in payloads] == ["only"]
        assert payloads[0]["complete"] is True

    def test_fully_closed_final_action_is_committed_on_truncation(self):
        # The cutoff landed after the action's closing brace - only the
        # envelope was open, so the action is trustworthy and must be kept.
        emitter = ActionStreamEmitter(emit_interval_ms=0)
        emitter.feed('{"actions": [{"_type": "think", "text": "done"}')

        payloads = emitter.finish("length")

        assert [p["text"] for p in completed(payloads)] == ["done"]
        assert not any("error" in p for p in payloads)

    def test_truncation_with_nothing_parsed_still_reports_an_error(self):
        # Previously this returned [] - the user saw the AI "do nothing".
        emitter = ActionStreamEmitter(emit_interval_ms=0)
        emitter.feed("not json")

        assert emitter.finish("length") == [{"error": TRUNCATED_MESSAGE}]


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

    def test_prose_instead_of_json_reports_an_error(self):
        # Previously silent - the turn ended with no actions and no explanation.
        assert emit_all(["I'm sorry, I can't help with that."]) == [
            {"error": NO_ACTIONS_MESSAGE}
        ]

    def test_valid_json_without_an_actions_array_reports_an_error(self):
        assert emit_all(['{"result": "ok"}']) == [{"error": NO_ACTIONS_MESSAGE}]

    def test_actions_is_not_a_list_reports_an_error(self):
        assert emit_all(['{"actions": "nope"}']) == [{"error": NO_ACTIONS_MESSAGE}]

    def test_empty_actions_array_is_a_legitimate_no_op(self):
        assert emit_all(['{"actions": []}']) == []


class TestNonDictActionElements:
    """
    Regression tests for the whole stream dying on one bad array element.

    `_payload` used to call `dict(action)` on whatever the model put in the
    array; `{"actions": [42]}` raised TypeError, the blanket handler turned it
    into a generic error, and every valid action already streamed was lost.
    """

    def test_bare_number_element_is_skipped(self):
        assert completed(emit_all([document([42])])) == []

    def test_null_element_is_skipped(self):
        assert completed(emit_all([document([None])])) == []

    def test_string_element_is_skipped(self):
        assert completed(emit_all([document(["hello"])])) == []

    def test_nested_list_element_is_skipped(self):
        assert completed(emit_all([document([[1, 2]])])) == []

    def test_valid_actions_around_junk_still_emit(self):
        doc = document([think("a"), 42, think("b")])

        texts = [p["text"] for p in completed(emit_all([doc]))]

        assert texts == ["a", "b"]

    def test_nothing_raises_for_any_junk_document(self):
        for junk in [[42], [None], ["x"], [[1]], [42, None]]:
            emit_all([document(junk)])


class TestFencedAndProseWrappedOutput:
    """
    Models that ignore JSON mode wrap the document in markdown fences or
    prose. Everything before the first '{' and after the closing '}' is junk.
    """

    def test_fenced_document_in_one_chunk(self):
        doc = document([think("fenced")])

        texts = [p["text"] for p in completed(emit_all([f"```json\n{doc}\n```"]))]

        assert texts == ["fenced"]

    def test_fence_split_across_chunks(self):
        doc = document([think("split")])
        chunks = ["```js", "on\n", doc[:10], doc[10:], "\n``", "`"]

        texts = [p["text"] for p in completed(emit_all(chunks))]

        assert texts == ["split"]

    def test_prose_preamble_before_the_document(self):
        doc = document([think("after prose")])

        texts = [p["text"] for p in completed(emit_all(["Here is my plan:\n", doc]))]

        assert texts == ["after prose"]

    def test_prose_postamble_after_the_document(self):
        doc = document([think("before prose")])

        payloads = emit_all([doc, "\nLet me know if you need anything else!"])

        assert [p["text"] for p in completed(payloads)] == ["before prose"]
        assert not any("error" in p for p in payloads)


class TestThrottling:
    """
    Parsing runs json.loads over the whole buffer, so it's rate-limited by
    emit_interval_ms. Completions deferred by the throttle must still all
    arrive - at the next allowed parse or at finish() - exactly once.
    """

    def test_feeds_inside_the_window_emit_nothing(self):
        clock = FakeClock()
        emitter = ActionStreamEmitter(clock=clock, emit_interval_ms=30)
        doc = document([think("a")])

        first = emitter.feed(doc[:10])  # first parse is always allowed
        rest = []
        for ch in doc[10:]:
            rest.extend(emitter.feed(ch))  # all within the same 30ms window

        assert first == []  # first 10 chars don't parse to an action yet
        assert rest == []
        assert [p["text"] for p in completed(emitter.finish())] == ["a"]

    def test_completions_flush_at_the_next_allowed_parse(self):
        clock = FakeClock()
        emitter = ActionStreamEmitter(clock=clock, emit_interval_ms=30)
        doc = document([think("a"), think("b")])
        cut = doc.index('{"_type": "think", "text": "b"}')

        emitter.feed(doc[:5])  # first parse consumed by an unparseable prefix
        assert emitter.feed(doc[5:cut]) == []  # throttled: 'a' completion deferred

        clock.advance(31)
        payloads = emitter.feed(doc[cut:])
        payloads.extend(emitter.finish())

        assert [p["text"] for p in completed(payloads)] == ["a", "b"]

    def test_every_action_completes_exactly_once_with_throttling(self):
        clock = FakeClock()
        emitter = ActionStreamEmitter(clock=clock, emit_interval_ms=30)
        doc = document([think("a"), think("b"), think("c")])

        payloads = []
        for i, ch in enumerate(doc):
            if i % 7 == 0:
                clock.advance(31)
            payloads.extend(emitter.feed(ch))
        payloads.extend(emitter.finish())

        texts = [p["text"] for p in completed(payloads)]
        assert texts == ["a", "b", "c"]


class FakeClock:
    def __init__(self):
        self.now = 1_000

    def __call__(self):
        return self.now

    def advance(self, ms):
        self.now += ms
