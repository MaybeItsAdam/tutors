# Project TODOs: BYOK AI Whiteboard

You are picking up from the end of Step 3. The Vite frontend, tldraw canvas scaffolding, KaTeX mathematical shapes (EquationShape), and PDF ingestion pipeline (PdfDocumentShape) are complete and operational.

Your primarily goal now involves **Step 4: AI Communication Layer**, wiring up the Python backend, LLMs, and the BYOK UI.

## Immediate Next Steps (Step 4)

- [x] **BYOK Configuration UI**
  - Create a settings modal on the frontend where the user can input LLM API keys.
  - Create a `BYOKStore` utility utilizing `localStorage` to securely persist the API keys locally.
  - Inject the API keys via headers (`X-API-Key`, `X-Provider`, `X-Model`) on all network requests.

- [x] **Python FastAPI Backend Core**
  - Implement the chat schema endpoints inside `/backend/main.py`.
  - Provide a `/api/chat` generic endpoint.
  - *(Pending)* Implement a `/ws/chat` WebSocket endpoint for low-latency streaming interactions.

- [x] **AI Orchestration (`litellm`)**
  - Create `/backend/llm_service.py` to route the AI requests using Litellm depending on the provider chosen by the user (OpenAI, Anthropic, Gemini).
  - Port over the robust prompt-building logic entirely into the Vite client in `client/prompt/buildMessages.ts`, seamlessly formatting direct `OpenAI` format LLM structures.

- [x] **Client Networking rewiring**
  - Re-routed `TldrawAgent` payload transmission native to `http://localhost:8000/api/chat` dropping the Vite dev proxy entirely!

- [ ] **End-to-End Testing**
  - Conduct an end-to-end integration test by dropping a PDF onto the canvas, pointing the whiteboard context to it, and interacting with a live model context to have the spatial AI agent draw `EquationShape` blocks intelligently reviewing your input.

## Future Steps (Step 5+)

- [ ] **User Native Math Input via UI**
  - We need to add the capability for the user to easily and natively write mathematical formulas on the board.
  - *Idea 1*: Add an 'Equation Tool' to the `tldraw` toolbar. Clicking it places an empty `EquationShape` that the user can double-click to type raw LaTeX.
  - *Idea 2*: Integrate a visual math keyboard (e.g. MathLive) that pops up when editing an `EquationShape` so users don't need to know raw LaTeX syntax.
  - *Idea 3*: Support handwriting-to-math using a native draw-to-equation AI pass.
