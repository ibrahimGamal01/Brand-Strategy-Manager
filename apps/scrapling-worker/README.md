# Scrapling Worker (BAT)

This service provides additive web-intelligence fetch/crawl/extract endpoints for the backend.

## Endpoints
- `GET /health`
- `POST /v1/fetch`
- `POST /v1/crawl`
- `POST /v1/extract`

## Run locally
```bash
cd apps/scrapling-worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8787
```

## Backend wiring
Set in backend env:

```env
SCRAPLING_WORKER_URL=http://localhost:8787
SCRAPLING_TIMEOUT_MS=20000
```

If `SCRAPLING_WORKER_URL` is not set, the backend uses a lightweight HTTP fallback mode.
