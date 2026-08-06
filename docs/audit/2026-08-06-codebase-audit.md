# Codebase Audit — 2026-08-06

Six-track parallel audit (agent system, React UI/shapes, Python backend, security,
testing/CI/DX, plus a cross-reference pass against the three prior audits in this
directory). Findings below are deduplicated and marked **NEW** or **KNOWN-OPEN**
(previously reported, still unfixed). Prior-audit findings that are verified fixed
are not repeated.

---

## Critical

### C1. `equation` actions are silent no-ops — the util is never registered — NEW
`client/actions/EquationActionUtil.ts:9`

Every other action util wraps itself in `registerActionUtil(...)`; this one is
exported bare, so it never enters the action registry. The schema *is* registered
(auto-registered from `AgentActionSchemas.ts` exports) and `equation` is listed in
the mode's `actions` array, so the model is told it can create equations, the
action validates, streams, and is logged to chat history as done — then falls
through to `UnknownActionUtil.applyAction`, which does nothing. The core maths
output of a tutoring whiteboard is dead, and the model believes it succeeded.

**Fix:** wrap in `registerActionUtil(...)`. Then add a startup assertion that every
`_type` in each mode's `actions` array (except `unknown`) resolves to a
non-unknown util — this bug class is invisible to typecheck because
`AgentModeDefinitions.ts` only reads the static `.type`. Once registered, note the
util uses a random `createShapeId()` per chunk while streaming, bypassing the
id-uniqueness machinery — give the equation a stable id the model can reference.

---

## High

### H1. Agent loop error paths brick the agent for the session — NEW
`client/agent/TldrawAgent.ts:362-407, 570`

Everything after the `try/catch` around `await this.request(request)` in
`prompt()` is uncovered: the mode-invariant throw, `onPromptEnd` hooks, `setMode`
(which itself throws on same-mode transitions — the acknowledged TODO at
`AgentModeManager.ts:52`), and the recursive `prompt()`. Any throw leaves
`$isPrompting` stuck true; every later prompt fails with "Agent is already
prompting". `_schedule` also fires `this.prompt(request)` un-awaited, so those
errors are unhandled rejections with no toast.

**Fix:** try/finally guaranteeing `setIsPrompting(false)` + `setCancelFn(null)` on
the outermost call; `.catch(this.onError)` at the `_schedule` call site; make
same-mode `setMode` an early return.

### H2. Dropped/failed actions are invisible to the model — NEW
`client/agent/TldrawAgent.ts:690, 710`; `client/agent/managers/AgentActionManager.ts:106-112`

Three drop paths (mode-unavailable skip, schema-validation failure, `applyAction`
throw) discard actions without recording anything the model sees — while
`ReviewActionUtil` explicitly instructs it to "assume each action in the chat
history completed successfully". On continuations the model references phantom
shapes and compounds the error for up to 12 self-billed turns.

**Fix:** push a chat-history item (`[ACTION FAILED: reason] <action>`) on each drop
path so the model can self-correct. Route `UpdateActionUtil`'s "shape not found"
throw the same way. Related (M-tier): `UpsertTodoListItemActionUtil.ts:22-27`
calls `agent.interrupt(...)` on a missing `text`, cancelling the in-flight request
and discarding the rest of the turn's actions — skip-and-report instead.

### H3. Full app state serialized to localStorage on every streamed chunk — NEW
`client/agent/managers/AgentAppPersistenceManager.ts:169-183, 250-262`

`createAgentStateWatcher` reacts to `chat.getHistory()` (updated per streaming
delta) and synchronously `JSON.stringify`s every agent's entire history —
including a full `RecordsDiff<TLRecord>` per action — into localStorage. Main
thread jank during generation; long sessions hit the ~5 MB quota, after which
saves fail *silently* (`catch { console.warn }`) and state is lost on reload.
This is exactly the pattern the 08-02 audit fixed in `WorkspaceManager` (dirty
flag + timer + IndexedDB); this parallel path was missed.

**Fix:** debounce or dirty-flag + interval; skip saves mid-stream; move to the
IndexedDB `kvStore`; don't persist diffs (or prune beyond the review window).

### H4. Request failure triggers blind zero-backoff retries — NEW
`client/agent/TldrawAgent.ts:749-753`; `client/modes/AgentModeChart.ts:70-79`

Network/HTTP failures are swallowed (`onError`, no rethrow), so `onPromptEnd`
can't tell "model finished" from "request died". With outstanding todos it
schedules an immediate "Continue until all your todo items are done" — up to 12
instant retries and toasts against a failing backend. Conversely a transient
failure on the *first* prompt (no todos yet) gets zero retries.

**Fix:** propagate success/failure from `requestAgentActions`; on failure skip
continuation scheduling; add bounded exponential backoff for retryable errors.

### H5. The usage meter is dead code — BYOK users have no spend display — NEW
`client/components/UsageMeter.tsx` (imported only by unmounted `ChatPanel.tsx`)

CLAUDE.md says "`AgentUsageManager` accumulates it and `UsageMeter` displays it",
but the live `DraggableChatPanel`/`TranscriptPanel` never renders it. A whole dead
component cluster rides along: `ChatPanel.tsx`, `ChatInput.tsx`,
`WorkspacePanel.tsx` (364 lines), `ChatPanelFallback.tsx`, plus their CSS blocks
in `client/index.css`. Also: usage undercounts on cancel — the terminal `usage`
event is only read if the stream reaches it (`TldrawAgent.ts:892-895`), so
aborted (but billed) requests are never counted.

**Fix:** mount `UsageMeter` in the transcript panel; delete the rest.

### H6. Graph rendering re-parses expressions thousands of times per render — NEW
`client/shapes/graph/GraphShapeUtil.tsx:77-83, 656-679, 746-756`

`evaluate(expr, scope)` parses+compiles per sample: 401 samples/curve in
`buildPath` plus a 400-step intersection scan with Newton refinement — ~2,500+
full parses per render for a 2-function graph. Worse, the `useMemo` guarding
`findIntersections` is dead (`functionsToPlot` is a fresh array every render), and
`buildPath` is called inline in JSX unmemoized — so all of it reruns on every
selection change and every slider input event. `Graph3dShapeUtil` already does
this correctly with `compile()`.

**Fix:** `compile()` once per expression string (memoized), `.evaluate(scope)` per
sample; memo `functionsToPlot` and the path strings on stable keys. Same
parse-per-cell fix applies to `VectorFieldShapeUtil.tsx:103-104` (~540
parses/recompute).

### H7. three.js leaks: wireframe meshes accumulate forever; per-shape 60 fps loops — NEW
`client/shapes/graph3d/Graph3dShapeUtil.tsx:220-239, 256-287`

The mesh-update effect disposes `meshRef.current` but the wireframe mesh it adds
is never stored, removed, or disposed — every expression/bounds change stacks
another one permanently (visual ghosting + GPU leak). Materials are never
disposed; in matrix mode the effect returns early and orphans the freshly built
geometry; unmount cleanup skips scene resources; ArrowHelper geometries leak.
Separately, each shape runs an unconditional `requestAnimationFrame` loop
dispatching a window `CustomEvent` at 60 Hz from mount — N shapes = N permanent
loops, even off-screen. (`Graph3dGizmo3D`'s `toDispose` tracking is the pattern to
copy.)

**Fix:** track and dispose the wireframe + materials in effect cleanup; full scene
disposal on unmount; render-on-demand via OrbitControls `change` + invalidate;
dispatch orientation only when the camera actually moved; pause off-viewport.

### H8. Rules-of-hooks violation in the PDF shape — NEW
`client/shapes/pdf/PdfDocumentShapeUtil.tsx:89-98`

Early return on empty `assetIds` sits *before* `useCallback` (177) and
`useEffect` (188). Any transition between empty and non-empty asset lists throws
"Rendered fewer/more hooks than during the previous render". Move hooks above the
return.

### H9. Backend: one bad action element kills the stream; non-JSON output stays a silent no-op
`backend/action_stream.py:104-108` — NEW; `backend/llm_service.py:105-116` — KNOWN-OPEN (07-12 §2.2)

- `_payload` calls `dict(action)`: a model emitting `{"actions": [42]}` raises,
  the blanket handler converts it to a generic error, and all prior valid actions
  in the turn are lost. Guard `isinstance(action, dict)` and skip. (Verified
  empirically.)
- OpenAI/Gemini never get `response_format={"type":"json_object"}`, so fenced
  (```json) or prose output is common; the parser never fires, `finish()` returns
  `[]` — including for `finish("length")` when nothing parsed — and the user sees
  the AI "do nothing" with no error. Request JSON mode where supported, strip
  fences before feeding the parser, emit an error payload when a non-empty buffer
  produced zero actions, and hoist the `length` check above the `_current` guard.
  Also NEW: `finish("length")` discards a final action that is fully closed valid
  JSON (`action_stream.py:97-98`).

### H10. `litellm~=1.55` pin does the opposite of its comment — NEW
`backend/requirements.txt:5`

`~=1.55` means `>=1.55, ==1.*` — every 1.x minor installs, exactly the "frequent
breaking minor releases" the header comment claims to block. The 1.55 floor also
predates several litellm advisories. Pin `~=1.55.0` style with a bumped floor (or
exact pins + pip-compile). `pytest~=8.3` / `python-dotenv~=1.0` share the shape.

### H11. Zero frontend tests, no runner; no lint anywhere — KNOWN-OPEN (07-12 §2.4, §4)

~21k lines of client/shared TS with no test framework installed. Highest-value
pure-logic targets, in order: `latexToMathjs.ts` (feeds all four plot shapes),
`workspaceExport.ts` (`parseWorkspaceFile` / `reidentifyWorkspace` — the id-collision
invariant CLAUDE.md itself warns about), `matrixFromLatex.ts`, round-trip tests
for the `shared/format` converters (811 + 359 lines), known-good/bad payloads
against `AgentActionSchemas.ts`, and per-mode snapshots of
`getSystemPromptFlags`/`buildSystemPrompt`. Vitest is the natural fit (Vite 7
already present). No ESLint/Prettier/ruff config exists in the repo at all; an
agent-heavy React app particularly wants `react-hooks` exhaustive-deps (it would
have caught several findings here). Wire both into CI.

### H12. No code splitting — every heavy dep in the initial chunk — KNOWN-OPEN (07-12 §4, 08-02 §4.3)

Zero dynamic `import()` in client/shared. three.js, pdfjs-dist, mathlive, katex,
mathjs, and tldraw all land in one multi-MB initial bundle. Natural seams: pdfjs
inside `PdfProcessor` (only invoked on PDF drop), three.js on first graph3d
mount, mathlive on first equation edit; add `manualChunks` for tldraw/mathjs/katex.

---

## Medium

### Agent loop & prompting
- **M1. Runaway-stop erases the todos it advertises** (`AgentModeChart.ts:33-43`):
  the stop message says "N todos outstanding, tell me to keep going", then
  `idling.onEnter` resets todos — and `working.onEnter` resets them again on
  resume. The promised recovery path can't work. Preserve unfinished todos. — NEW
- **M2. User interrupt at the continuation-budget boundary is discarded**
  (`TldrawAgent.ts:393-396`): the budget check runs before the scheduled
  request's `source` is inspected; `stopRunawayLoop` then clears it. Check
  `source === 'user'` (and reset the counter) before the increment. — NEW
- **M3. Prompt assembly has irreversible side effects before the request succeeds**
  (`UserActionHistoryPartUtil.ts:22`, `CanvasLintsPartUtil.ts:31`): user-edit
  history is cleared and lints marked surfaced during prompt build; a failed or
  cancelled request loses them permanently. Commit consumption on stream success. — NEW
- **M4. Shapes straddling the agent's viewport edge are invisible to it**
  (`ScreenshotPartUtil.ts:20`, `BlurryShapesPartUtil.ts:22`): `Box.includes`
  (containment) instead of collision — a shape 90% in view is demoted to a
  peripheral "can't make out details" cluster. Use collision. — NEW
- **M5. The chat-origin offset system is inert** (`AgentChatOriginManager.ts`):
  `setOrigin` has no callers outside `loadState`, so the offset meant to keep
  coordinates small for the model is a zero vector unless the user clicks "new
  chat". Set origin on the first prompt of a conversation. — NEW
- **M6. Token waste**: schema embedded with `JSON.stringify(schema, null, 2)`
  (~30–50% token inflation, `buildSystemPrompt.ts:47-55`), rebuilt per request,
  and no prompt-caching breakpoints in the backend for the large static system
  block — multiplied by up to 13 requests per instruction, on the user's key.
  Compact + memoize + add cache-control for Anthropic. — NEW
- **M7. `preparePrompt` deep-clones the entire request once per part** (~18×,
  `TldrawAgent.ts:294-300`), and would throw `DataCloneError` if `data` ever
  holds a real Promise (its type allows it). Resolve once, pass frozen. — NEW
- **M8. `request()` clears a successor's active request** (`TldrawAgent.ts:462-480`):
  after `await`, `clearActiveRequest()` runs unconditionally — guard on identity. — NEW

### Security (no exploitable XSS/RCE found this pass; KaTeX, react-markdown, PDF rasterization all verified safe)
- **M9. postcss high advisory** in the lockfile (≤8.5.22, dev-only toolchain) —
  `npm audit fix`; add `npm audit --omit=dev --audit-level=high` and Dependabot
  to CI (advisories are currently found by hand). — NEW
- **M10. No CSP** (`index.html`): given `dangerouslySetInnerHTML` is core to the
  product and keys live in web storage, a CSP meta is cheap defense-in-depth
  (needs a fonts.googleapis.com exception or self-hosted Inter). — NEW
- **M11. mathjs freeze-DoS is now shareable**: pathological expressions
  (`factorial(99999999)`) freeze the tab on every render, persist, and recur on
  reload; previously accepted as self-inflicted (07-05 §1.6), but workspace
  *import* makes it deliverable via a crafted `.tutors.json`. Evaluate in a
  worker with a timeout, or a limited mathjs instance. — KNOWN, exposure changed
- **M12. Import persists before validating** (`WorkspaceManager.ts:178-187`):
  `persistState()` runs before `applyWorkspaceState`; a snapshot that fails
  tldraw's validators is already in IndexedDB and set current. Apply (or
  schema-validate) first, persist on success. — NEW
- **M13. Request-size cap bypassable and post-parse** (`backend/main.py:100-116`):
  only `text`/`image_url.url` fields are counted, and the body is fully parsed
  before validation/rate-limit run; uvicorn has no body cap. Enforce a
  Content-Length/body cap in middleware; measure serialized message size. — NEW

### Backend robustness
- **M14. `asyncio.CancelledError` swallowed** (`llm_service.py:142-149`): must
  re-raise; move `response.aclose()` to `finally` (covers `GeneratorExit` too). — NEW
- **M15. No provider timeouts**: `/api/test-key` (a UX ping) can hang the settings
  modal for litellm's ~600 s default; pass `timeout=10` there, ~120 s for chat. — NEW
- **M16. Per-chunk `json.loads` over the whole buffer** is O(chunks × length) —
  the exact cost `IncrementalJsonParser`'s docstring claims to avoid; the SSE
  emitter also re-sends the full current action per delta. Parse only on
  structural characters outside strings; throttle incomplete-action emission. — NEW
- **M17. Rate limiter keyed on direct socket IP** — one shared bucket behind any
  reverse proxy; undocumented. Handle forwarded headers behind a trusted proxy
  or document the constraint. — NEW

### UI correctness & performance
- **M18. Stale edit buffers can revert agent updates** (`GraphShapeUtil.tsx:602`,
  `VectorFieldShapeUtil.tsx:49`, `ComplexPlaneShapeUtil.tsx:54`): edit state is
  captured at mount and never synced to the prop; opening edit and pressing Enter
  writes the mount-time value back. `Graph3dShapeUtil` already has the fix
  (sync effect); match it, or commit only when actually edited. — NEW
- **M19. PDF processing renders all pages concurrently at 2× scale** with no
  progress UI and errors only to console (`PdfProcessor.ts:60-66`,
  `App.tsx:485-494`): a 100-page PDF spikes memory with zero feedback.
  Concurrency-limit, zero canvases after `toDataURL`, add progress + error toast. — NEW
- **M20. KaTeX + mathjs run unmemoized in the equation render body**
  (`EquationShapeUtil.tsx:147-181`) — the most common shape re-renders KaTeX on
  every store tick. `useMemo` on `[latex]` / `[latex, boundScope]`. — NEW
- **M21. Complex-plane domain colouring blocks the main thread** (~16,800
  compiled evaluations synchronously in an effect keyed on `w, h` — reruns
  continuously during resize; the `cancelled` flag can never fire mid-loop).
  Chunk across rAF or debounce dimensions. — NEW
- **M22. PDF popup lives in the camera-transformed layer** with viewport-pixel
  drag math (`PdfDocumentShapeUtil.tsx:339-357`) — pans/scales with zoom. Portal
  to body (the `PanelLayoutContext` portal exists for this). Rename input also
  writes `updateShape` per keystroke into undo history. — NEW
- **M23. `PanelLayoutContext` leaks**: portal div appended in a `useState`
  initializer (doubled under StrictMode, never removed); `useBottomPanel`
  registers during render and never unregisters, so unmounted panels reserve
  dock width forever (`PanelLayoutContext.tsx:68-77, 231-235`). — NEW
- **M24. Slider drags & MathLive keystrokes flood the store/undo history**
  (`GraphShapeUtil.tsx:922-933`, `EquationShapeUtil.tsx:235-243`) — each tick an
  undoable entry that triggers the full re-sample chain (H6). Squash history. — NEW
- **M25. Non-reactive reads in App** (`App.tsx:860, 603-608`): atom-backed
  workspace lists read outside `useValue`, so the UI only updates incidentally. — NEW

### Dependencies & config
- **M26. Outdated majors**: tldraw 4.5 → 5.3 (plan deliberately), pdfjs-dist
  4.10 → 6.x (security track record — prioritize), katex 0.16 → 0.18;
  `@types/three` sits in `dependencies`. — NEW
- **M27. tsconfig**: legacy `moduleResolution: "node"` (should be `"bundler"` for
  Vite), pointless `composite`/`declaration` emit to `.tsbuild` with no consumer
  (plain `noEmit` is faster), `noUncheckedIndexedAccess` off,
  `noUnusedLocals/Parameters` off. ~56 `any`-family escape hatches, concentrated
  in `AgentHelpers.ts` (16) — incl. `editor: any` props and `as any` shape-type
  casts across all five custom tools that defeat the shape typing the project
  relies on. — partly KNOWN-OPEN (08-02 §4.2)

---

## Low / hygiene

- Tracked `.pyc` files under `backend/tests/__pycache__/` — `.gitignore` patterns
  are top-level only; use `__pycache__/` + `*.py[cod]`, `git rm -r --cached`. — NEW
- `requirements-dev.txt` includes `-r requirements.txt`, dragging litellm into
  every CI test install despite its own comment saying the suite doesn't need it. — NEW
- Dead code: `forModes` mode-override machinery (zero call sites, registries
  always empty), `logSystemPrompt`/`logMessages` debug flags,
  `ModelNamePartUtil`/`getModelName` plumbing, `AlignAction.gap` (schema-only,
  ignored by apply — token waste + model confusion), `thinking` model config
  (KNOWN-OPEN 07-12), `inputRef`s never used, `GoToAgentButton` arrow rotation
  logically inverted so it never points anywhere. — NEW except noted
- `ensureShapeIdIsUnique` comment claims prefix-stripping it doesn't do →
  `shape:shape:foo` ids (`AgentHelpers.ts:301-306`). — NEW
- `AgentContextManager.remove` compares by reference against `structuredClone`d
  items — removal only works with the exact stored instance. — NEW
- User-action tracker appends full `[prev, next]` pairs per drag tick into a
  copied atom array — coalesce. — NEW
- CORS: `allow_credentials=True` + env-configurable origins (reject `*`, or drop
  credentials — header auth doesn't need them); `X-Model` unvalidated free text
  (allowlist regex); `/api/test-key` reports all failures as "invalid key"
  (distinguish `litellm.AuthenticationError`); SSE response missing
  `Cache-Control: no-cache` / `X-Accel-Buffering: no`. — NEW
- CI hygiene: no `concurrency` group, no pip cache, actions pinned by tag;
  no single command to run both servers (`concurrently` script); README omits
  backend test instructions. — NEW
- A11y: sliders without `aria-label`, BYOK/cheat-sheet modals without dialog
  semantics/focus trap/Escape, 4 `:focus` rules in 2,004 lines of CSS, no
  `prefers-reduced-motion` guard on infinite animations. — NEW
- Duplicated LaTeX→mathjs replacement chains in `latexToMathjs.ts` and
  `matrixFromLatex.ts`; the `\frac` regex fails on nested braces. — NEW
- Contradictory `AgentMessage.priority` docs vs. actual ascending sort. — NEW
- `Math.min(...zValues)` spread with `(resolution+1)²` args — agent-settable
  `resolution` can overflow the arg limit (`Graph3dShapeUtil.tsx:58-59`). — NEW
- WorkspaceTimelineView: passive-listener `preventDefault` no-op, ref read in
  render for cursor style, O(n²) `nodes.find` in layout. — NEW

---

## Previously-known items still open (register)

From 07-12 / 08-02, unchanged and not re-detailed above: live-model E2E never
run (last unchecked TODO Step 4 item); missing-key UX is a raw 400 toast; no
deployment story (Docker/compose); hardcoded 5-model catalog with no custom-id
field; stale TODO.md ("picking up from Step 3"); LICENSE.md still says "2024
tldraw Inc."; per-branch persistence keys + blob-backed PDF assets deferred;
mathlive 0.110 interactive click-through never done; remote branch
`claude/ai-pipeline-claude-style-ZhvDC` never deleted; archived-branch ideas
(tool-use API instead of schema-in-prompt; client-side auto-placement) never
revisited; `AgentModeManager.ts:51` TODO (fixed by H1's setMode change).

## Verified healthy (don't touch)

KaTeX/react-markdown/PDF-rasterization output paths (no XSS found), pdfjs
`isEvalSupported: false` hardening, key handling (headers only, never logged,
session-only option), the incremental backend emitter's `while`-cursor fix, the
continuation budget, chat-history trimming with pinned original prompt,
screenshot downscaling, diff revert on abort, WorkspaceManager's dirty-flag
IndexedDB persistence, `TldrawViewer`'s IntersectionObserver-gated mounting, and
`Graph3dGizmo3D`'s disposal tracking.

## Suggested order of attack

1. **C1** — one-line registration fix + startup assertion (restores the core feature).
2. **H1 + H2 + H4** — agent-loop resilience: finally-guarded prompting, action-failure
   feedback to the model, no blind retries. These three compound each other.
3. **H9 + H10** — backend: JSON mode + fence handling + non-dict guard; fix the
   litellm pin. Kills the "AI did nothing" failure mode.
4. **H3 + H5** — persistence throttling to IndexedDB; mount the UsageMeter.
5. **H6 + H7 + H8** — shape-render performance and leaks (compile-once, dispose,
   render-on-demand, hooks fix).
6. **H11 + H12** — vitest + eslint/ruff in CI; code-splitting. These prevent the
   next hundred bugs rather than fixing existing ones.
7. Security batch (M9–M13), then the remaining mediums opportunistically.
