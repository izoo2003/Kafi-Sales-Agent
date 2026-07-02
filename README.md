# Kafi Commodities — International Sales AI Agent

Monorepo with **`backend/`** (Python/FastAPI) and **`frontend/`** (React/Vite). Deploy each separately on Railway and Vercel by setting the root directory.

## Repository layout

```
Sales-Agent/
├── run.py                  # optional: start backend from repo root
├── README.md
│
├── backend/                # Python / FastAPI — all server code
│   ├── main.py
│   ├── run.py              # python run.py (migrate + start)
│   ├── config.py
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── docker-compose.yml
│   ├── .env.example
│   ├── api/
│   ├── modules/
│   ├── integrations/
│   ├── db/
│   ├── jobs/
│   ├── prompts/
│   └── storage/
│
└── frontend/               # React / Vite dashboard
    ├── package.json
    ├── .env.example
    └── src/
        ├── api/client.ts   # only place that knows backend URL
        ├── hooks/
        ├── pages/
        └── components/
```

## Dependency rule (backend)

```
api/  →  modules/  →  integrations/ + db/
```

## How backend and frontend connect

| Layer | Role |
|-------|------|
| Backend | REST at `/api/leads`, `/api/quotations`, `/api/interactions`, `/api/jobs` |
| Frontend | `frontend/src/api/client.ts` wraps all fetch calls |
| Local dev | Vite proxies `/api` → `http://localhost:8000` |
| Production | `frontend/.env`: `VITE_API_BASE_URL=https://your-backend.railway.app/api` |
| CORS | `backend/.env`: add Vercel URL to `CORS_ORIGINS` |

## Deploy

| Service | Platform | Root directory | Start command |
|---------|----------|----------------|---------------|
| Backend | Railway | `backend/` | `python run.py` |
| Frontend | Vercel | `frontend/` | `npm run build` |

## Quick start

### Backend

```bash
cd backend
cp .env.example .env
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

Or from repo root: `python run.py` (uses root launcher).

- API docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

- Dashboard: http://localhost:5173

## Migrations

`python run.py` runs `alembic upgrade head` automatically on every start. No manual migration needed unless you prefer to run it separately from `backend/`:

```bash
alembic upgrade head
```
