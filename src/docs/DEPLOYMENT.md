# Deployment (Render / Vercel)

## Architecture
Ek web service (Docker ya Node) + Neon Postgres + managed Redis + S3-compatible storage.
WebSocket dono platforms par supported. Clients `transports: ['websocket']` use karte hain aur Redis adapter hai,
isliye sticky sessions ki zaroorat nahi. Multiple instances ke liye `REDIS_URL` set hona chahiye.

## Render
1. New > Web Service > repo `iamaniket-python/Messaging`, branch `backend`.
2. Runtime: Docker (repo ka `Dockerfile`) ya Node (`npm ci` build, start command neeche).
3. Start command (Node runtime ya Docker override): `npm run migrate && node src/server.js`
   (paid plan par migrate ko Pre-Deploy Command bana sakte ho).
4. Health Check Path: `/health`. Readiness `/ready` (DB + Redis) monitoring ke liye.
5. Redis: Render Key Value (ya Upstash). BullMQ ke liye eviction policy `noeviction`.
6. Env vars (Dashboard mein, repo mein kabhi nahi):

| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon DIRECT (non-pooled) URL, `?sslmode=require` |
| `REDIS_URL` | managed Redis URL |
| `JWT_ACCESS_SECRET` | random 48+ bytes |
| `CORS_ORIGINS` | exact frontend origin(s), comma separated (wildcard allowed nahi) |
| `TRUST_PROXY` | `1` (platform proxy ke peeche) |
| `S3_*`, `UPLOAD_MAX_BYTES`, `UPLOAD_URL_TTL_SECONDS` | storage config (S3 / R2 / MinIO) |

Secret generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Vercel
Same env vars. Vercel Postgres ki jagah Neon URL do. Redis plugin add karo. Start command same. Health check `/health`.

## Checklist
- Graceful shutdown: SIGTERM par socket close, presence/queue stop, Redis aur DB close (10s force-exit).
- Platform ka idle timeout < `SERVER_KEEP_ALIVE_MS` (default 65s) nahi hona chahiye warna random 502.
- S3 bucket par CORS: frontend origin se `PUT` aur `GET` allow karo (presigned upload browser se hota hai).
- Neon: direct URL use karo (migrations ke advisory lock ke liye pooled URL sahi nahi).
- Rollback: migrations forward-only hain. Destructive migration se pehle Neon branch/backup lo.
- Cleanup: stale `pending` attachments aur purani notifications ke liye optional scheduled job (abhi implemented nahi).