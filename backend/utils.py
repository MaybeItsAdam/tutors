import json

MAX_JSON_DEPTH = 50

# Delimiters that need closing, mapped to the character that closes them.
_CLOSERS = {'{': '}', '[': ']', '"': '"'}


class IncrementalJsonParser:
    """
    Parses a JSON document that arrives in pieces, where every prefix should be
    readable as a best-effort object.

    Feed it chunks as they stream in; after each chunk it returns the document
    parsed as if the missing closing braces/brackets/quotes were already there,
    or None if the prefix still isn't parseable.

    The scan is incremental: each character is visited exactly once across the
    whole stream, and the open-delimiter stack carries over between chunks. The
    naive alternative - rescanning the accumulated buffer on every chunk - is
    O(chunks x length), which on a long response is tens of millions of
    character operations on the event loop thread.
    """

    def __init__(self) -> None:
        self._buffer = ""
        # Index of the next character to scan. Everything before it has already
        # been folded into _stack.
        self._scanned = 0
        # Currently open delimiters, outermost first.
        self._stack: list[str] = []
        # Number of consecutive backslashes immediately before _scanned. Tracked
        # as we go so escape detection stays O(1) instead of scanning backwards.
        self._backslashes = 0
        # Set once nesting passes MAX_JSON_DEPTH. Sticky: the offending prefix
        # never goes away, so no later chunk can make the document acceptable.
        self._too_deep = False
        # Set once the document's outermost delimiter closes. Anything after
        # that (markdown fences, prose postambles) is junk that would poison
        # json.loads forever, so the buffer is frozen at the closing character
        # and later chunks are ignored.
        self._complete = False

    @property
    def buffer(self) -> str:
        """Everything fed so far (truncated at the document end once complete)."""
        return self._buffer

    @property
    def depth(self) -> int:
        """How many delimiters are currently open."""
        return len(self._stack)

    @property
    def complete(self) -> bool:
        """Whether the document's outermost delimiter has closed."""
        return self._complete

    def ingest(self, chunk: str) -> None:
        """Add a chunk and fold it into the delimiter stack without parsing."""
        if chunk and not self._complete:
            self._buffer += chunk
            self._scan()

    def feed(self, chunk: str):
        """
        Add a chunk and return the document parsed so far, or None if the
        current prefix can't be parsed (or is nested too deeply).
        """
        self.ingest(chunk)
        return self.parse()

    def parse(self):
        """Parse the current prefix without adding anything to it."""
        if self._too_deep:
            return None
        try:
            return json.loads(self._buffer + self._closing_suffix())
        except Exception:
            return None

    def _closing_suffix(self) -> str:
        """The characters that would close every currently-open delimiter."""
        return "".join(_CLOSERS[opening] for opening in reversed(self._stack))

    def _scan(self) -> None:
        if self._too_deep:
            return

        buffer = self._buffer
        stack = self._stack

        i = self._scanned
        while i < len(buffer):
            char = buffer[i]
            # The delimiter enclosing this character, decided before the
            # character itself is applied.
            enclosing = stack[-1] if stack else None

            escaped_quote = False
            if char == '"':
                if self._backslashes % 2 == 1:
                    # This quote is escaped, so it's literal string content.
                    escaped_quote = True
                elif enclosing == '"':
                    stack.pop()
                    if not stack:
                        # A bare top-level string document just closed.
                        self._end_document(i + 1)
                        return
                else:
                    stack.append('"')
                    if len(stack) > MAX_JSON_DEPTH:
                        self._too_deep = True
                        self._scanned = i + 1
                        return

            # Track the backslash run for the *next* character.
            self._backslashes = self._backslashes + 1 if char == '\\' else 0

            i += 1

            # Inside a string, structural characters are just text.
            if escaped_quote or enclosing == '"':
                continue

            if char in ('{', '['):
                stack.append(char)
                if len(stack) > MAX_JSON_DEPTH:
                    self._too_deep = True
                    self._scanned = i
                    return
            elif char == '}' and enclosing == '{':
                stack.pop()
                if not stack:
                    self._end_document(i)
                    return
            elif char == ']' and enclosing == '[':
                stack.pop()
                if not stack:
                    self._end_document(i)
                    return

        self._scanned = i

    def _end_document(self, end: int) -> None:
        """The outermost delimiter closed at index `end - 1`; freeze there."""
        self._complete = True
        self._buffer = self._buffer[:end]
        self._scanned = end


def close_and_parse_json(string: str):
    """
    Given a potentially incomplete JSON string, return the parsed object.
    The string might be missing closing braces, brackets, or quotes.
    Returns None if parsing fails or the nesting depth exceeds MAX_JSON_DEPTH.

    One-shot convenience wrapper around IncrementalJsonParser. Prefer the
    parser directly when consuming a stream, so the buffer isn't rescanned.
    """
    return IncrementalJsonParser().feed(string)
