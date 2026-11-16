# SafeHer AI agent guide

## Project overview
This repository is a small full-stack starter for a women-safety app:

- Backend: FastAPI app in `backend/app/`
- Frontend: Vite + React app in `frontend/src/`
- Data and auth: PostgreSQL-compatible SQLAlchemy models, JWT auth, Twilio SMS flows

See [README.md](README.md) for the higher-level product requirements and deployment notes.

## Working conventions
- Keep backend route logic in `backend/app/main.py` and related modules under `backend/app/`.
- Prefer Pydantic request/response schemas in `backend/app/schemas.py` for validation.
- Keep environment configuration in `backend/app/config.py` and do not commit secrets.
- Frontend UI changes belong in `frontend/src/`; keep Vite app defaults unless a feature needs custom config.
- Maintain CORS compatibility with the frontend origin `http://localhost:5173` and `http://127.0.0.1:5173` when modifying backend middleware.

## Run and verify locally
### Backend
```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -r requirements.txt
# then configure backend/.env from the example file
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Set `VITE_API_URL=http://127.0.0.1:8000` in `frontend/.env` for local development.

## Important project-specific guidance
- The app expects a database URL, JWT secret, and Twilio credentials in the backend environment; this is configured through `backend/app/config.py`.
- The backend exposes API routes under `/api/...`; keep new endpoints consistent with the existing pattern in `backend/app/main.py`.
- The SOS flow is intentionally safety-focused and should never claim a real emergency service dispatch; any UX change should respect the limits described in [README.md](README.md).
- For SMS or live-location workflows, keep all real personal data behind approved consent and avoid production exposure until HTTPS/access controls are in place.

## Typical files to inspect first
- `backend/app/main.py` — API entry point and route definitions
- `backend/app/config.py` — environment variables and config
- `backend/app/database.py` — SQLAlchemy engine and session setup
- `backend/app/models.py` — database schema
- `frontend/src/App.jsx` — main UI behavior and API integration

## Before finishing work
- Confirm that any new environment variables are reflected in `backend/app/config.py` and documented in [README.md](README.md) if needed.
- Prefer the existing FastAPI and React patterns over introducing a second framework or state pattern.
- Validate with the smallest relevant command: backend startup, frontend build, or a targeted API check.
