# Project Audit — 2026-07-12

Follow-up audit of `MaybeItsAdam/tutors` at commit `488fddc`, one week after the
2026-07-05 codebase audit. Scope: verification that the previous audit's fixes
hold, a fresh pass over the backend/client streaming path, and an assessment of
what stands between the current state and a "complete" project.

**Verdict:** the codebase is in good health — the 2026-07-05 remediation is real
and verified (typecheck clean, `npm audit --omit=dev` 0 vulnerabilities, build
passes, CI in place). What's stopping completeness is no longer code quality:
it is that the core end-to-end loop has **never been tested against a live
model** (TODO.md's own last unchecked Step 4 item), and there are concrete
reasons to expect it to fail silently for two of the three supported providers.
Beyond that: zero tests, no deployment story, and some doc/config staleness.

---

## 1. Verification of the 2026-07-05 remediation

Spot-checked every high/medium finding against the current tree:

| Previous finding | Status |
| --- | --- |
| pdfjs-dist RCE (1.1) | ✅ 4.10.38 + `isEvalSupported: false`; `npm audit --omit=dev` → **0 vulnerabilities** |
| tsc errors / no CI (2.1) | ✅ `npm run typecheck` passes; `.github/workflows/ci.yml` runs typecheck + build + backend compile on PRs |
| PDF blob URLs (3.1) | ✅ pages rendered to JPEG data URLs (`PdfProcessor.ts:50`) |
| localStorage snapshot loss (3.2) | ✅ IndexedDB via `client/utils/kvStore.ts` |
| Gemini prefill (3.3) | ✅ prefill restricted to `provider == "anthropic"` (`llm_service.py:30-31`) |
| provider/model mismatch (3.4) | ✅ `X-Provider` derived from the model definition (`TldrawAgent.ts:739`) |
| truncation (3.5) | ✅ `finish_reason == "length"` yields an error event (`llm_service.py:96-100`) |
| cancel ghost shape (3.6) | ✅ dangling `incompleteDiff` reverted in `finally` (`TldrawAgent.ts:678-699`) |
| `/ws/chat`, error leak, rate limits (1.3-1.5) | ✅ endpoint deleted; generic stream errors; message/body caps + per-IP limiter |
| zod validation, SSE robustness, idle timeout (3.7) | ✅ all present in `TldrawAgent.ts` |

`npm run build` also passes (see §4 for the bundle-size caveat).

---

## 2. What's stopping this from being a complete project

### 2.1 HIGH — the end-to-end loop has never been run against a live model

TODO.md's only unchecked Step 4 item is the end-to-end test (PDF on canvas →
context → live model → agent draws `EquationShape`s). Nothing in the repo — no
test, no recorded transcript, no CI secret — indicates any provider has ever
been exercised. For a project whose entire value is that loop, this is the
single biggest gap, and 2.2/2.3 below are specific reasons to expect it to
break for OpenAI and Gemini.

### 2.2 HIGH — no JSON enforcement for OpenAI/Gemini; failure mode is a silent no-op

- **Where:** `backend/llm_service.py` (no `response_format`), `backend/utils.py`
  (`close_and_parse_json`), `client/prompt/sections/rules-section.ts`.
- Anthropic responses are locked into the JSON shape by assistant prefill. For
  OpenAI and Gemini there is **nothing** forcing raw JSON: no
  `response_format={"type": "json_object"}` (or schema-constrained mode), and
  the system prompt asks for "a valid JSON object" without forbidding markdown
  fences. Models very commonly wrap such output in ` ```json … ``` `.
- If that happens, `close_and_parse_json` calls `json.loads` on a buffer that
  starts with backticks → `None` on every chunk → **zero action events are
  emitted and the generator ends without any error event**. The client's stream
  loop then completes normally: no shapes, no error toast, nothing in chat. The
  user just sees the agent do nothing.
- **Fix (three layers):**
  1. Pass `response_format={"type": "json_object"}` for openai/gemini
     (`litellm.drop_params = True` is already set, so providers that reject it
     degrade gracefully).
  2. Strip a leading ` ```json`/trailing ` ``` ` fence from the buffer before
     parsing in `close_and_parse_json` (cheap, provider-agnostic).
  3. If the upstream stream ends and `cursor == 0` (no action ever parsed),
     yield an `error` event ("model returned no parseable actions") so the
     client surfaces it instead of finishing silently.

### 2.3 MEDIUM — missing-key UX is a raw 400

With no key saved, `TldrawAgent.streamAgentActions` omits the BYOK headers
entirely (`TldrawAgent.ts:764-768`) and the backend replies
`400 {"detail":"Missing X-API-Key header"}`, which reaches the user as a raw
`Request failed (400): …` toast. First-run experience should be a client-side
check: no key → open/point to the BYOK settings modal, don't send the request.

### 2.4 MEDIUM — zero tests

There are no unit or integration tests anywhere in the repo (no runner, no
test script; CI is typecheck + build + `compileall`). Highest-value targets,
roughly in order:

1. `backend/utils.py close_and_parse_json` — pure function, easy table-driven
   tests (escaped quotes, nested depth, fenced input once 2.2 lands).
2. `backend/llm_service.stream_agent_actions` — feed a fake litellm stream,
   assert the complete/incomplete event sequence, truncation, and the
   empty-stream error.
3. `shared/schema` action schemas + the sanitize paths in `client/actions/`
   (`vitest` fits the existing Vite toolchain).

### 2.5 MEDIUM — no deployment story

Everything assumes two hand-started localhost processes. There is no
Dockerfile/compose, no production guidance (the backend's in-memory rate
limiter and CORS defaults are single-instance/localhost by design — documented,
but that's the only mode). For an open-source project to be "complete", a
one-command run (`docker compose up`: uvicorn + built frontend) or a hosted
demo + written deploy notes is the difference between "works on the author's
machine" and something others can adopt.

### 2.6 LOW — the model catalog will rot, and `thinking` is dead config

`shared/models.ts` hardcodes five dated model ids. The backend deliberately
doesn't restrict models within a provider, so a free-text "custom model id"
field in the picker would future-proof the UI. Separately,
`AgentModelDefinition.thinking` is defined (set on `gemini-3-pro-preview`) but
**never read** by any code — either wire it through to the backend (litellm
`thinking`/`reasoning_effort`) or delete it.

---

## 3. Documentation / planning drift

- **TODO.md is stale on Step 5:** "User Native Math Input" is listed as future
  work with MathLive as *Idea 2*, but MathLive editing is already integrated
  (`EquationShapeUtil.tsx`, `MathCheatSheet.tsx`, plus the toolbar equation
  tool — effectively Ideas 1+2 shipped). The file also still opens with "You
  are picking up from the end of Step 3", which no longer describes the
  project. Rewrite TODO.md around what's actually left (E2E test, tests,
  deployment, handwriting-to-math).
- **LICENSE.md** copyright line still reads "2024 tldraw Inc." — flagged last
  audit as "worth a conscious decision"; still pending one.

---

## 4. Smaller quality observations

- **Bundle size:** the main chunk is 4.98 MB (1.44 MB gzip). three.js,
  MathLive, KaTeX, pdfjs and tldraw are all eagerly loaded. Dynamic-importing
  the heavy shape utils (3D graph, PDF) would cut initial load substantially.
- **Rate limiter memory:** `_request_times` (`main.py:65`) never deletes an
  IP's deque, so entries accumulate per unique client. Irrelevant on localhost;
  evict empty deques if this ever serves real traffic.
- **`AgentModeManager.ts:51`** carries the repo's one remaining TODO comment
  ("see if this is needed…") — resolve or remove.
- **No ESLint/Prettier config** — typecheck-only CI catches type errors but not
  the usual lint class (unused vars, hook deps). Low priority, cheap to add.

---

## 5. Prioritized recommendations

1. **Now:** add JSON-mode/fence handling + empty-stream error (§2.2) — without
   it, the E2E test below will likely "fail silently" for OpenAI/Gemini.
2. **Now:** run the real end-to-end test with live keys for all three
   providers and record the result in TODO.md (§2.1).
3. **This week:** client-side missing-key guard → open BYOK settings (§2.3).
4. **This week:** first tests — `close_and_parse_json` + a fake-stream test for
   `stream_agent_actions`; wire into CI (§2.4).
5. **Soon:** docker-compose (or equivalent) one-command run + deploy notes (§2.5).
6. **Soon:** rewrite TODO.md to reflect reality; decide the LICENSE line (§3).
7. **Later:** custom-model-id field, remove/wire the `thinking` flag,
   code-split heavy shapes, lint config (§2.6, §4).
