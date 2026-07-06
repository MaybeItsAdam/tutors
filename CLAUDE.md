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

## Important System Prompts / Architecture Notes
- The AI is NOT a chatbox. The chat UI merely initiates interactions; the AI outputs structured JSON shapes directly to the canvas spatial environment (e.g., drawing `EquationShape` instances).
- The agent loop relies on `shared/schema/AgentActionSchemas.ts` for strictly typing what the models can and cannot output to the Tldraw canvas. Completed actions are validated against these schemas at stream time in `TldrawAgent`.
- All actions are processed via `client/actions/`. If you define a new shape, define its `ActionUtil` there to handle exactly how the AI creates/modifies it upon generating an intent.
- The system prompt is assembled in `client/prompt/` from modular sections plus the JSON schema for the current mode's actions.
- Workspace/branch/snapshot state persists to IndexedDB (`client/utils/kvStore.ts`); the live canvas is separately persisted by tldraw's own `persistenceKey` store.
