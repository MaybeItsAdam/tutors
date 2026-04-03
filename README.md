# Tutors

An infinite canvas where students and AI collaborate. This project extends the [tldraw agent](https://github.com/tldraw/tldraw) starter kit into a BYOK (Bring Your Own Key) tutoring platform.

## Architecture

The project is organized into several main areas:

- **`client/`** - React/Vite frontend containing the canvas and agent UI.
- **`backend/`** - FastAPI server for handling AI model communication (BYOK architecture).
- **`worker/`** - Cloudflare Worker for edge model requests and durable objects.
- **`server/`** - Local development server plugins.
- **`shared/`** - Shared types, schemas, and formats.

## Setup & Local Development

### Frontend
Install dependencies and run the Vite dev server:
```bash
npm install
npm run dev
```
The frontend will be available at `http://localhost:5173/`.

### Backend (FastAPI)
The backend provides BYOK-enabled HTTP and WebSocket endpoints. It requires Python.
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Or `.venv\Scripts\activate` on Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
The FastAPI backend will be available at `http://localhost:8000/`.

### Environment Variables
For the Cloudflare Worker/default agent flows, you can create a `.dev.vars` file in the root directory:
```
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GOOGLE_API_KEY=your_google_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```
*(Note: The FastAPI backend currently supports BYOK through request headers, so you can also input keys directly in the frontend UI).*

## Developing the Agent

The default agent configuration can:
- Create, update and delete shapes
- Draw freehand pen strokes
- Manipulate shapes (rotate, resize, align, distribute, stack)
- Write its thinking and send messages
- Maintain a todo list
- Move its viewport and count shapes

To customize the agent's behavior, edit `client/modes/AgentModeDefinitions.ts`. To change the system prompt, modify `worker/prompt/sections/`. To add new backend features, update `backend/main.py`.

## License

This project is built on the tldraw SDK, provided under the [tldraw SDK license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md). You can use the tldraw SDK in commercial or non-commercial projects so long as you preserve the "Made with tldraw" watermark on the canvas.
