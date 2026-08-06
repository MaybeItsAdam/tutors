# BYOK AI Tutoring Whiteboard

This is an open-source, BYOK (Bring Your Own Key) AI tutoring platform centered around an infinite digital whiteboard where a user and an AI "spatial agent" collaborate.

## Tech Stack
- **Frontend**: Vite, React 19, TypeScript, Tailwind CSS, tldraw.
- **Backend (Python)**: FastAPI, Uvicorn, litellm.
- **Custom Shapes** (`client/shapes/`):
  - `EquationShape`: Renders math via KaTeX (edited with MathLive).
  - `GraphShape`: 2D function plots via mathjs.
  - `Graph3dShape`: 3D surface plots via three.js.
  - `VectorFieldShape` / `ComplexPlaneShape`: further mathjs-driven visualisations.
  - `PdfDocumentShape`: Renders PDF multi-page docs via pdfjs-dist.

## Project Structure
- `/client`: Frontend Vite app — the whiteboard, main UI, and the whole agent system (`client/agent/` with `TldrawAgent` + managers).
- `/shared`: Type definitions, zod action schemas, and shape formats shared across the client agent system.
- `/backend`: The Python FastAPI layer that relays chat requests to LLM providers via litellm. Keys arrive as request headers (`X-API-Key`, `X-Provider`, `X-Model`); nothing is stored server-side.

## Development Commands

**Frontend Server**:
Starts the Vite dev server at `http://localhost:7072/`.
```bash
npm install
npm run dev
```

**Typecheck** (CI runs this on every PR — keep it green):
```bash
npm run typecheck
```

**Python Backend**:
Starts the FastAPI application at `http://localhost:8000/`.
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Backend tests** (CI runs these on every PR — keep them green):
```bash
pip install -r backend/requirements-dev.txt
python -m pytest backend/tests -q
```
The suite covers `backend/utils.py` (incremental JSON parsing of a streaming
response), `backend/action_stream.py` (turning that stream into agent
actions), and `backend/llm_service.py` (the stream loop, with
`litellm.acompletion` monkeypatched to a fake async stream). Everything runs
offline - no network, no keys.

## Important System Prompts / Architecture Notes
- The AI is NOT a chatbox. The chat UI merely initiates interactions; the AI outputs structured JSON shapes directly to the canvas spatial environment (e.g., drawing `EquationShape` instances).
- The agent loop relies on `shared/schema/AgentActionSchemas.ts` for strictly typing what the models can and cannot output to the Tldraw canvas. Completed actions are validated against these schemas at stream time in `TldrawAgent`.
- All actions are processed via `client/actions/`. If you define a new shape, define its `ActionUtil` there to handle exactly how the AI creates/modifies it upon generating an intent. An action only reaches the model once it is (a) exported from `AgentActionSchemas.ts`, (b) registered via `registerActionUtil`, and (c) listed in the mode's `actions` array in `AgentModeDefinitions.ts`.
- The AI creates maths shapes through dedicated actions, not `create`: `equation` for LaTeX, and `plot` for all four visualisations (`graph`, `surface`, `vectorfield`, `complexplane`). Custom shapes are described back to the model as `unknown` shapes carrying a `text` summary, which is how the agent reads maths already on the canvas.
- The system prompt is assembled in `client/prompt/` from modular sections plus the JSON schema for the current mode's actions. Sections are gated on flags derived from the enabled actions/parts (`getSystemPromptFlags.ts`), so guidance for an action must be flagged on that action.
- The agentic loop is bounded: the agent may schedule at most `MAX_CONSECUTIVE_CONTINUATIONS` (12) self-directed follow-ups before it has to stop and hand back to the user. The counter resets on each user prompt. Without this the todo-driven loop has no termination condition, and it bills the user's own key.
- Workspace/branch/snapshot state persists to IndexedDB (`client/utils/kvStore.ts`); the live canvas is separately persisted by tldraw's own `persistenceKey` store. Working state saves on a timer but only when something actually changed — snapshots embed the whole canvas, PDF pages included, so unconditional saving was very expensive.
- Workspaces can be exported to and imported from `.tutors.json` files (`client/utils/workspaceExport.ts`). Imports must be re-identified before being handed to `WorkspaceManager.importWorkspace`, or they collide with existing ids.
- The backend reports token usage and estimated cost as a terminal `usage` event on the action stream; `AgentUsageManager` accumulates it and `UsageMeter` displays it.
