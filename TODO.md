# Project TODOs: BYOK AI Whiteboard

Steps 1-4 are complete and operational: the Vite frontend, tldraw canvas, the
custom maths shapes (KaTeX equations with a MathLive editor, 2D/3D plots,
vector fields, complex-plane colouring), PDF ingestion, the Python FastAPI
relay with BYOK headers, the full client-side agent system (actions, prompt
parts, modes, todo loop with a 12-continuation budget), workspaces with
branches/snapshots persisted to IndexedDB, and `.tutors.json` export/import.

An audit-remediation series is in flight — see
`docs/audit/2026-08-06-codebase-audit.md` for the findings and the PR sequence
covering agent-loop resilience, backend stream hardening, shape performance,
persistence, code splitting, and this test/lint infrastructure.

## Open items

- [ ] **End-to-end live-model test** — the loop has never been exercised
      against a live provider end to end: drop a PDF, point the context at it,
      and have the agent draw equation shapes reviewing it. (The audit PRs add
      stubbed integration tests; this is the real-key complement, partially
      covered by the per-provider smoke test required before the backend
      hardening PR merges.)
- [ ] **Deployment story** — no Dockerfile/compose; localhost two-terminal dev
      only. Needs a decision on whether the relay is ever deployed shared
      (which raises the open-relay and rate-limit-keying questions documented
      in the audit).
- [ ] **Model catalog** — `shared/models.ts` hardcodes five dated model ids
      that will rot; add a custom-model-id field in the BYOK settings.
- [ ] **Missing-key UX** — prompting without a key surfaces a raw 400 toast;
      guard client-side and route to the settings modal instead.
- [ ] **MathLive interactive click-through** — the 0.110 semver-major bump was
      never manually QA'd through the equation-editing flow.
- [ ] **Per-branch persistence keys + blob-backed PDF assets** — deferred from
      the 08-02 audit; PDF pages are stored as data URLs inside snapshots.
- [ ] **Handwriting-to-math** — draw-to-equation AI pass (the one genuinely
      open idea from the original Step 5 list).
- [ ] **LICENSE.md** — still says "Copyright (c) 2024 tldraw Inc."; needs a
      conscious decision (dual attribution vs. project-owner line with a
      retained tldraw notice).
