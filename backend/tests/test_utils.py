import json

import pytest

from utils import MAX_JSON_DEPTH, IncrementalJsonParser, close_and_parse_json


class TestCompleteDocuments:
    def test_parses_intact_json_unchanged(self):
        assert close_and_parse_json('{"a": 1, "b": [2, 3]}') == {"a": 1, "b": [2, 3]}

    def test_empty_string_is_not_a_document(self):
        assert close_and_parse_json("") is None

    def test_prose_is_rejected(self):
        assert close_and_parse_json("I'm sorry, I can't help with that.") is None


class TestTruncatedDocuments:
    """Every prefix of a streaming response should read as a best-effort object."""

    def test_closes_missing_braces(self):
        assert close_and_parse_json('{"a": {"b": 1') == {"a": {"b": 1}}

    def test_closes_missing_brackets(self):
        assert close_and_parse_json('{"a": [1, 2') == {"a": [1, 2]}

    def test_closes_an_open_string(self):
        assert close_and_parse_json('{"text": "half writ') == {"text": "half writ"}

    def test_dangling_key_is_unparseable(self):
        # No value yet, so there is nothing sensible to close to.
        assert close_and_parse_json('{"a":') is None

    def test_every_prefix_of_a_real_document_is_safe(self):
        doc = json.dumps({"actions": [{"_type": "think", "text": "hello"}]})
        # Must never raise, whatever the cut point.
        for i in range(len(doc) + 1):
            close_and_parse_json(doc[:i])


class TestEscaping:
    def test_escaped_quote_does_not_close_the_string(self):
        assert close_and_parse_json('{"text": "say \\"hi') == {"text": 'say "hi'}

    def test_escaped_backslash_at_the_end_still_closes(self):
        # The backslash is escaped, so the following quote is a real terminator.
        assert close_and_parse_json('{"text": "back\\\\"}') == {"text": "back\\"}

    def test_braces_inside_a_string_are_literal_text(self):
        assert close_and_parse_json('{"latex": "\\\\frac{1}{2}"}') == {"latex": "\\frac{1}{2}"}

    def test_unterminated_string_containing_braces(self):
        assert close_and_parse_json('{"latex": "\\\\frac{1') == {"latex": "\\frac{1"}


class TestDepthLimit:
    def test_deep_nesting_is_rejected(self):
        too_deep = "[" * (MAX_JSON_DEPTH + 5)
        assert close_and_parse_json(too_deep) is None

    def test_nesting_within_the_limit_is_accepted(self):
        depth = MAX_JSON_DEPTH - 2
        assert close_and_parse_json("[" * depth) == json.loads("[" * depth + "]" * depth)

    def test_depth_rejection_is_sticky_across_chunks(self):
        parser = IncrementalJsonParser()
        parser.feed("[" * (MAX_JSON_DEPTH + 5))
        # Closing the brackets afterwards must not resurrect the document.
        assert parser.feed("]" * (MAX_JSON_DEPTH + 5)) is None


class TestIncrementalEquivalence:
    """
    The incremental parser exists to avoid rescanning the buffer on every
    chunk. It must agree with a one-shot parse at every step, whatever the
    chunk boundaries.
    """

    DOCUMENTS = [
        '{"actions": [{"_type": "think", "text": "hello"}]}',
        '{"latex": "\\\\frac{1}{2} \\"quoted\\""}',
        '{"a": [1, [2, [3, {"b": "c"}]]]}',
        '{"escaped": "trailing backslash \\\\"}',
    ]

    @pytest.mark.parametrize("doc", DOCUMENTS)
    def test_matches_one_shot_parse_at_every_prefix(self, doc):
        parser = IncrementalJsonParser()
        for i, char in enumerate(doc, start=1):
            assert parser.feed(char) == close_and_parse_json(doc[:i])

    @pytest.mark.parametrize("doc", DOCUMENTS)
    @pytest.mark.parametrize("size", [1, 2, 3, 7, 100])
    def test_chunk_size_does_not_change_the_result(self, doc, size):
        parser = IncrementalJsonParser()
        result = None
        for i in range(0, len(doc), size):
            result = parser.feed(doc[i:i + size])
        assert result == json.loads(doc)

    def test_buffer_accumulates_every_chunk(self):
        parser = IncrementalJsonParser()
        parser.feed('{"a":')
        parser.feed(" 1}")
        assert parser.buffer == '{"a": 1}'


class TestDepth:
    """The delimiter-stack depth is exposed for truncation-commit decisions."""

    def test_depth_tracks_open_delimiters(self):
        parser = IncrementalJsonParser()
        assert parser.depth == 0
        parser.feed('{"actions": [')
        assert parser.depth == 2
        parser.feed('{"_type": "think"')
        assert parser.depth == 3
        parser.feed("}")
        assert parser.depth == 2

    def test_open_string_counts_toward_depth(self):
        parser = IncrementalJsonParser()
        parser.feed('{"actions": [{"text": "half writ')
        assert parser.depth == 4


class TestDocumentCompletion:
    """
    Once the outermost delimiter closes, the buffer freezes there: trailing
    markdown fences or prose would otherwise poison json.loads forever.
    """

    def test_trailing_junk_after_the_document_is_ignored(self):
        parser = IncrementalJsonParser()
        parser.feed('{"a": 1}')
        assert parser.complete
        assert parser.feed("\n```\nHope that helps!") == {"a": 1}
        assert parser.buffer == '{"a": 1}'

    def test_junk_in_the_same_chunk_as_the_close_is_ignored(self):
        parser = IncrementalJsonParser()
        assert parser.feed('{"a": 1}\n```') == {"a": 1}
        assert parser.buffer == '{"a": 1}'

    def test_completion_is_sticky(self):
        parser = IncrementalJsonParser()
        parser.feed('{"a": 1}')
        parser.feed('{"b": 2}')
        assert parser.parse() == {"a": 1}
        assert parser.depth == 0

    def test_incomplete_document_is_not_complete(self):
        parser = IncrementalJsonParser()
        parser.feed('{"a": [1, 2')
        assert not parser.complete

    def test_braces_in_strings_do_not_end_the_document(self):
        parser = IncrementalJsonParser()
        parser.feed('{"text": "not the end }"')
        assert not parser.complete
        parser.feed("}")
        assert parser.complete


class TestIngestParseSplit:
    """ingest() + parse() must be exactly equivalent to feed()."""

    def test_ingest_then_parse_matches_feed(self):
        doc = '{"actions": [{"_type": "think", "text": "hello"}]}'
        for cut in range(len(doc) + 1):
            fed = IncrementalJsonParser()
            split = IncrementalJsonParser()
            fed_result = fed.feed(doc[:cut])
            split.ingest(doc[:cut])
            assert split.parse() == fed_result

    def test_ingest_alone_does_not_parse(self):
        parser = IncrementalJsonParser()
        assert parser.ingest('{"a": 1}') is None
        assert parser.parse() == {"a": 1}
