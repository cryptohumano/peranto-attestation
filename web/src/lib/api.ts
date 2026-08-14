export type Health = {
  ok: boolean;
  serviceDid: string;
  attester: string;
  deployer?: string | null;
  network: string;
  origin: string;
  anchor: boolean;
  autoIssue?: boolean;
  ttl: { livenessSeconds: number; residenceSeconds: number };
  queueSize?: number;
  opsAllowlist?: string[];
  curatorAllowlist?: string[];
  policy?: {
    minScoreBps: number;
    allowlist: string[];
    allowlistRoot: string;
  };
  schemasKnown?: string[];
  addresses?: Record<string, string | undefined>;
};

export type DiditLast = {
  receivedAt: string;
  webhook_type: string | null;
  status: string | null;
  session_id: string | null;
  vendor_data: string | null;
  workflow_id: string | null;
  decisionPresent: boolean;
  liveness_checks: Array<{
    status?: string;
    score?: number;
    method?: string;
  }>;
  poa_verifications: Array<{
    status?: string;
    country?: string;
    region?: string;
    document_type?: string;
  }>;
  id_verifications: Array<{ status?: string; document_type?: string }>;
  mapHint?: Record<string, string | null>;
  signature?: string;
};

export type IssuedArtifact = {
  kind: "liveness" | "residence";
  credHash: string;
  jwt: string;
  schemaKey: string;
  claimsCommitment?: string;
  commitmentSalt?: string;
  validUntil?: number;
  anchored: boolean;
  issuedAt: string;
  auto: boolean;
};

export type QueueItem = {
  sessionId: string;
  subjectDid: string | null;
  status: string | null;
  workflowId: string | null;
  updatedAt: string;
  summary: DiditLast;
  issued: IssuedArtifact[];
  autoIssueError?: string | null;
};

const OPS_TOKEN_KEY = "peranto_ops_token";
const CURATOR_TOKEN_KEY = "peranto_curator_token";

export function getOpsToken() {
  return sessionStorage.getItem(OPS_TOKEN_KEY);
}

export function setOpsToken(token: string | null) {
  if (!token) sessionStorage.removeItem(OPS_TOKEN_KEY);
  else sessionStorage.setItem(OPS_TOKEN_KEY, token);
}

export function getCuratorToken() {
  return sessionStorage.getItem(CURATOR_TOKEN_KEY);
}

export function setCuratorToken(token: string | null) {
  if (!token) sessionStorage.removeItem(CURATOR_TOKEN_KEY);
  else sessionStorage.setItem(CURATOR_TOKEN_KEY, token);
}

function authHeaders(token: string | null): HeadersInit {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function readJson(r: Response) {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

export async function fetchHealth(): Promise<Health> {
  const r = await fetch("/health");
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json();
}

export async function fetchDiditLast(useful = true): Promise<DiditLast | null> {
  const r = await fetch(`/webhooks/didit/last${useful ? "?useful=1" : ""}`, {
    headers: authHeaders(getOpsToken()),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`didit/last ${r.status}`);
  return r.json();
}

export async function fetchQueue(): Promise<QueueItem[]> {
  const r = await fetch("/v1/queue", { headers: authHeaders(getOpsToken()) });
  if (!r.ok) throw new Error(`queue ${r.status}`);
  const data = await r.json();
  return data.items as QueueItem[];
}

export async function fetchHolderIssued(did: string) {
  const r = await fetch(`/v1/holder/issued?did=${encodeURIComponent(did)}`);
  if (!r.ok) throw new Error(`holder/issued ${r.status}`);
  const data = await r.json();
  return data.items as Array<{
    sessionId: string;
    status: string | null;
    issued: IssuedArtifact[];
    autoIssueError?: string | null;
  }>;
}

export async function createDiditSession(subjectDid: string) {
  const r = await fetch("/v1/didit/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subjectDid }),
  });
  return readJson(r) as Promise<{
    session_id: string;
    url: string;
    vendor_data: string;
    workflow_id: string;
  }>;
}

export async function issueDemo(
  subjectDid: string,
  kind: "liveness" | "residence",
  sessionId?: string
) {
  const r = await fetch("/v1/issue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subjectDid, kind, sessionId }),
  });
  return readJson(r);
}

export async function issueFromQueue(
  sessionId: string,
  kind: "liveness" | "residence" = "liveness"
) {
  const r = await fetch(`/v1/queue/${sessionId}/issue`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(getOpsToken()),
    },
    body: JSON.stringify({ kind }),
  });
  return readJson(r);
}

export async function revokeCredential(credHash: string, reason?: string) {
  const r = await fetch("/v1/revoke", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(getOpsToken()),
    },
    body: JSON.stringify({ credHash, reason }),
  });
  return readJson(r) as Promise<{ ok: boolean; txHash: string }>;
}

export async function opsChallenge() {
  const r = await fetch("/v1/ops/challenge", { method: "POST" });
  return readJson(r) as Promise<{
    challengeId: string;
    message: string;
    expiresAt: string;
  }>;
}

export async function opsLogin(challengeId: string, signature: string) {
  const r = await fetch("/v1/ops/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId, signature }),
  });
  const data = await readJson(r);
  setOpsToken(data.token);
  return data as { token: string; address: string; expiresAt: string };
}

export async function curatorLogin(challengeId: string, signature: string) {
  const r = await fetch("/v1/curator/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId, signature }),
  });
  const data = await readJson(r);
  setCuratorToken(data.token);
  return data as { token: string; address: string; expiresAt: string };
}

export async function opsLogout() {
  await fetch("/v1/ops/logout", {
    method: "POST",
    headers: authHeaders(getOpsToken()),
  }).catch(() => undefined);
  setOpsToken(null);
}

export async function registerSchema(kind: "liveness" | "residence") {
  const r = await fetch("/v1/ops/schemas/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(getOpsToken()),
    },
    body: JSON.stringify({ kind }),
  });
  return readJson(r);
}

export async function ensureAttester(kinds?: string[]) {
  const r = await fetch("/v1/ops/attester/ensure", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(getOpsToken()),
    },
    body: JSON.stringify({ kinds: kinds ?? ["liveness", "residence"] }),
  });
  return readJson(r);
}

export async function fetchAttesterStatus() {
  const r = await fetch("/v1/ops/attester/status", {
    headers: authHeaders(getOpsToken()),
  });
  return readJson(r) as Promise<{
    attester: string;
    anchor: boolean;
    authorized: { liveness: boolean; residence: boolean };
  }>;
}

export type OpsSchemaRow = {
  id: string;
  schemaKey: string;
  schemaId: string;
  schemaHash?: string | null;
  uri?: string | null;
  publisher?: string | null;
  registerTx?: string | null;
  onChain: boolean;
  authorized: boolean;
  source: string;
};

export type OpsDeployment = {
  network: string;
  deployer?: string | null;
  schemaRegistry: string;
  attesterRegistry: string;
  credentialStatusRegistry: string;
  complianceZkVerifier?: string | null;
};

export async function fetchOpsSchemas() {
  const r = await fetch("/v1/ops/schemas", {
    headers: authHeaders(getOpsToken()),
  });
  return readJson(r) as Promise<{
    ok: boolean;
    deployment: OpsDeployment | null;
    schemas: OpsSchemaRow[];
  }>;
}

export async function syncOpsSchemas() {
  const r = await fetch("/v1/ops/schemas/sync", {
    method: "POST",
    headers: authHeaders(getOpsToken()),
  });
  return readJson(r) as Promise<{
    ok: boolean;
    deployment: OpsDeployment | null;
    schemas: OpsSchemaRow[];
  }>;
}

export async function curatorVerifyJwt(jwt: string) {
  const r = await fetch("/v1/curator/verify-jwt", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(getCuratorToken()),
    },
    body: JSON.stringify({ jwt }),
  });
  return readJson(r);
}

export async function curatorVerifyPresentation(
  presentation: unknown,
  challenge?: string
) {
  const r = await fetch("/v1/curator/verify-presentation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(getCuratorToken()),
    },
    body: JSON.stringify({ presentation, challenge }),
  });
  return readJson(r);
}

export async function curatorVerifyZk(body: {
  liveCredHash: string;
  resCredHash: string;
  publicSignals: unknown;
  policy?: { minScoreBps?: number; allowlist?: string[] };
}) {
  const r = await fetch("/v1/curator/verify-zk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(getCuratorToken()),
    },
    body: JSON.stringify(body),
  });
  return readJson(r);
}

export type ApplicationRow = {
  id: string;
  bountyId: string;
  subjectDid: string;
  subjectAddress: string;
  mode: "CLAIMS" | "ZK";
  status: string;
  ok: boolean;
  liveCredHash?: string | null;
  resCredHash?: string | null;
  schemaKey?: string | null;
  onChainValid?: boolean | null;
  warnings?: string[];
  disclosed?: {
    score?: string | null;
    country?: string | null;
    expiresAt?: string | null;
  };
  profile?: unknown;
  applicantNote?: string | null;
  externalRef?: string | null;
  curatorNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
};

export async function submitClaimsApplication(body: {
  presentation: unknown;
  challenge: string;
  applicantNote?: string;
  externalRef?: string;
  bountyId?: string;
}) {
  const r = await fetch("/v1/applications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "claims", ...body }),
  });
  return readJson(r) as Promise<{ ok: boolean; application: ApplicationRow }>;
}

export async function submitZkApplication(body: {
  liveCredHash: string;
  resCredHash: string;
  publicSignals: unknown;
  proof?: { proof: string; publicInputs: string[] };
  subjectDid?: string;
  applicantNote?: string;
  bountyId?: string;
  externalRef?: string;
}) {
  const r = await fetch("/v1/applications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "zk", ...body }),
  });
  return readJson(r) as Promise<{ ok: boolean; application: ApplicationRow }>;
}

export async function fetchMyApplications(did: string) {
  const r = await fetch(`/v1/applications/mine?did=${encodeURIComponent(did)}`);
  const data = await readJson(r);
  return data.items as ApplicationRow[];
}

export async function fetchCuratorApplications(status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const r = await fetch(`/v1/curator/applications${q}`, {
    headers: authHeaders(getCuratorToken()),
  });
  const data = await readJson(r);
  return data.items as ApplicationRow[];
}

export async function reviewCuratorApplication(
  id: string,
  body: {
    status?: string;
    curatorNote?: string;
    externalRef?: string | null;
    markReviewed?: boolean;
  }
) {
  const r = await fetch(`/v1/curator/applications/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...authHeaders(getCuratorToken()),
    },
    body: JSON.stringify(body),
  });
  return readJson(r);
}
