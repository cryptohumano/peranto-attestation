# peranto-attestation

Servicio **attester** (sibling de `dids-vc-ecotesting`): emite JWT-VC
`LivenessCheck` / `ProofOfResidence`, DomainLinkage, webhook Didit y **SPA** de verificación (Vite + React + Tailwind v4).

## Quick start

```bash
cd /home/edgar/peranto-attestation
cp .env.example .env
npm install
npm run web:build
npm run dev            # API + SPA en :8787
```

Túnel: `PUBLIC_ORIGIN=https://attest.peranto.app` + `cloudflared tunnel run peranto-attestation`.

| URL | Uso |
|-----|-----|
| https://attest.peranto.app/ | Verify (Aura → Didit → VC) |
| https://attest.peranto.app/ops | Operador (health + webhook) |
| `/health` | JSON health |
| `/webhooks/didit` | Didit HMAC |

### Env Didit

```bash
DIDIT_API_KEY=
DIDIT_WEBHOOK_SECRET=
DIDIT_WORKFLOW_ID=   # UUID del workflow sandbox (el de tu prueba Approved)
```

Sin `DIDIT_WORKFLOW_ID`, el botón «Iniciar verificación Didit» fallará.

### UI local

`npm run web:dev` (:5175). Si `ENOSPC` (inotify), usa solo `web:build` + Express.
