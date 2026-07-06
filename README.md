# Tutors

An infinite canvas where students and AI collaborate. This project extends the [tldraw agent](https://github.com/tldraw/tldraw) starter kit into a BYOK (Bring Your Own Key) tutoring platform.

## Architecture

The project is organized into three main areas:

- **`client/`** - React/Vite frontend containing the canvas, the agent system (`client/agent/`), custom shapes, and the agent UI.
- **`backend/`** - FastAPI server that relays chat requests to LLM providers via litellm (BYOK architecture — keys come from the browser as request headers, nothing is stored server-side).
- **`shared/`** - Types, zod action schemas, and shape formats shared across the client's agent system.

## Setup & Local Development

### Frontend
Install dependencies and run the Vite dev server:
```bash
npm install
npm run dev
```
The frontend will be available at `http://localhost:7072/`.

Type-check with:
```bash
npm run typecheck
```

### Backend (FastAPI)
The backend provides the BYOK-enabled streaming chat endpoint. It requires Python.
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Or `.venv\Scripts\activate` on Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
The FastAPI backend will be available at `http://localhost:8000/`.

### API keys

API keys are entered in the app itself (the ⚙️ BYOK settings in the chat panel) and sent to the local backend as request headers on each request. They are stored unencrypted in your browser (localStorage, or sessionStorage if you choose session-only) — avoid saving keys on shared computers.

Optional backend configuration goes in a `.env` file (see `.env.example`):
```
ALLOWED_ORIGINS=http://localhost:7072,http://127.0.0.1:7072
```

## Developing the Agent

The default agent configuration can:
- Create, update and delete shapes (including LaTeX equations)
- Draw freehand pen strokes
- Manipulate shapes (rotate, resize, align, distribute, stack)
- Write its thinking and send messages
- Maintain a todo list
- Move its viewport and count shapes

To customize the agent's behavior, edit `client/modes/AgentModeDefinitions.ts`. To change the system prompt, modify `client/prompt/sections/`. To add or change what the agent can output, update the schemas in `shared/schema/AgentActionSchemas.ts` and the matching `ActionUtil` in `client/actions/`. To add new backend features, update `backend/main.py`.

## License

This project is built on the tldraw SDK, provided under the [tldraw SDK license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md). You can use the tldraw SDK in commercial or non-commercial projects so long as you preserve the "Made with tldraw" watermark on the canvas.
