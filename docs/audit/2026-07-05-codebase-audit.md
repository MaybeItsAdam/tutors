# Codebase Audit — 2026-07-05

Full audit of `MaybeItsAdam/tutors` at commit `f8ddff2`. Scope: every first-party
file (~190 files, ~20.6k lines of TS/TSX/Python), dependency health (`npm audit`),
a full `tsc --noEmit` typecheck, and documentation accuracy.

**Verdict:** the architecture (client-side agent loop + thin BYOK FastAPI proxy) is
sound and the code quality is generally good for a project at this stage. But there
is one high-severity security issue (vulnerable pdfjs-dist in an app whose core flow
is "upload a PDF"), the build does not typecheck (11 errors, no CI to catch them),
several correctness bugs in the streaming/persistence paths, and meaningful drift
between the docs and the code.

---

## 1. Security

### 1.1 HIGH — pdfjs-dist 3.11.174 allows arbitrary JS execution from a malicious PDF

- **Where:** `package.json` (`pdfjs-dist: ^3.11.174`), used by `client/utils/PdfProcessor.ts`.
- **What:** GHSA-wgrm-67xf-hhpq / CVE-2024-4367 — PDF.js ≤ 4.1.392 executes
  attacker-controlled JavaScript when rendering a PDF with a malicious font matrix,
  unless `isEvalSupported: false` is passed to `getDocument()`. This app passes no
  such option (`PdfProcessor.ts:25`) and PDF upload (file picker + drag-drop) is a
  headline feature aimed at students opening course material from anywhere.
- **Impact:** a booby-trapped PDF gets full XSS in the app origin — which is exactly
  where the user's **plaintext LLM API keys** live (`localStorage`, see 1.2). One bad
  PDF = stolen OpenAI/Anthropic/Google keys.
- **Fix:**
  1. Immediate mitigation: `pdfjs.getDocument({ data, isEvalSupported: false })`.
  2. Real fix: upgrade to pdfjs-dist ≥ 4.2.67 (npm audit suggests 6.1.200; v3→v4+
     is a breaking change — the worker is `.mjs` and some APIs moved).
- `npm audit --omit=dev`: **14 vulnerabilities (7 high)** — pdfjs-dist, plus `tar`
  / `@mapbox/node-pre-gyp` / `canvas` (pulled in transitively by pdfjs-dist v3; goes
  away with the upgrade) and a moderate `uuid` advisory.

### 1.2 MEDIUM — API keys in plaintext localStorage

- **Where:** `client/utils/BYOKStore.ts` (`tutor-whiteboard-byok` key).
- Plaintext localStorage is the common BYOK compromise, but it makes every XSS
  (see 1.1) a key-theft. Options, in increasing effort: document the risk in the
  settings modal; offer a "don't persist (session only)" mode; keep the key in
  memory and only persist wrapped via WebCrypto with a user passphrase.
- Note the settings modal copy says keys are "stored locally in your browser" —
  good — but also "to bypass the proxy", which is stale copy: there is no proxy
  fallback; without a key the backend returns 400.

### 1.3 MEDIUM — WebSocket endpoint has no origin check and duplicates the HTTP path

- **Where:** `backend/main.py:103-152` (`/ws/chat`).
- CORS middleware does not protect WebSockets — any website can open
  `ws://localhost:8000/ws/chat` from a victim's browser (cross-site WebSocket
  hijacking). Because the key is supplied *in the message*, an attacker can't steal
  the user's key this way, but the endpoint is an unauthenticated open LLM relay
  for whoever holds any key, and it accepts unbounded message loops.
- The client never uses it (`TldrawAgent.streamAgentActions` uses `fetch /api/chat`
  only) — it is dead code marked "(Pending)" in TODO.md. Either delete it or add an
  `Origin` header check mirroring `ALLOWED_ORIGINS` before `accept()`.

### 1.4 LOW — streaming endpoint leaks upstream error details

- **Where:** `backend/llm_service.py:98-100` yields `{'error': str(e)}`.
- `/api/test-key` deliberately hides provider errors ("Don't expose provider error
  details"), but the chat stream forwards raw litellm exception text to the client,
  which can include request/provider internals. Return a generic message and log
  the traceback server-side (it already prints it).

### 1.5 LOW — no size/rate limits on the backend

- `ChatRequest.messages: list[dict]` is unbounded and uninspected; screenshots are
  inlined as multi-MB data-URL images. Fine for localhost; add body-size limits and
  per-IP rate limiting before any shared deployment. Provider allowlisting of
  `X-Provider` is done correctly (`main.py:43,58-70`); `X-Model` is interpolated
  into `f"{provider}/{model}"` but litellm treats only the first segment as the
  provider, so spoofing is contained.

### 1.6 Notes (no action needed)

- KaTeX is rendered via `renderToString` with default `trust: false` +
  `throwOnError: false` (`EquationShapeUtil.tsx:158,177`) — safe against LaTeX-based
  XSS even though the result goes through `dangerouslySetInnerHTML`.
- `mathjs` `evaluate`/`compile` on model/user input is sandboxed by mathjs, but a
  pathological expression (`1e9!`, huge ranges) can hang the tab — all evaluation
  sites wrap in try/catch but none bound execution time. Acceptable for now.
- `client/actions/CountryInfoActionUtil.ts` calls `restcountries.com` directly from
  the browser on model command — harmless, but it's leftover tldraw-starter demo
  cruft that doesn't belong in a tutoring product.

---

## 2. Build health

### 2.1 HIGH — the codebase does not typecheck (11 errors), and nothing would notice

`npx tsc --noEmit` fails:

| File | Error |
| --- | --- |
| `client/App.tsx:293,303` | `tools.asset` / `tools.rectangle` don't exist on the override map type |
| `client/App.tsx:571,578` | pinned-tool id unions passed to narrower toggle functions |
| `client/components/PlotGraphButton.tsx:50` | unused `@ts-expect-error` |
| `client/components/panels/DraggableChatPanel.tsx:170` | `fallback` given a JSX element, not a `TLErrorFallbackComponent` |
| `client/components/panels/Graph3dGimbalPanel.tsx:44,54,61` | `[string]` passed where `TLShapeId[]` required |
| `client/shapes/graph/GraphShapeUtil.tsx:265` | unused `@ts-expect-error` |
| `client/shapes/graph3d/Graph3dShapeUtil.tsx:191` | `MOUSE.NONE` does not exist in three 0.183 — evaluates to `undefined` at runtime, so the intended "disable this mouse button" mapping silently does nothing |

`npm run build` runs `vite build` with the SWC plugin, which **does not typecheck**,
and there is no `typecheck`/`lint`/`test` script, no ESLint config, no tests, and no
CI workflow. Recommended minimum: add `"typecheck": "tsc --noEmit"`, fix the 11
errors, and add a GitHub Actions workflow running it on PRs.

### 2.2 MEDIUM — Python deps unpinned, no lockfile

`backend/requirements.txt` uses `>=` for everything including `litellm` (which
ships breaking changes frequently). Pin versions or add a `uv`/`pip-tools` lock.

---

## 3. Correctness bugs

### 3.1 HIGH — uploaded PDFs do not survive a page reload

- **Where:** `client/utils/PdfProcessor.ts:51` (`URL.createObjectURL`), consumed in
  `client/App.tsx:57-97` as asset `src`.
- Blob URLs are valid only for the current document lifetime, but the asset records
  containing them are persisted twice — by tldraw's own IndexedDB store
  (`persistenceKey="tldraw-agent-demo"`, `App.tsx:776`) and inside every workspace
  snapshot (`WorkspaceManager.captureWorkspaceState`). After any reload, every PDF
  page renders as a broken image, including in "restored" snapshots — undermining
  the whole snapshot/timeline feature for its main use case (working over course
  PDFs).
- **Fix:** store page images through the editor's asset store (or as data URLs /
  IndexedDB blobs keyed by asset id) and resolve to object URLs at render time.

### 3.2 HIGH — workspace snapshots silently stop persisting once localStorage fills

- **Where:** `client/agent/managers/WorkspaceManager.ts:763-778`.
- Every 5 seconds the *entire* workspaces record — every branch's full
  `TLEditorSnapshot` working state plus up to 20 auto-snapshots per branch, each a
  complete deep copy — is `JSON.stringify`'d into a single localStorage key.
  localStorage is ~5 MB; a canvas with a few images exceeds that after a handful of
  snapshots. The write failure is swallowed (`catch { /* ignore storage quota
  failures */ }`), so from then on **all snapshot/branch/workspace state is lost on
  reload with no warning**. The 5-second full-serialize also blocks the main thread
  as boards grow.
- **Fix:** move to IndexedDB, persist snapshots individually rather than one blob,
  and surface quota errors to the user. tldraw already persists the live canvas in
  IndexedDB, so the duplication (two competing sources of truth, with
  `workingState` overwriting the tldraw-persisted canvas on load via
  `loadSnapshot`) is worth revisiting at the same time.

### 3.3 MEDIUM — Gemini streaming relies on Anthropic-style assistant prefill

- **Where:** `backend/llm_service.py:23-33`.
- For `anthropic` *and* `gemini`, the code appends an assistant message
  `{"actions": [{"_type":` and seeds the parse buffer with it, assuming the model
  continues mid-string. Anthropic supports assistant prefill; **Gemini does not
  honor it** — the model typically restarts its own JSON from scratch, so the buffer
  becomes `{"actions": [{"_type":{"actions": [...` and `close_and_parse_json`
  returns garbage or nothing. Gemini streaming is likely broken end-to-end. Test
  against a real key; drop Gemini from the prefill set (or use litellm's
  `response_format` JSON mode for it).

### 3.4 MEDIUM — provider and model come from two different settings and can disagree

- The request sends `X-Provider` from **BYOKStore** (settings modal) but `X-Model`
  from the **model-name manager** (`AGENT_MODEL_DEFINITIONS`), see
  `TldrawAgent.ts:711-715`. Pick provider "anthropic" in settings and
  "gemini-3-flash-preview" in the model picker and the backend calls
  `anthropic/gemini-3-flash-preview`, failing with a confusing provider error.
  `AgentModelDefinition.provider` exists precisely to derive this — use
  `modelDef.provider` (mapping `google→gemini`) for the header instead of the BYOK
  provider, and treat the BYOK entry purely as "which key".
- Related cleanup: `BYOKConfig.model` is dead (never editable, overridden per
  request), and the settings dropdown offering both "Google (google)" and "Google
  Gemini (gemini)" as separate providers is confusing — the backend normalizes them
  to the same thing (`main.py:66-67`; `_TEST_MODELS["google"]` is unreachable).

### 3.5 MEDIUM — truncated responses are marked `complete: true`

- **Where:** `backend/llm_service.py:47` (`max_tokens=8192` hardcoded) and `:84-87`.
- When the stream ends — including by hitting the token cap mid-action — the last
  partial action is emitted with `complete: true`. The client then commits it as a
  finished action (unlocked shape, logged to history) even though it was cut off.
  Check `chunk.choices[0].finish_reason` and either surface a truncation error or
  leave the action incomplete so the client reverts it.

### 3.6 LOW — cancelling mid-action leaves a locked ghost shape

- **Where:** `client/agent/TldrawAgent.ts:599-658`.
- Incomplete `create` actions are applied with `isLocked: true`
  (`CreateActionUtil.ts:102`) and their diff is reverted when the next action
  arrives. If the user cancels (or the stream dies) while an action is mid-stream,
  the loop breaks with `incompleteDiff` never reverted — a locked, half-formed shape
  stays on the canvas. Revert `incompleteDiff` in a `finally` around the stream loop.

### 3.7 LOW — assorted

- **Duplicate hotkey `c`**: `target-area` (`App.tsx:230`) and `complexplane`
  (`App.tsx:285`) both bind `c`; one silently loses.
- **Stream reader error handling** (`TldrawAgent.ts:742-758`): the `catch` around
  `JSON.parse` re-wraps *every* error — including the intentional
  `throw new Error(data.error)` — as a new error, and makes any single malformed
  SSE line fatal to the whole response. Distinguish parse failures (skip the line)
  from server-reported errors (abort).
- **`prompt()` swallows preparation errors** (`TldrawAgent.ts:324-331`): failures
  before streaming only hit `console.error`, never the `onError` toast — the user
  sees nothing happen.
- **Agent edits bypass undo** (`TldrawAgent.ts:650-653`, `history: 'ignore'`): the
  accept/reject diff UI is the intended recovery path, but combined with the
  model-invocable `clear` action (deletes every shape) a stray model output can
  wipe a board with no Ctrl+Z. Consider excluding `clear` from the default action
  set or requiring user confirmation.
- **Zod schemas are prompt-only**: `shared/schema/AgentActionSchemas.ts` is compiled
  to a JSON schema for the system prompt (`buildResponseSchema.ts`) but incoming
  actions are **never** `safeParse`d — validation is ad-hoc per util
  (`AgentHelpers.ensureValueIsNumber` etc.). Running each completed action through
  its schema before `act()` would turn malformed model output into a clean skip
  instead of undefined behavior deep in a shape util.
- **Client timeout**: `AbortSignal.timeout(120_000)` (`TldrawAgent.ts:717`) kills
  any generation longer than 2 minutes even while it is streaming healthily.

---

## 4. Documentation drift

| Doc claim | Reality |
| --- | --- |
| `CLAUDE.md`: "`/server`: Temporary NodeJS local development server…" | No `server/` directory exists (deleted in the client-side agent rewrite; see `docs/branch-audit/README.md`) |
| `README.md` architecture lists `worker/` and `server/` | Neither exists |
| `README.md`: "frontend available at `http://localhost:5173/`" | Vite is pinned to port **7072** (`vite.config.ts:14`) |
| `README.md`: "To change the system prompt, modify `worker/prompt/sections/`" | Actual path is `client/prompt/sections/` |
| `README.md`: `.dev.vars` for "Cloudflare Worker/default agent flows" | No worker exists; backend uses `.env` (`load_dotenv`) — `.env.example` is correct |
| BYOK modal: "bypass the proxy" | There is no proxy; a key is mandatory |
| `CLAUDE.md` mentions only `EquationShape`/`PdfDocumentShape` as custom shapes | There are six: equation, graph, graph3d, vectorfield, complexplane, pdf |

Licensing is consistent enough (MIT root license from tldraw Inc. + tldraw SDK
watermark requirement noted in README), but the copyright line still says
"tldraw Inc." — fine to keep if intended, worth a conscious decision.

---

## 5. Smaller quality observations

- `shared/` contains React components (`shared/icons/*.tsx`) — the "shared with the
  Python backend" boundary described in CLAUDE.md no longer means anything; the
  backend shares nothing. Either regenerate schema types for Python or rename the
  directory's purpose in docs.
- `backend/utils.py close_and_parse_json` re-parses the *entire* buffer on every
  streamed token — O(n²) over the response. Fine at 8k tokens, but an incremental
  parser (or the client's `best-effort-json-parser`, already a dependency) would be
  cheaper.
- `AgentActionManager.act` throws after toasting (`throw error // you may not want
  to throw in productions`) — the comment itself flags unresolved intent; the throw
  aborts the whole stream loop for one bad action.
- Dead/duplicated code: `/ws/chat` (unused), `BYOKStore.getHeaders()` (unused —
  `TldrawAgent` builds headers inline), `_TEST_MODELS["google"]` (unreachable),
  `getModelName.ts` duplicates `AgentModelNameManager` logic.
- `client/components/byok/BYOKSettings.tsx` renders at `zIndex: 999999` with inline
  styles throughout — works, but the project mixes inline styles and `index.css`
  classes with no convention.
- `package.json` has no `engines` field and the repo has no `.nvmrc`; Vite 7
  requires Node ≥ 20.19 — worth pinning for contributors.

---

## 6. Prioritized recommendations

1. **Now:** pass `isEvalSupported: false` in `PdfProcessor` and schedule the
   pdfjs-dist ≥ 4.2 upgrade (kills the 7 high npm-audit findings). *(1.1)*
2. **Now:** fix the 11 tsc errors; add `typecheck` script + CI. *(2.1)*
3. **This week:** fix PDF persistence (blob URLs → durable asset storage). *(3.1)*
4. **This week:** move workspace snapshots off localStorage / stop swallowing quota
   errors. *(3.2)*
5. **This week:** derive `X-Provider` from the selected model's definition; verify
   Gemini streaming end-to-end and remove the Gemini prefill. *(3.3, 3.4)*
6. **Soon:** validate streamed actions with the existing zod schemas; handle
   truncation (`finish_reason`) and mid-action cancellation. *(3.5, 3.6, 3.7)*
7. **Soon:** update CLAUDE.md/README to match the real architecture and ports. *(4)*
8. **Later:** delete or protect `/ws/chat`, pin backend deps, prune starter-kit
   cruft (`countryInfo`, stale copy), decide on `clear`-action safety. *(1.3, 2.2, 3.7)*

---

## 7. Remediation status (2026-07-06)

All findings were addressed in the commit(s) following this report on the
`claude/codebase-audit-fsbd1b` branch:

| Finding | Resolution |
| --- | --- |
| 1.1 pdfjs-dist RCE | Upgraded to pdfjs-dist 4.10.38 **and** `isEvalSupported: false`; `npm audit --omit=dev` now reports **0 vulnerabilities** (was 14, 7 high) |
| 1.2 keys in localStorage | Settings modal now documents the risk and offers a session-only (sessionStorage) mode; stale "bypass the proxy" copy fixed |
| 1.3 `/ws/chat` | Deleted (dead code, unprotectable by CORS); TODO.md updated |
| 1.4 error leak | Stream errors now return a generic message; full traceback stays server-side |
| 1.5 limits | Message-count/body-size caps + per-IP sliding-window rate limiter (env-tunable) |
| 2.1 typecheck | All 11 errors fixed; `npm run typecheck` added; GitHub Actions CI added (typecheck + build + backend compile check) |
| 2.2 unpinned Python deps | Compatible-release (`~=`) pins in requirements.txt |
| 3.1 PDF blob URLs | Pages rendered to JPEG data URLs — durable across reloads |
| 3.2 snapshot quota loss | Workspace persistence moved to IndexedDB (`client/utils/kvStore.ts`, no JSON round-trip, serialized write queue), legacy localStorage state migrated, failures surfaced via toast |
| 3.3 Gemini prefill | Prefill restricted to Anthropic only |
| 3.4 provider/model mismatch | `X-Provider` derived from the selected model's definition; BYOK provider is now just a key label; duplicate google/gemini options merged; dead `BYOKConfig.model`/`getHeaders` removed |
| 3.5 truncation | `finish_reason == "length"` now yields an error instead of marking the cut-off action complete; `MAX_COMPLETION_TOKENS` env-tunable |
| 3.6 cancel ghost shape | Dangling incomplete-action diff reverted in a `finally` when the stream ends |
| 3.7 hotkey collision | Complex plane moved `c` → `q` |
| 3.7 stream parsing | Malformed SSE lines skipped instead of fatal; server `error` events still abort |
| 3.7 `prompt()` swallow | Preparation errors now routed to `onError` toast |
| 3.7 `clear` safety | Removed from the default mode's action set (util remains registered); rationale documented in `AgentModeDefinitions.ts` |
| 3.7 zod validation | Completed actions are `safeParse`d against their mode schema before applying; failures are skipped |
| 3.7 client timeout | Hard 120s cap replaced with a 90s *idle* timeout that resets on every chunk |
| 4 doc drift | README + CLAUDE.md rewritten to match the real architecture, ports, and paths; `.env.example` updated |
| 5 dead code / cruft | Removed `countryInfo` action, `getModelName.ts`, `BYOKStore.getHeaders`, unreachable `_TEST_MODELS["google"]`, and unused deps (`ai`, `best-effort-json-parser`, `@tldraw/tlschema`); `act()` no longer aborts the stream on a single failed action; `engines`/`.nvmrc` added |
| 5 `close_and_parse_json` O(n²) | Left as-is deliberately — acceptable at the 8k-token cap; revisit if the cap grows |

