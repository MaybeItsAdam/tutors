"""
Turns a streaming JSON response into the sequence of agent-action events that
the client's `TldrawAgent.streamAgentActions` expects.

The model streams one document shaped like `{"actions": [ ... ]}`. As it
arrives, each action is emitted repeatedly with `complete: false` so the client
can render it as it forms, then exactly once with `complete: true` when the
next action starts (or when the stream ends).

The client treats every incomplete emission as a full standalone snapshot (it
reverts the previous incomplete diff and reapplies the whole action), so
payloads must always carry the entire current action - only the emission
cadence is throttled, never the payload shape.

This module deliberately has no litellm/network dependency: it is pure,
synchronous, and directly unit-testable.
"""

import time

from utils import IncrementalJsonParser

# Message shown when the model hit its token ceiling mid-action. The trailing
# action can't be trusted, so it's reported as an error rather than committed.
TRUNCATED_MESSAGE = (
    "Response was cut off by the model token limit. Try a smaller request."
)

# Message shown when the model produced output that never parsed into any
# action - prose, a refusal, or JSON of the wrong shape. Without this the turn
# would end in total silence and look like the AI simply did nothing.
NO_ACTIONS_MESSAGE = (
    "The model's response could not be read as whiteboard actions. "
    "Try again, or try a different model."
)

# The document's envelope is `{"actions": [ ... ]}`, so while an action object
# is open the delimiter stack is at least `{`, `[`, `{` (depth 3). If the
# stack is back down to the envelope (depth <= 2), the in-flight action's own
# braces have closed and its JSON can be trusted even on a truncated stream.
_ENVELOPE_DEPTH = 2


def _now_ms() -> int:
    return int(time.time() * 1000)


class ActionStreamEmitter:
    """
    Feed it content deltas, get back the action payloads to send to the client.

    Payloads are plain dicts; the caller is responsible for SSE framing.

    `emit_interval_ms` throttles how often the buffer is re-parsed and the
    in-flight action re-emitted: parsing runs json.loads over the whole buffer,
    so doing it on every delta is O(chunks x length). Completions deferred by
    the throttle are flushed on the next parse and always on `finish()`. Pass 0
    to parse on every delta (used by tests).
    """

    def __init__(self, prefill: str = "", clock=_now_ms, emit_interval_ms: int = 30) -> None:
        self._clock = clock
        self._emit_interval_ms = emit_interval_ms
        self._parser = IncrementalJsonParser()
        # How many actions we have started emitting. The action currently being
        # streamed is at index `_cursor - 1`.
        self._cursor = 0
        # Latest parse of the in-flight action, held so `finish` can complete it.
        self._current: dict | None = None
        self._action_started_at = self._clock()
        self._last_parse_at: int | None = None
        # Non-whitespace was fed (prefill excluded) - used to distinguish an
        # empty stream (silent) from output that never parsed (an error).
        self._saw_content = False
        # At least one action payload was emitted.
        self._emitted_action = False
        # Until the first '{' arrives, discard everything: models that ignore
        # JSON mode wrap the document in markdown fences or prose preambles.
        # (The parser itself freezes at the closing brace, covering trailing
        # junk - see IncrementalJsonParser.complete.)
        self._seeking = not prefill

        if prefill:
            # Anthropic honours assistant-message prefill, so the buffer starts
            # mid-document. It can't parse to a whole action yet, so nothing is
            # emitted here - this only primes the parser's delimiter stack.
            self._parser.feed(prefill)

    def feed(self, content: str) -> list[dict]:
        """Consume a content delta and return the payloads to emit, in order."""
        if not content:
            return []
        if content.strip():
            self._saw_content = True

        if self._seeking:
            brace = content.find("{")
            if brace == -1:
                return []
            self._seeking = False
            content = content[brace:]

        self._parser.ingest(content)

        now = self._clock()
        if self._last_parse_at is not None and now - self._last_parse_at < self._emit_interval_ms:
            return []
        self._last_parse_at = now

        return self._advance(self._parser.parse(), emit_incomplete=True)

    def finish(self, finish_reason: str | None = None) -> list[dict]:
        """
        Close out the stream. Returns the final payloads: any completions the
        throttle deferred, the in-flight action marked complete, and/or an
        error when the model was cut off or produced nothing usable.
        """
        parsed = self._parser.parse()
        payloads = self._advance(parsed, emit_incomplete=False)

        if finish_reason == "length":
            if self._current is not None and self._parser.depth <= _ENVELOPE_DEPTH:
                # The final action's own JSON closed before the cutoff - only
                # the envelope was left open, so the action can be trusted.
                payloads.append(self._payload(self._current, complete=True))
                self._current = None
            else:
                # Cut off mid-action, or before anything parsed at all.
                payloads.append({"error": TRUNCATED_MESSAGE})
            return payloads

        if self._current is not None:
            payloads.append(self._payload(self._current, complete=True))
            self._current = None
            return payloads

        if self._saw_content and not self._emitted_action and not payloads:
            # The model said something, but nothing ever became an action. A
            # well-formed `{"actions": []}` is a legitimate no-op; anything
            # else deserves an explanation rather than silence.
            is_empty_actions = isinstance(parsed, dict) and parsed.get("actions") == []
            if not is_empty_actions:
                payloads.append({"error": NO_ACTIONS_MESSAGE})

        return payloads

    def _advance(self, parsed, *, emit_incomplete: bool) -> list[dict]:
        """Emit completions for finished actions and (optionally) the in-flight one."""
        if not isinstance(parsed, dict):
            return []

        actions = parsed.get("actions")
        if not isinstance(actions, list) or not actions:
            return []

        payloads: list[dict] = []

        # Advance through every action the model has finished since the last
        # delta. This must be a loop, not a single step: one delta can easily
        # carry the tail of one action plus several whole ones, and stepping
        # once per delta would silently drop the rest.
        while len(actions) > self._cursor:
            if self._cursor > 0:
                finished = actions[self._cursor - 1]
                # Non-dict elements (a bare number, string, null...) can't be
                # actions - skip them rather than crashing the whole stream.
                if isinstance(finished, dict) and finished:
                    payloads.append(self._payload(finished, complete=True))
            self._current = None
            self._cursor += 1
            self._action_started_at = self._clock()

        action = actions[self._cursor - 1] if self._cursor > 0 else None
        if isinstance(action, dict) and action:
            if self._current is None:
                self._action_started_at = self._clock()
            self._current = action
            if emit_incomplete:
                payloads.append(self._payload(action, complete=False))
        else:
            self._current = None

        return payloads

    def _payload(self, action: dict, *, complete: bool) -> dict:
        payload = dict(action)
        payload["complete"] = complete
        payload["time"] = self._clock() - self._action_started_at
        self._emitted_action = True
        return payload
