# CHA-08 Event Landing Page — Smarter Revenue, Better Tech

Elev8 Suite × Canggu Hospitality Association · 28 Aug 2026

## Stack
Node 18+ / Express. Registrations stored as JSONL (append-only) in `DATA_DIR`.

## Environment variables
- `ADMIN_KEY` (required): protects /admin and /admin.csv
- `DATA_DIR` (optional): storage path, default ./data — mount a Railway volume here
- `PORT`: provided by Railway automatically

## Endpoints
- `/` — landing page with registration form
- `POST /api/rsvp` — registration (honeypot + duplicate guard included)
- `/admin?key=ADMIN_KEY` — registrations table
- `/admin.csv?key=ADMIN_KEY` — CSV export
- `/health` — healthcheck
- `/img/:name` — speaker photos and logos served from assets-b64/

## Railway
1. Deploy this repo (nixpacks auto-detects Node)
2. Set `ADMIN_KEY` env var
3. Add a volume mounted at `/data` and set `DATA_DIR=/data` (keeps registrations across deploys)
4. Add custom domain `cha-08.elev8-suite.com` (CNAME in your DNS)
