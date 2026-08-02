"""
Turns a streaming JSON response into the sequence of agent-action events that
the client's `TldrawAgent.streamAgentActions` expects.

The model streams one document shaped like `{"actions": [ ... ]}`. As it
arrives, each action is emitted repeatedly with `complete: false` so the client
can render it as it forms, then exactly once with `complete: true` when the
next action starts (or when the stream ends).

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


def _now_ms() -> int:
    return int(time.time() * 1000)


class ActionStreamEmitter:
    """
    Feed it content deltas, get back the action payloads to send to the client.

    Payloads are plain dicts; the caller is responsible for SSE framing.
    """

    def __init__(self, prefill: str = "", clock=_now_ms) -> None:
        self._clock = clock
        self._parser = IncrementalJsonParser()
        # How many actions we have started emitting. The action currently being
        # streamed is at index `_cursor - 1`.
        self._cursor = 0
        # Latest parse of the in-flight action, held so `finish` can complete it.
        self._current: dict | None = None
        self._action_started_at = self._clock()

        if prefill:
            # Anthropic honours assistant-message prefill, so the buffer starts
            # mid-document. It can't parse to a whole action yet, so nothing is
            # emitted here - this only primes the parser's delimiter stack.
            self._parser.feed(prefill)

    def feed(self, content: str) -> list[dict]:
        """Consume a content delta and return the payloads to emit, in order."""
        if not content:
            return []

        parsed = self._parser.feed(content)
        if not parsed:
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
                if finished:
                    payloads.append(self._payload(finished, complete=True))
            self._current = None
            self._cursor += 1
            self._action_started_at = self._clock()

        action = actions[self._cursor - 1] if self._cursor > 0 else None
        if action:
            if self._current is None:
                self._action_started_at = self._clock()
            self._current = action
            payloads.append(self._payload(action, complete=False))

        return payloads

    def finish(self, finish_reason: str | None = None) -> list[dict]:
        """
        Close out the stream. Returns the final payloads: the in-flight action
        marked complete, or an error if the model was cut off mid-action.
        """
        if not self._current:
            return []

        if finish_reason == "length":
            return [{"error": TRUNCATED_MESSAGE}]

        payload = self._payload(self._current, complete=True)
        self._current = None
        return [payload]

    def _payload(self, action: dict, *, complete: bool) -> dict:
        payload = dict(action)
        payload["complete"] = complete
        payload["time"] = self._clock() - self._action_started_at
        return payload
