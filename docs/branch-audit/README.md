# Branch audit — 2026-07-05

## Summary

Audited all branches on `MaybeItsAdam/tutors`. One loose (unmerged, PR-less)
branch was found: `claude/ai-pipeline-claude-style-ZhvDC`.

| Branch | State | Resolution |
| --- | --- | --- |
| `main` | default branch | — |
| `claude/ai-pipeline-claude-style-ZhvDC` | 1 commit ahead, 4 behind; no PR; unmergeable | Superseded — work archived here as a patch; branch safe to delete |

All previous PR head branches (#1–#4: `copilot/add-math-tool-to-tldraw-bar`,
`copilot/add-pdf-upload-functionality`, `copilot/create-workspaces-with-snapshots`,
`claude/snapshots-canvas-preview-PayLb`) were merged and already deleted from
the remote — nothing loose there.

## Why `claude/ai-pipeline-claude-style-ZhvDC` is superseded

Its single commit (`381aca7`, 2026-04-06, "feat: switch AI pipeline to tool use
(Claude Code style) with client-side auto-placement") targets an architecture
that no longer exists on `main`:

- It modifies `server/AgentService.ts` and `server/prompt/*` — the entire
  `server/` and `worker/` trees were deleted on `main` when the agent system
  was rewritten client-side (`client/agent/` with `TldrawAgent` + managers).
- A test merge produces content conflicts in `backend/llm_service.py` and
  `shared/schema/*`, and modify/delete conflicts that would resurrect the
  deleted server code.

## What the branch contained that `main` still lacks

Two ideas from the commit were never carried into the new architecture and may
be worth re-implementing there (see the patch in this directory for reference):

1. **Tool-use API instead of schema-in-prompt JSON** — `backend/llm_service.py`
   on `main` still forces JSON generation via the prompt rather than passing
   litellm `tools` / `tool_choice` and accumulating tool-call deltas.
2. **Client-side auto-placement** — `client/actions/computeAutoPlacement.ts`
   placed new shapes near context items / selection / viewport centre when the
   model omits x/y, so the model decides *what* to create and the client
   decides *where*.

## How to finish the cleanup

The remote branch could not be deleted from this automated session (pushes are
restricted to the session's own branch). With the work archived here, delete it
losslessly via the GitHub UI (Branches page → delete) or:

```bash
git push origin --delete claude/ai-pipeline-claude-style-ZhvDC
```

To recover the archived work later:

```bash
git am docs/branch-audit/ai-pipeline-claude-style-ZhvDC.patch
```
