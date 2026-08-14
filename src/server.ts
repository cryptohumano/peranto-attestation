import {
  formatDid,
  createDidConfigurationForOrigin,
  PerantoClient,
  SCHEMA_KEYS,
  verifyPresentation,
  computeAllowlistRoot,
  type PerantoNetwork,
  type CompliancePolicy,
  type ComplianceGateProof,
} from "@peranto/sdk";
import { verifyComplianceGateHonk } from "@peranto/zk-compliance";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAddresses, loadDeploymentMeta } from "./config.js";
import {
  summarizeDiditWebhook,
  verifyDiditSignatureSimple,
  verifyDiditSignatureV2,
} from "./didit-webhook.js";
import { issueCredential } from "./issue.js";
import {
  attachIssued,
  getLastAny,
  getLastStatusUpdated,
  getQueueItem,
  hasIssued,
  listQueue,
  recordWebhook,
  setAutoIssueError,
} from "./session-queue.js";
import {
  createOpsChallenge,
  isAllowlisted,
  loginOps,
  logoutOps,
  normalizeAllowlist,
  resolveOpsSession,
} from "./ops-auth.js";
import {
  getApplication,
  listApplications,
  listMine,
  reviewApplication,
  submitApplication,
} from "./applications.js";
import { ApplicationStatus } from "@prisma/client";
import { prisma } from "./db.js";
import {
  listOpsSchemas,
  recordRegisteredSchema,
  syncProtocolDeployment,
} from "./protocol-catalog.js";
const DEFAULT_TTL_SECONDS = {
  liveness: 30 * 24 * 60 * 60,
  residence: 90 * 24 * 60 * 60,
};
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const NETWORK = (process.env.PERANTO_NETWORK ?? "paseo") as PerantoNetwork;
const PUBLIC_ORIGIN = (
  process.env.PUBLIC_ORIGIN ?? `http://localhost:${PORT}`
).replace(/\/$/, "");
const ANCHOR = process.env.ANCHOR === "true";
const AUTO_ISSUE = process.env.AUTO_ISSUE !== "false";
const PRIVATE_KEY = (process.env.ATTESTER_PRIVATE_KEY ?? "") as Hex;
const LIVENESS_TTL = Number(
  process.env.LIVENESS_TTL_SECONDS ?? DEFAULT_TTL_SECONDS.liveness
);
const RESIDENCE_TTL = Number(
  process.env.RESIDENCE_TTL_SECONDS ?? DEFAULT_TTL_SECONDS.residence
);

if (!PRIVATE_KEY || !PRIVATE_KEY.startsWith("0x")) {
  console.error("Set ATTESTER_PRIVATE_KEY in .env");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
const serviceDid = formatDid(NETWORK, account.address);
const deployment = loadDeploymentMeta(NETWORK);
const addresses = deployment.addresses;

const opsAllowlist = normalizeAllowlist([
  ...(process.env.OPS_ALLOWLIST?.split(",") ?? []),
  deployment.deployer ?? "",
  account.address,
].filter(Boolean));

const curatorAllowlist = normalizeAllowlist([
  ...(process.env.CURATOR_ALLOWLIST?.split(",") ?? []),
  ...opsAllowlist,
]);

const DEFAULT_POLICY: CompliancePolicy = {
  minScoreBps: Number(process.env.CURATOR_MIN_SCORE_BPS ?? 9000),
  allowlist: (process.env.CURATOR_COUNTRY_ALLOWLIST ?? "MX,CO,AR,ES,PT")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  now: 0,
};

let didConfiguration: unknown = null;

async function ensureDidConfiguration() {
  const cached = join(__dirname, "..", "data", "did-configuration.json");
  if (existsSync(cached)) {
    didConfiguration = JSON.parse(readFileSync(cached, "utf8"));
    return;
  }
  mkdirSync(dirname(cached), { recursive: true });
  const { didConfiguration: cfg } = await createDidConfigurationForOrigin({
    issuerPrivateKey: PRIVATE_KEY,
    network: NETWORK,
    origin: PUBLIC_ORIGIN,
  });
  didConfiguration = cfg;
  writeFileSync(cached, JSON.stringify(cfg, null, 2));
}

function client(): PerantoClient {
  return new PerantoClient({
    network: NETWORK,
    privateKey: PRIVATE_KEY,
    addresses,
  });
}

function issueDeps() {
  return {
    privateKey: PRIVATE_KEY,
    network: NETWORK,
    addresses,
    anchor: ANCHOR,
    livenessTtl: LIVENESS_TTL,
    residenceTtl: RESIDENCE_TTL,
    client,
  };
}

function issueResponse(result: Awaited<ReturnType<typeof issueCredential>>) {
  return {
    ok: true,
    anchored: result.anchored,
    anchorTx: result.anchorTx,
    validUntil: result.validUntil,
    expiresAt: result.expiresAt,
    claimsCommitment: result.claimsCommitment,
    commitmentSalt: result.commitmentSalt,
    issuerDid: result.issuerDid,
    subjectDid: result.subjectDid,
    schemaKey: result.schemaKey,
    credHash: result.credHash,
    jwt: result.jwt,
    ttlSeconds: result.ttlSeconds,
    kind: result.kind,
    aura: {
      save: {
        method: "peranto_saveCredential",
        params: [
          {
            jwt: result.jwt,
            label: result.kind,
            schemaKey: result.schemaKey,
            meta: {
              claimsCommitment: result.claimsCommitment,
              commitmentSalt: result.commitmentSalt,
              validUntil: result.validUntil,
            },
          },
        ],
      },
    },
  };
}

function bearerToken(req: Request): string | null {
  const h = req.header("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1]?.trim() || null;
}

function requireOps(req: Request, res: Response, next: NextFunction) {
  const addr = resolveOpsSession(bearerToken(req));
  if (!addr) {
    return res.status(401).json({ error: "ops session required — connect Aura" });
  }
  (req as Request & { opsAddress?: Address }).opsAddress = addr;
  next();
}

function requireCurator(req: Request, res: Response, next: NextFunction) {
  const addr = resolveOpsSession(bearerToken(req));
  if (!addr || !isAllowlisted(addr, curatorAllowlist)) {
    return res
      .status(401)
      .json({ error: "curator session required — connect Aura" });
  }
  (req as Request & { opsAddress?: Address }).opsAddress = addr;
  next();
}

function loadSchemaBody(kind: "liveness" | "residence"): {
  schemaKey: string;
  body: string;
  uri: string;
} {
  const schemaKey =
    kind === "residence"
      ? SCHEMA_KEYS.ProofOfResidence
      : SCHEMA_KEYS.LivenessCheck;
  const file =
    kind === "residence" ? "ProofOfResidence.v1.json" : "LivenessCheck.v1.json";
  const candidates = [
    join(__dirname, "..", "..", "dids-vc-ecotesting", "schemas", file),
    join(__dirname, "..", "schemas", file),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return {
        schemaKey,
        body: readFileSync(p, "utf8"),
        uri: `${PUBLIC_ORIGIN}/schemas/${file}`,
      };
    }
  }
  return {
    schemaKey,
    body: JSON.stringify({ $id: schemaKey }),
    uri: `${PUBLIC_ORIGIN}/schemas/${file}`,
  };
}

function serializeStatus(status: {
  st: number;
  attester: Address;
  schemaId: Hex;
  subject: Address;
  anchoredAt: bigint;
  validUntil: bigint;
  claimsCommitment: Hex;
  revokeReason: string;
}) {
  return {
    st: status.st,
    attester: status.attester,
    schemaId: status.schemaId,
    subject: status.subject,
    anchoredAt: status.anchoredAt.toString(),
    validUntil: Number(status.validUntil),
    claimsCommitment: status.claimsCommitment,
    revokeReason: status.revokeReason,
  };
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", async (_req, res) => {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  res.json({
    ok: true,
    dbOk,
    serviceDid,
    attester: account.address,
    deployer: deployment.deployer,
    network: NETWORK,
    origin: PUBLIC_ORIGIN,
    anchor: ANCHOR,
    autoIssue: AUTO_ISSUE,
    ttl: { livenessSeconds: LIVENESS_TTL, residenceSeconds: RESIDENCE_TTL },
    diditWorkflowConfigured: Boolean(process.env.DIDIT_WORKFLOW_ID?.trim()),
    queueSize: listQueue().length,
    opsAllowlist,
    curatorAllowlist,
    policy: {
      minScoreBps: DEFAULT_POLICY.minScoreBps,
      allowlist: DEFAULT_POLICY.allowlist,
      allowlistRoot: computeAllowlistRoot(DEFAULT_POLICY.allowlist),
    },
    schemasKnown: Object.keys(deployment.schemas),
    addresses: {
      CredentialStatusRegistry: addresses.CredentialStatusRegistry,
      AttesterRegistry: addresses.AttesterRegistry,
      SchemaRegistry: addresses.SchemaRegistry,
      ComplianceZkVerifier: addresses.ComplianceZkVerifier,
    },
  });
});

app.post("/v1/ops/challenge", (_req, res) => {
  res.json(createOpsChallenge(PUBLIC_ORIGIN));
});

app.post("/v1/ops/login", async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId ?? "");
    const signature = String(req.body?.signature ?? "") as Hex;
    if (!challengeId || !signature.startsWith("0x")) {
      return res.status(400).json({ error: "challengeId + signature required" });
    }
    const session = await loginOps({
      challengeId,
      signature,
      allowlist: opsAllowlist,
    });
    res.json({ ok: true, ...session, role: "ops" });
  } catch (e) {
    res.status(403).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/v1/curator/login", async (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId ?? "");
    const signature = String(req.body?.signature ?? "") as Hex;
    if (!challengeId || !signature.startsWith("0x")) {
      return res.status(400).json({ error: "challengeId + signature required" });
    }
    const session = await loginOps({
      challengeId,
      signature,
      allowlist: curatorAllowlist,
    });
    res.json({ ok: true, ...session, role: "curator" });
  } catch (e) {
    res.status(403).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/v1/ops/logout", (req, res) => {
  logoutOps(bearerToken(req));
  res.json({ ok: true });
});

app.get("/v1/ops/me", requireOps, (req, res) => {
  res.json({
    ok: true,
    address: (req as Request & { opsAddress?: Address }).opsAddress,
  });
});

/**
 * Create Didit verification session. vendor_data = subjectDid for webhook correlation.
 */
app.post("/v1/didit/session", async (req, res) => {
  try {
    const apiKey = process.env.DIDIT_API_KEY?.trim();
    const workflowId = process.env.DIDIT_WORKFLOW_ID?.trim();
    if (!apiKey) return res.status(500).json({ error: "DIDIT_API_KEY not set" });
    if (!workflowId) {
      return res.status(500).json({ error: "DIDIT_WORKFLOW_ID not set" });
    }
    const subjectDid = String(req.body?.subjectDid ?? "");
    if (!subjectDid.startsWith("did:peranto:")) {
      return res.status(400).json({ error: "subjectDid must be did:peranto:…" });
    }
    const r = await fetch("https://verification.didit.me/v3/session/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        workflow_id: workflowId,
        vendor_data: subjectDid,
        callback: `${PUBLIC_ORIGIN}/`,
      }),
    });
    const data = (await r.json()) as Record<string, unknown>;
    if (!r.ok) {
      return res.status(r.status).json({
        error: data.detail ?? data.error ?? `Didit ${r.status}`,
        detail: data,
      });
    }
    res.json({
      ok: true,
      session_id: data.session_id,
      url: data.url ?? data.verification_url,
      status: data.status,
      vendor_data: subjectDid,
      workflow_id: workflowId,
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/.well-known/did-configuration.json", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(didConfiguration ?? {});
});

app.get("/v1/holder/issued", (req, res) => {
  const did = String(req.query.did ?? "");
  if (!did.startsWith("did:peranto:")) {
    return res.status(400).json({ error: "did query required" });
  }
  const items = listQueue()
    .filter((i) => i.subjectDid === did)
    .map((i) => ({
      sessionId: i.sessionId,
      status: i.status,
      updatedAt: i.updatedAt,
      issued: i.issued,
      autoIssueError: i.autoIssueError ?? null,
    }));
  res.json({ ok: true, items });
});

app.post("/v1/issue", async (req, res) => {
  try {
    const subjectDid = String(req.body?.subjectDid ?? "");
    const kind = String(req.body?.kind ?? "liveness") as "liveness" | "residence";
    const sessionId = req.body?.sessionId
      ? String(req.body.sessionId)
      : undefined;
    const result = await issueCredential(issueDeps(), {
      subjectDid,
      kind: kind === "residence" ? "residence" : "liveness",
      sessionId,
      claims: (req.body?.claims ?? {}) as Record<string, unknown>,
    });
    if (sessionId) {
      attachIssued(sessionId, {
        kind: result.kind,
        credHash: result.credHash,
        jwt: result.jwt,
        schemaKey: result.schemaKey,
        claimsCommitment: result.claimsCommitment,
        commitmentSalt: result.commitmentSalt,
        validUntil: result.validUntil,
        anchored: result.anchored,
        issuedAt: new Date().toISOString(),
        auto: false,
      });
    }
    res.json(issueResponse(result));
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/v1/queue/:sessionId/issue", requireOps, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId);
    const item = getQueueItem(sessionId);
    if (!item) return res.status(404).json({ error: "session not in queue" });
    if (!item.subjectDid) {
      return res.status(400).json({ error: "vendor_data is not did:peranto" });
    }
    const kind =
      String(req.body?.kind ?? "liveness") === "residence"
        ? "residence"
        : "liveness";
    if (hasIssued(sessionId, kind)) {
      return res.status(409).json({
        error: `${kind} already issued for this session`,
        item,
      });
    }
    const live = item.summary.liveness_checks?.[0];
    const poa = item.summary.poa_verifications?.[0];
    const claims =
      kind === "liveness"
        ? { score: live?.score ?? 0.95 }
        : {
            country: poa?.country ?? "MX",
            region: poa?.region ?? "",
            docType: poa?.document_type ?? "other",
          };
    const result = await issueCredential(issueDeps(), {
      subjectDid: item.subjectDid,
      kind,
      sessionId,
      claims,
    });
    const updated = attachIssued(sessionId, {
      kind: result.kind,
      credHash: result.credHash,
      jwt: result.jwt,
      schemaKey: result.schemaKey,
      claimsCommitment: result.claimsCommitment,
      commitmentSalt: result.commitmentSalt,
      validUntil: result.validUntil,
      anchored: result.anchored,
      issuedAt: new Date().toISOString(),
      auto: false,
    });
    res.json({ ...issueResponse(result), queue: updated });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/v1/revoke", requireOps, async (req, res) => {
  try {
    const credHash = String(req.body?.credHash ?? "") as Hex;
    const reason = String(req.body?.reason ?? "revoked by attester");
    if (!credHash.startsWith("0x") || credHash.length !== 66) {
      return res.status(400).json({ error: "credHash required" });
    }
    const tx = await client().revoke(credHash, reason);
    res.json({ ok: true, txHash: tx });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/v1/queue", requireOps, (_req, res) => {
  res.json({ ok: true, items: listQueue() });
});

app.get("/v1/queue/:sessionId", requireOps, (req, res) => {
  const item = getQueueItem(String(req.params.sessionId));
  if (!item) return res.status(404).json({ error: "not found" });
  res.json(item);
});

/** Register compliance schema (publisher = attester key / governance). */
app.post("/v1/ops/schemas/register", requireOps, async (req, res) => {
  try {
    const kind =
      String(req.body?.kind ?? "liveness") === "residence"
        ? "residence"
        : "liveness";
    const { schemaKey, body, uri } = loadSchemaBody(kind);
    const customKey = req.body?.schemaKey
      ? String(req.body.schemaKey)
      : schemaKey;
    const customBody = req.body?.schemaBody
      ? String(req.body.schemaBody)
      : body;
    const customUri = req.body?.uri ? String(req.body.uri) : uri;
    const result = await client().registerSchema(
      customKey,
      customBody,
      customUri
    );
    await recordRegisteredSchema({
      network: NETWORK,
      schemaKey: customKey,
      schemaId: result.schemaId,
      schemaHash: result.schemaHash,
      uri: customUri,
      publisher: account.address,
      txHash: result.txHash,
      source: "ops",
    });
    res.json({ ok: true, schemaKey: customKey, ...result });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

/** Ops catalog: deployment addresses + schemas (DB + on-chain). */
app.get("/v1/ops/schemas", requireOps, async (_req, res) => {
  try {
    const catalog = await listOpsSchemas({
      network: NETWORK,
      client: client(),
      attester: account.address,
    });
    res.json({ ok: true, ...catalog });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/v1/ops/schemas/sync", requireOps, async (_req, res) => {
  try {
    await syncProtocolDeployment({
      network: NETWORK,
      deployer: deployment.deployer,
      addresses,
      schemasFromDeploy: deployment.schemas,
    });
    const catalog = await listOpsSchemas({
      network: NETWORK,
      client: client(),
      attester: account.address,
    });
    res.json({ ok: true, ...catalog });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

/** Ensure attester is authorized for Liveness / Residence (stakeAndJoin / addSchema). */
app.post("/v1/ops/attester/ensure", requireOps, async (req, res) => {
  try {
    const kinds = Array.isArray(req.body?.kinds)
      ? (req.body.kinds as string[])
      : ["liveness", "residence"];
    const out = [];
    for (const k of kinds) {
      const schemaKey =
        k === "residence"
          ? SCHEMA_KEYS.ProofOfResidence
          : SCHEMA_KEYS.LivenessCheck;
      out.push(await client().ensureAttesterForSchema(schemaKey));
    }
    res.json({ ok: true, results: out });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/v1/ops/attester/status", requireOps, async (_req, res) => {
  try {
    const c = client();
    const me = account.address;
    res.json({
      ok: true,
      attester: me,
      anchor: ANCHOR,
      authorized: {
        liveness: await c.isAuthorized(me, SCHEMA_KEYS.LivenessCheck),
        residence: await c.isAuthorized(me, SCHEMA_KEYS.ProofOfResidence),
      },
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

/** Claims mode: verify JWT (signature + on-chain status). */
app.post("/v1/curator/verify-jwt", requireCurator, async (req, res) => {
  try {
    const jwt = String(req.body?.jwt ?? "");
    if (!jwt) return res.status(400).json({ error: "jwt required" });
    const verified = await client().verifyCredential(jwt);
    const subjectClaims = (verified.details.vc?.credentialSubject ??
      {}) as Record<string, unknown>;
    const schemaKey =
      (verified.details.vc as { credentialSchema?: { id?: string } } | undefined)
        ?.credentialSchema?.id ?? null;
    const profile = {
      mode: "claims" as const,
      subjectDid: verified.details.subjectDid ?? null,
      subject: verified.status.subject,
      schemaKey,
      credHash: verified.details.credHash,
      jwtValid: verified.jwtValid,
      onChainValid: verified.onChainValid,
      authorized: verified.authorized,
      validUntil: Number(verified.status.validUntil),
      claimsCommitment: verified.status.claimsCommitment,
      disclosed: {
        score:
          typeof subjectClaims.score === "number" ||
          typeof subjectClaims.score === "string"
            ? subjectClaims.score
            : null,
        country:
          typeof subjectClaims.country === "string"
            ? subjectClaims.country
            : null,
        expiresAt:
          typeof subjectClaims.expiresAt === "string"
            ? subjectClaims.expiresAt
            : null,
        provider:
          typeof subjectClaims.provider === "string"
            ? subjectClaims.provider
            : null,
      },
      checkedAt: new Date().toISOString(),
    };
    res.json({
      ok: verified.jwtValid && (verified.onChainValid || !ANCHOR),
      profile,
      status: serializeStatus(verified.status),
      details: {
        jwtValid: verified.jwtValid,
        onChainValid: verified.onChainValid,
        authorized: verified.authorized,
      },
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

/** Claims mode: verify Aura presentation (selective disclosure). */
app.post("/v1/curator/verify-presentation", requireCurator, async (req, res) => {
  try {
    const presentation = req.body?.presentation;
    if (!presentation) {
      return res.status(400).json({ error: "presentation required" });
    }
    const challenge = req.body?.challenge
      ? String(req.body.challenge)
      : undefined;
    const verified = await verifyPresentation(presentation, {
      expectedChallenge: challenge,
    });
    let onChainValid: boolean | null = null;
    if (verified.ok && verified.credHash) {
      onChainValid = await client().isCredentialValid(verified.credHash);
    }
    const claims = (verified.claims ?? {}) as Record<string, unknown>;
    res.json({
      ok: Boolean(verified.ok && (onChainValid || !ANCHOR)),
      profile: {
        mode: "claims" as const,
        holderDid: verified.holderDid ?? null,
        schemaKey: verified.schemaKey ?? null,
        credHash: verified.credHash ?? null,
        onChainValid,
        disclosed: {
          score: claims.score ?? null,
          country: claims.country ?? null,
          expiresAt: claims.expiresAt ?? null,
          provider: claims.provider ?? null,
        },
        checkedAt: new Date().toISOString(),
        note: "No raw Didit PII — only disclosed claims from holder",
      },
      verified: {
        ok: verified.ok,
        error: verified.error,
        mode: verified.mode,
      },
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

/**
 * ZK / commitment binding: publicSignals + on-chain isValid.
 * Full remote algebraic policy proof needs Groth16; this binds commitments.
 */
app.post("/v1/curator/verify-zk", requireCurator, async (req, res) => {
  try {
    const liveCredHash = String(req.body?.liveCredHash ?? "") as Hex;
    const resCredHash = String(req.body?.resCredHash ?? "") as Hex;
    const publicSignals = req.body?.publicSignals as
      | ComplianceGateProof["publicSignals"]
      | undefined;
    if (
      !liveCredHash.startsWith("0x") ||
      !resCredHash.startsWith("0x") ||
      !publicSignals
    ) {
      return res.status(400).json({
        error: "liveCredHash, resCredHash, publicSignals required",
      });
    }
    const policy: CompliancePolicy = {
      minScoreBps: Number(
        req.body?.policy?.minScoreBps ?? DEFAULT_POLICY.minScoreBps
      ),
      allowlist: Array.isArray(req.body?.policy?.allowlist)
        ? (req.body.policy.allowlist as string[])
        : DEFAULT_POLICY.allowlist,
      now: Math.floor(Date.now() / 1000),
    };
    const c = client();
    const liveValid = await c.isCredentialValid(liveCredHash);
    const resValid = await c.isCredentialValid(resCredHash);
    const live = await c.getCredentialStatusV2(liveCredHash);
    const residence = await c.getCredentialStatusV2(resCredHash);

    const root = computeAllowlistRoot(policy.allowlist);
    const commitmentMatch =
      String(publicSignals.liveCommitment).toLowerCase() ===
        live.claimsCommitment.toLowerCase() &&
      String(publicSignals.resCommitment).toLowerCase() ===
        residence.claimsCommitment.toLowerCase();
    const rootMatch =
      String(publicSignals.allowlistRoot).toLowerCase() === root.toLowerCase();
    const scoreMatch =
      Number(publicSignals.minScoreBps) === policy.minScoreBps;
    const subjectMatch =
      live.subject.toLowerCase() === residence.subject.toLowerCase();

    let honkOk = false;
    let honkError: string | null = null;
    const packed = req.body?.proof as
      | { proof?: string; publicInputs?: string[] }
      | undefined;
    if (packed?.proof && Array.isArray(packed.publicInputs)) {
      const honk = await verifyComplianceGateHonk({
        mode: "honk",
        publicSignals,
        proof: packed,
      });
      honkOk = honk.ok;
      honkError = honk.error ?? null;
    } else {
      honkError = "missing honk proof";
    }

    const ok =
      honkOk &&
      liveValid &&
      resValid &&
      commitmentMatch &&
      rootMatch &&
      scoreMatch &&
      subjectMatch;

    const profile = {
      mode: "zk" as const,
      subject: live.subject,
      subjectDid: formatDid(NETWORK, live.subject),
      liveValid,
      residenceValid: resValid,
      commitmentMatch,
      policyRootMatch: rootMatch,
      minScoreBps: policy.minScoreBps,
      allowlist: policy.allowlist,
      allowlistRoot: root,
      disclosed: null,
      honkOk,
      note: honkOk
        ? "UltraHonk verified + on-chain commitments + isValid + policy root."
        : `Honk: ${honkError ?? "failed"}. Binding-only is not enough for payout.`,
      checkedAt: new Date().toISOString(),
    };

    res.json({
      ok,
      profile,
      checks: {
        liveValid,
        resValid,
        commitmentMatch,
        rootMatch,
        scoreMatch,
        subjectMatch,
        honkOk,
        honkError,
      },
      liveStatus: serializeStatus(live),
      residenceStatus: serializeStatus(residence),
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

/** Public: applicant submits Aura presentation or ZK package → inbox. */
app.post("/v1/applications", async (req, res) => {
  try {
    const mode = String(req.body?.mode ?? "claims");
    const policy: CompliancePolicy = {
      ...DEFAULT_POLICY,
      now: Math.floor(Date.now() / 1000),
    };
    if (mode === "zk") {
      const app = await submitApplication({
        input: {
          mode: "zk",
          liveCredHash: String(req.body?.liveCredHash ?? ""),
          resCredHash: String(req.body?.resCredHash ?? ""),
          publicSignals: req.body?.publicSignals,
          proof: req.body?.proof,
          policy: req.body?.policy,
          subjectDid: req.body?.subjectDid
            ? String(req.body.subjectDid)
            : undefined,
          applicantNote: req.body?.applicantNote
            ? String(req.body.applicantNote)
            : undefined,
          externalRef: req.body?.externalRef
            ? String(req.body.externalRef)
            : undefined,
          bountyId: req.body?.bountyId
            ? String(req.body.bountyId)
            : undefined,
        },
        client: client(),
        network: NETWORK,
        policy,
        anchor: ANCHOR,
      });
      return res.status(201).json({ ok: true, application: app });
    }
    const app = await submitApplication({
      input: {
        mode: "claims",
        presentation: req.body?.presentation,
        challenge: req.body?.challenge
          ? String(req.body.challenge)
          : undefined,
        applicantNote: req.body?.applicantNote
          ? String(req.body.applicantNote)
          : undefined,
        externalRef: req.body?.externalRef
          ? String(req.body.externalRef)
          : undefined,
        bountyId: req.body?.bountyId ? String(req.body.bountyId) : undefined,
      },
      client: client(),
      network: NETWORK,
      policy,
      anchor: ANCHOR,
    });
    res.status(201).json({ ok: true, application: app });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/v1/applications/mine", async (req, res) => {
  try {
    const did = String(req.query.did ?? "");
    if (!did.startsWith("did:peranto:")) {
      return res.status(400).json({ error: "did query required" });
    }
    res.json({ ok: true, items: await listMine(did) });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/v1/curator/applications", requireCurator, async (req, res) => {
  try {
    const status = req.query.status
      ? (String(req.query.status).toUpperCase() as ApplicationStatus)
      : undefined;
    const bountyId = req.query.bountyId
      ? String(req.query.bountyId)
      : undefined;
    const items = await listApplications({ bountyId, status });
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/v1/curator/applications/:id", requireCurator, async (req, res) => {
  try {
    const item = await getApplication(String(req.params.id));
    if (!item) return res.status(404).json({ error: "not found" });
    res.json(item);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.patch("/v1/curator/applications/:id", requireCurator, async (req, res) => {
  try {
    const reviewedBy =
      (req as Request & { opsAddress?: Address }).opsAddress ?? "unknown";
    let status: ApplicationStatus | undefined;
    if (req.body?.status != null) {
      const statusRaw = String(req.body.status).toUpperCase();
      status = Object.values(ApplicationStatus).includes(
        statusRaw as ApplicationStatus
      )
        ? (statusRaw as ApplicationStatus)
        : ApplicationStatus.REVIEWED;
    } else if (
      req.body?.curatorNote != null ||
      req.body?.markReviewed === true
    ) {
      status = ApplicationStatus.REVIEWED;
    }
    const item = await reviewApplication({
      id: String(req.params.id),
      reviewedBy,
      status,
      curatorNote:
        req.body?.curatorNote != null
          ? String(req.body.curatorNote)
          : undefined,
      externalRef:
        req.body?.externalRef !== undefined
          ? req.body.externalRef == null
            ? null
            : String(req.body.externalRef)
          : undefined,
    });
    res.json({ ok: true, application: item });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/webhooks/didit", async (req, res) => {
  const secret = process.env.DIDIT_WEBHOOK_SECRET?.trim();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const isTest = req.header("x-didit-test-webhook") === "true";
  const ts = req.header("x-timestamp") ?? undefined;
  const sigV2 = req.header("x-signature-v2") ?? undefined;
  const sigSimple = req.header("x-signature-simple") ?? undefined;

  let sigOk: "v2" | "simple" | "skipped" | "failed" = "skipped";
  if (secret) {
    if (verifyDiditSignatureV2(body, sigV2, ts, secret)) {
      sigOk = "v2";
    } else if (verifyDiditSignatureSimple(body, sigSimple, ts, secret)) {
      sigOk = "simple";
    } else {
      sigOk = "failed";
      console.warn("[didit webhook] signature failed", {
        hasV2: Boolean(sigV2),
        hasSimple: Boolean(sigSimple),
        hasTs: Boolean(ts),
        isTest,
      });
      return res.status(401).json({ error: "invalid webhook signature" });
    }
  }

  const summary = summarizeDiditWebhook(body, { isTest, sigOk });
  const queueItem = recordWebhook(summary);
  console.log("[didit webhook]", JSON.stringify(summary));

  let autoIssue: unknown = null;
  if (
    AUTO_ISSUE &&
    queueItem &&
    summary.webhook_type === "status.updated" &&
    summary.status === "Approved" &&
    queueItem.subjectDid &&
    summary.liveness_checks.some((c) => c.status === "Approved") &&
    !hasIssued(queueItem.sessionId, "liveness")
  ) {
    try {
      const score = summary.liveness_checks[0]?.score ?? 0.95;
      const result = await issueCredential(issueDeps(), {
        subjectDid: queueItem.subjectDid,
        kind: "liveness",
        sessionId: queueItem.sessionId,
        claims: { score },
      });
      attachIssued(queueItem.sessionId, {
        kind: "liveness",
        credHash: result.credHash,
        jwt: result.jwt,
        schemaKey: result.schemaKey,
        claimsCommitment: result.claimsCommitment,
        commitmentSalt: result.commitmentSalt,
        validUntil: result.validUntil,
        anchored: result.anchored,
        issuedAt: new Date().toISOString(),
        auto: true,
      });
      autoIssue = {
        ok: true,
        kind: "liveness",
        credHash: result.credHash,
        subjectDid: result.subjectDid,
        anchored: result.anchored,
      };
      console.log("[didit auto-issue]", autoIssue);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAutoIssueError(queueItem.sessionId, msg);
      autoIssue = { ok: false, error: msg };
      console.error("[didit auto-issue]", msg);
    }
  }

  res.json({
    ok: true,
    received: true,
    signature: sigOk,
    summary,
    queueItem: queueItem ? getQueueItem(queueItem.sessionId) : null,
    autoIssue,
  });
});

app.get("/webhooks/didit/last", requireOps, (req, res) => {
  const useful = String(req.query.useful ?? "") === "1";
  const hit = useful ? getLastStatusUpdated() : getLastAny();
  if (!hit) {
    return res.status(404).json({
      error: "no webhook received yet",
      hint: "Complete a Didit session or wait for status.updated",
    });
  }
  res.json(hit);
});

await ensureDidConfiguration();

try {
  await syncProtocolDeployment({
    network: NETWORK,
    deployer: deployment.deployer,
    addresses,
    schemasFromDeploy: deployment.schemas,
  });
  console.log(
    `[peranto-attestation] protocol catalog synced (${Object.keys(deployment.schemas).length} deploy schemas)`
  );
} catch (e) {
  console.warn(
    "[peranto-attestation] protocol catalog sync failed",
    e instanceof Error ? e.message : e
  );
}

const webDist = join(__dirname, "..", "web", "dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/v1") ||
      req.path.startsWith("/webhooks") ||
      req.path.startsWith("/health") ||
      req.path.startsWith("/.well-known")
    ) {
      return next();
    }
    res.sendFile(join(webDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`[peranto-attestation] ${PUBLIC_ORIGIN}`);
  console.log(`[peranto-attestation] DID ${serviceDid}`);
  console.log(`[peranto-attestation] attester ${account.address}`);
  console.log(
    `[peranto-attestation] ops allowlist ${opsAllowlist.join(", ") || "(empty)"}`
  );
  console.log(
    `[peranto-attestation] TTL liveness=${LIVENESS_TTL}s residence=${RESIDENCE_TTL}s ANCHOR=${ANCHOR}`
  );
  console.log(
    `[peranto-attestation] Didit webhook ${PUBLIC_ORIGIN}/webhooks/didit`
  );
  if (existsSync(webDist)) {
    console.log(`[peranto-attestation] SPA ${webDist}`);
  }
});
