# Peranto Attest (web)

Vite + React + Tailwind v4 + shadcn-style UI for the attester.

## Dev

```bash
# terminal 1 — API (:8787)
cd /home/edgar/peranto-attestation && npm run dev

# terminal 2 — UI (:5175, proxies /health /v1 /webhooks)
cd /home/edgar/peranto-attestation && npm run web:dev
```

Open http://localhost:5175

With Cloudflare tunnel, build and serve from Express:

```bash
npm run web:build
npm run dev   # serves web/dist at PUBLIC_ORIGIN
```

## Env (API)

```bash
DIDIT_API_KEY=
DIDIT_WEBHOOK_SECRET=
DIDIT_WORKFLOW_ID=   # e.g. from sandbox Approved webhook
PUBLIC_ORIGIN=https://attest.peranto.app
```

## Routes

| Path | Uso |
|------|-----|
| `/` | Verify: Aura → Didit → issue Liveness |
| `/ops` | Operador: health + último webhook |
