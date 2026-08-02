# Codebase Audit — 2026-08-02

Audit of `MaybeItsAdam/tutors` at `e11131d`. This is the third audit of this repo
(see `2026-07-05-codebase-audit.md` and `2026-07-12-project-audit.md`); findings
already recorded there are **not** repeated unless the state has changed.

**What was checked:** `npm ci` + `tsc --noEmit` + `vite build` (all green),
`npm audit --omit=dev`, and a read of the agent loop, streaming pipeline, workspace
persistence, PDF ingestion, and prompt assembly.

**Verdict:** the earlier audits' remediation held — the build typechecks, CI runs
typecheck+build on every PR, PDF eval is disabled, the backend has provider
allowlisting, size caps and rate limiting. The issues below are mostly a different
class: **correctness under load and unbounded resource growth**. The highest-value
finding is a confirmed action-dropping bug in the backend stream parser. The next
two are cost/perf problems that only appear once a session runs for a while or a
real PDF is opened — exactly the conditions the not-yet-run end-to-end test
(2026-07-12 §2.1) would surface.

---

## 1. Correctness

### 1.1 HIGH — the backend silently drops agent actions when one chunk completes several

- **Where:** `backend/llm_service.py:69-90`.
- **What:** the emit loop advances the action cursor with `if len(actions) > cursor:`
  — an `if`, not a `while`. Each streamed chunk can therefore advance the cursor by
  at most one, and at end-of-stream everything past `cursor` is never emitted.
  When a single chunk carries the tail of one action plus one or more complete
  actions, those extra actions are dropped on the floor: never sent to the client,
  never applied to the canvas, and never surfaced as an error.
- **Confirmed** by replaying the cursor logic against a 4-action response split into
  two chunks (second chunk carrying actions b, c, d):

  ```
  emitted complete: [('complete-final', 'a')]   # expected a, b, c, d
  ```

  Actions `b`, `c`, `d` vanish.
- **When it bites:** short actions (`think`, `message`, `upsertTodoListItem` are all
  a few dozen bytes) plus a provider that batches deltas. Under fine-grained
  token-by-token streaming the cursor keeps up and the bug is invisible, which is
  why it has survived — the failure is provider- and timing-dependent, and presents
  to the user as "the model said it would do five things and only did the first."
- **Fix:** drain the queue rather than stepping once.

  ```python
  while len(actions) > cursor:
      if cursor > 0:
          prev_action = actions[cursor - 1]
          if prev_action:
              prev_action["complete"] = True
              prev_action["time"] = int(time.time() * 1000) - start_time
              yield f"data: {json.dumps(prev_action)}\n\n"
      maybe_incomplete_action = None
      cursor += 1
      start_time = int(time.time() * 1000)
  ```

  Worth a unit test — this is pure, synchronous logic with no I/O, so it is the
  cheapest possible test to write and the highest-value one in the repo.

### 1.2 LOW — MathLive auto-resize compares against a stale height

- **Where:** `client/shapes/equation/EquationShapeUtil.tsx:261-271`.
- The `ResizeObserver` closes over `shape.props.h` from first render, and the effect
  deliberately does not re-run on prop changes (`[editor, shape.id]`, to avoid cursor
  jumps). After the first resize the comparison `Math.abs(naturalH - shape.props.h) > 4`
  is measured against a height that no longer exists, so the guard stops guarding and
  every observer tick issues an `updateShape`. Read the current height off the editor
  inside the callback (`editor.getShape(shape.id)`) instead of the captured prop.

### 1.3 LOW — pruning a branch orphans its children

- **Where:** `client/agent/managers/WorkspaceManager.ts:539-562`.
- `pruneBranch` deletes the branch record but leaves any child branch's
  `parentBranchId` / `forkedFromSnapshotId` pointing at a branch that no longer
  exists. `WorkspaceTimelineView` renders from these links. Re-parent children to the
  deleted branch's parent, or refuse to prune a branch that has children.

---

## 2. Unbounded growth & cost

These three compound: a long session sends a bigger prompt each turn, may never
choose to stop, and rewrites the whole snapshot history to disk every 5 seconds
throughout.

### 2.1 HIGH — the continuation loop has no turn cap

- **Where:** `client/modes/AgentModeChart.ts:66-77`, driven by
  `TldrawAgent.prompt()`'s tail recursion (`TldrawAgent.ts:370`).
- `working.onPromptEnd` schedules another full request whenever any todo is not
  `done`, and only the model can mark a todo done. A model that keeps adding todos,
  or simply neglects to mark them, loops forever — each iteration a complete
  LLM request carrying a screenshot and the full chat history. `grep` for
  `maxTurn|iteration|budget|MAX_LOOP` across `client`, `shared` and `backend`
  returns nothing: **there is no cap anywhere in the codebase.**
- The parallel lint-continuation path immediately above it *is* bounded —
  `surfacedLintKeys` guarantees each lint re-prompts at most once
  (`CanvasLintsPartUtil.ts:31`). The todo path has no equivalent.
- This is a BYOK app: the runaway spend lands on the student's own API key, and
  the only stop is noticing and hitting cancel.
- **Fix:** count consecutive `source: 'self'` continuations on the agent, stop at
  ~10 with a `message` action explaining why, and reset the counter on each user
  prompt. Cheap, and it also bounds 2.2.

### 2.2 MEDIUM — full chat history is resent every turn, forever

- **Where:** `client/parts/ChatHistoryPartUtil.ts:13`, `AgentChatManager.push`.
- The history atom only ever grows (`push` appends; nothing trims), and the whole
  thing is cloned into every prompt. Cost per turn grows linearly with session
  length, and under 2.1 the turn count is unbounded — so worst-case spend is
  quadratic in a session that never terminates.
- **Fix:** cap the history part at the last N items (or a token budget), keeping
  the first user prompt for intent. The full history can stay in the UI and in
  persistence; this is only about what goes into the prompt.

### 2.3 MEDIUM — screenshots are sent at up to 8000px

- **Where:** `client/parts/ScreenshotPartUtil.ts:28-38`.
- The only bound is `largestDimension > 8000 ? 8000 / largestDimension : 1`. Every
  major vision model downsamples well below that (~1568px longest edge for Claude),
  so anything above it is pure upload and token cost for zero added detail, on every
  turn of the loop.
- **Fix:** lower the clamp to ~1568. Nothing else needs to change.

### 2.4 HIGH — workspace persistence rewrites the entire history every 5 seconds

- **Where:** `client/agent/managers/WorkspaceManager.ts:737-746`, `788-807`.
- `WORKING_STATE_SAVE_INTERVAL_MS = 5_000` fires `captureCurrentBranchWorkingState()`
  followed by `persistState()` unconditionally — **there is no dirty check**, so an
  idle tab with nothing on screen changing still does this twelve times a minute.

  Each tick:
  1. `captureWorkspaceState()` `structuredClone`s the full editor snapshot
     (`:641`), then `captureCurrentBranchWorkingState` clones that clone again
     (`:717`) — the second clone is redundant, the value is already private.
  2. `persistState()` writes **every workspace, every branch, and every snapshot**
     to a single IndexedDB key (`:791-797`) — not just the branch that changed.

- **Why the payload is large:** `WorkspaceSnapshot.state` embeds a whole
  `TLEditorSnapshot`, and PDF pages live in that snapshot as image assets whose
  `src` is a **base64 JPEG data URL** (`App.tsx:69-83`). With
  `MAX_AUTO_SNAPSHOTS_PER_BRANCH = 20` plus manual snapshots, a single 30-page PDF
  is duplicated across ~21 snapshots and the whole pile is re-serialized every 5
  seconds. This scales as (snapshots × branches × workspaces × canvas size) per
  tick and will hit the origin quota and stall the main thread on structured-clone
  long before the user does anything unusual.
- **Fix, in order of payoff:**
  1. Dirty-check — skip the tick entirely when the editor store hasn't changed
     since the last capture.
  2. Drop the double clone at `:717`.
  3. Split persistence per key (`…:workspace:<id>:branch:<id>`) so a working-state
     save writes one branch, not the world.
  4. Store PDF page images as `Blob`s in IndexedDB keyed by asset id rather than
     base64 inside every snapshot. Base64 also inflates the bytes by ~33% over the
     `Blob` the canvas already produced.

### 2.5 LOW — the stream parser rescans the whole buffer on every chunk

- **Where:** `backend/utils.py:close_and_parse_json`, called at
  `llm_service.py:65` once per chunk on the entire accumulated buffer.
- Each call walks the full buffer (with an inner backslash-counting scan) and then
  `json.loads` the full buffer — O(chunks × response length). At the 8192-token
  default (`MAX_COMPLETION_TOKENS`) that is on the order of 10^8 character
  operations per response, all on the event loop thread, blocking every other
  request the backend is serving.
- **Fix:** track the scan position and brace/quote stack incrementally across calls
  instead of restarting from index 0 each time. Worth doing together with 1.1,
  since both live in the same loop.

### 2.6 LOW — the rate-limiter map never evicts

- **Where:** `backend/main.py:66`, `_request_times: dict[str, deque]`.
- `defaultdict` entries are created per client IP and never removed, so the map
  grows for the process lifetime. Harmless on localhost (the stated target), but it
  is a slow leak the moment this is exposed to more than one machine. Sweep entries
  whose deque is empty when the window rolls.

---

## 3. Security

### 3.1 MEDIUM — MathLive XSS advisory, in an app that keeps API keys in the same origin

- `npm audit --omit=dev` reports **2 vulnerabilities (1 low, 1 moderate)**:
  - `mathlive <=0.109.2` — **GHSA-fm7p-gw32-828p**, lack of HTML escaping allows
    XSS. Fixed in `0.110.0` (a semver-major bump from the pinned `^0.109.1`).
  - `dompurify <=3.4.11` — GHSA-c2j3-45gr-mqc4, `CUSTOM_ELEMENT_HANDLING` bypasses
    `afterSanitizeElements`. Transitive via mathlive; `npm audit fix` resolves it.
- **Why it matters here specifically:** MathLive is the editor for `EquationShape`
  (`EquationShapeUtil.tsx:14,288`), and equation LaTeX is *model-authored* —
  `EquationActionUtil` writes it straight from the stream. So the untrusted input
  path into the vulnerable component is the app's main feature, not an edge case.
  Per the 2026-07-05 audit §1.2 the user's API keys sit in plaintext
  `localStorage` in that same origin, so this is the same key-theft chain that made
  the pdfjs finding HIGH — only the entry point moved.
- **Fix:** upgrade to `mathlive@^0.110.0` and re-verify the `math-field` integration
  in `MathLiveEditor` (the component is already accessed untyped via
  `@ts-expect-error`, so the compiler will not catch a breaking API change — this
  needs a manual click-through of equation editing).

### 3.2 Note — KaTeX render path re-verified, still safe

`katex.renderToString` is called with default `trust: false` and
`throwOnError: false` (`EquationShapeUtil.tsx:158,177`) before the result reaches
`dangerouslySetInnerHTML` (`:201,206`). That remains correct. Note that `subHtml`
interpolates computed numbers only (`:170-175`), not raw model text.

---

## 4. Engineering practice

### 4.1 MEDIUM — still zero tests, and no linter

Carried forward from 2026-07-12 §2.4, restated because finding 1.1 is the
argument for it: a pure-function bug in ~25 lines of synchronous Python survived
two audits and would have been caught by one test case. There is no `eslint`,
`prettier`, `vitest`, `jest`, or `ruff` config anywhere in the repo.

Highest-value-first, without building a test culture from scratch:

1. `backend/utils.py` + the emit loop in `llm_service.py` — pure, no I/O, and
   where 1.1 lives. `pytest`, one file.
2. `shared/format/convert*` — pure shape transforms, ~1100 lines currently
   unexercised.
3. `close_and_parse_json` against truncated/adversarial JSON.

CI (`.github/workflows/ci.yml`) is well-built for what it does but only runs
typecheck, build, and `python -m compileall`. `compileall` verifies syntax, not
behaviour. Adding `pytest` and `npm audit --omit=dev --audit-level=high` to the
existing jobs is a small diff.

### 4.2 LOW — 56 `any` / `@ts-expect-error` escape hatches

`grep` counts 56 occurrences across `client` and `shared`. Typecheck is green, but
several sit on exactly the boundaries where runtime shape errors are likely —
`MathLiveEditor({ shape, editor }: { shape: IEquationShape; editor: any })`
(`EquationShapeUtil.tsx:220`) types away the whole editor API, and the stream
handler parses to `any` before an unchecked cast to `Streaming<AgentAction>`
(`TldrawAgent.ts:801,814`). The stream cast is the notable one: schema validation
happens later, inside `editor.run`, and only for `action.complete` actions
(`TldrawAgent.ts:631-637`) — so a malformed incomplete action reaches
`sanitizeAction` unvalidated.

### 4.3 LOW — single 4.98 MB JS chunk

`vite build` emits `index-*.js` at **4,976 kB (1,435 kB gzip)** as one chunk, with
the Rollup size warning. tldraw, three.js, mathlive, katex and react are all in it,
and every user pays for three.js on first paint whether or not they ever place a 3D
graph. The heavy, feature-gated shapes are natural `React.lazy` / dynamic-import
boundaries: `Graph3dShapeUtil` (three.js), `MathLiveEditor` (mathlive, only needed
while editing). pdfjs is already correctly split out as a worker.

---

## 5. Prioritized recommendations

| # | Finding | Severity | Effort |
| --- | --- | --- | --- |
| 1 | `while` not `if` in the stream cursor (1.1) — dropped actions | HIGH | Trivial |
| 2 | Cap consecutive self-continuations (2.1) — runaway BYOK spend | HIGH | Small |
| 3 | Dirty-check + per-branch keys for workspace persistence (2.4) | HIGH | Medium |
| 4 | Upgrade `mathlive` to ≥0.110.0 (3.1) | MEDIUM | Small + manual retest |
| 5 | Bound chat history in the prompt (2.2) | MEDIUM | Small |
| 6 | Clamp screenshots to ~1568px (2.3) | MEDIUM | Trivial |
| 7 | `pytest` on `backend/utils.py` + emit loop, wired into CI (4.1) | MEDIUM | Small |
| 8 | Incremental JSON scan (2.5) | LOW | Medium |
| 9 | Lazy-load three.js and mathlive (4.3) | LOW | Medium |
| 10 | Stale `ResizeObserver` height (1.2), branch orphaning (1.3), rate-limiter eviction (2.6) | LOW | Trivial each |

Items 1, 6 and the 2.4 double-clone are each a few lines and together remove a
correctness bug and a per-turn cost multiplier — a sensible first commit.

## 6. Verified green

- `npx tsc --noEmit` — clean, no errors.
- `npm run build` — succeeds in ~40s.
- CI runs typecheck + build on every PR, with npm retry logic for flaky registry
  fetches.
- Backend provider allowlisting, request size caps, rate limiting, generic error
  messages on the stream, and `isEvalSupported: false` on PDF parsing are all
  present and correct as described in the previous audits' remediation.
- The `/ws/chat` endpoint flagged in 2026-07-05 §1.3 is gone.
- `ClearActionUtil` is deliberately excluded from the working mode's action list
  with a comment explaining why — good defensive call, since agent edits bypass
  the undo stack.
