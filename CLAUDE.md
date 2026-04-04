# BYOK AI Tutoring Whiteboard

This is an open-source, BYOK (Bring Your Own Key) AI tutoring platform centered around an infinite digital whiteboard where a user and an AI "spatial agent" collaborate.

## Tech Stack
- **Frontend**: Vite, React 19, TypeScript, Tailwind CSS, tldraw.
- **Backend (Python)**: FastAPI, Uvicorn, litellm, websockets.
- **Custom Shapes**:
  - `EquationShape`: Renders math via KaTeX.
  - `PdfDocumentShape`: Renders PDF multi-page docs via pdfjs-dist.

## Project Structure
- `/client`: Frontend Vite app representing the whiteboard and main UI.
- `/server`: Temporary NodeJS local development server bridging the Vite plugin logic originally adapted from a Cloudflare Worker structure.
- `/shared`: Shared type definitions between the frontend agentic system API and prompts.
- `/backend`: The Python FastAPI layer handling AI orchestration and WebSockets (Currently in-progress).

## Development Commands

**Frontend Server**:
Starts the Vite dev server at `http://localhost:7072/`. This server runs the tldraw UI and currently hosts the `/stream` integration in local TS before the Python backend is fully integrated.
```bash
npm install
npm run dev
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
- The agent loop relies on `shared/schema/AgentActionSchemas.ts` for strictly typing what the models can and cannot output to the Tldraw canvas.
- All actions are processed via `client/actions/`. If you define a new shape, define its `ActionUtil` there to handle exactly how the AI creates/modifies it upon generating an intent.
