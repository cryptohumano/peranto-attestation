import {
  SCHEMA_KEYS,
  issueJwtCredential,
  buildLivenessCommitment,
  buildResidenceCommitment,
  NETWORK_CHAIN_ID,
  PerantoClient,
  type PerantoNetwork,
  type ContractAddresses,
} from "@peranto/sdk";
import type { Address, Hex } from "viem";

const DEFAULT_LIVENESS_TTL = 30 * 24 * 60 * 60;
const DEFAULT_RESIDENCE_TTL = 90 * 24 * 60 * 60;

export type IssueKind = "liveness" | "residence";

export type IssueResult = {
  kind: IssueKind;
  jwt: string;
  credHash: Hex;
  schemaKey: string;
  subjectDid: string;
  issuerDid: string;
  claimsCommitment: Hex;
  commitmentSalt: Hex;
  validUntil: number;
  expiresAt: string;
  anchored: boolean;
  anchorTx: Hex | null;
  ttlSeconds: number;
};

type IssueDeps = {
  privateKey: Hex;
  network: PerantoNetwork;
  addresses: ContractAddresses;
  anchor: boolean;
  livenessTtl: number;
  residenceTtl: number;
  client: () => PerantoClient;
};

export async function issueCredential(
  deps: IssueDeps,
  params: {
    subjectDid: string;
    kind: IssueKind;
    sessionId?: string;
    claims?: Record<string, unknown>;
  }
): Promise<IssueResult> {
  const subjectDid = params.subjectDid;
  if (!subjectDid.startsWith("did:peranto:")) {
    throw new Error("subjectDid required");
  }
  const subject = subjectDid.split(":").pop() as Address;
  if (!subject?.startsWith("0x")) throw new Error("invalid subjectDid");

  const now = Date.now();
  const kind = params.kind;
  let salt: Hex;
  let commitment: Hex;
  let validUntil: number;
  let schemaKey: string;
  let credentialType: string;
  let claims: Record<string, unknown>;

  if (kind === "residence") {
    validUntil = Math.floor(now / 1000) + deps.residenceTtl;
    const expiresAt = new Date(validUntil * 1000).toISOString();
    const country = String(params.claims?.country ?? "MX");
    const built = buildResidenceCommitment({
      country,
      expiresAt: validUntil,
      subject,
    });
    salt = built.salt;
    commitment = built.commitment;
    schemaKey = SCHEMA_KEYS.ProofOfResidence;
    credentialType = "ProofOfResidence";
    claims = {
      provider: "didit",
      region: String(params.claims?.region ?? ""),
      docType: String(params.claims?.docType ?? "utility"),
      issuedWithinDays: Number(params.claims?.issuedWithinDays ?? 30),
      checkedAt: new Date(now).toISOString(),
      subjectDid,
      sessionId: params.sessionId,
      ...(params.claims ?? {}),
      country,
      expiresAt,
    };
  } else {
    validUntil = Math.floor(now / 1000) + deps.livenessTtl;
    const expiresAt = new Date(validUntil * 1000).toISOString();
    // Didit score is often 0–100; our commitment uses 0–1 or bps
    let score = Number(
      params.claims?.score ?? params.claims?.livenessScore ?? 0.95
    );
    if (score > 1) score = score / 100;
    const built = buildLivenessCommitment({
      score,
      expiresAt: validUntil,
      subject,
    });
    salt = built.salt;
    commitment = built.commitment;
    schemaKey = SCHEMA_KEYS.LivenessCheck;
    credentialType = "LivenessCheck";
    claims = {
      provider: "didit",
      sessionId: String(params.sessionId ?? `att-${Date.now()}`),
      checkedAt: new Date(now).toISOString(),
      subjectDid,
      ...(params.claims ?? {}),
      score,
      expiresAt,
    };
  }

  let issued;
  let anchorTx: Hex | undefined;
  if (deps.anchor) {
    const anchored = await deps.client().issueAndAnchorClaims(
      subject,
      claims,
      schemaKey,
      credentialType,
      { validUntil, claimsCommitment: commitment }
    );
    issued = anchored;
    anchorTx = anchored.anchorTx;
  } else {
    issued = await issueJwtCredential({
      issuerPrivateKey: deps.privateKey,
      network: deps.network,
      subjectAddress: subject,
      schemaKey,
      credentialType,
      claims,
      credentialStatus: {
        contractAddress: deps.addresses.CredentialStatusRegistry,
        chainId: NETWORK_CHAIN_ID[deps.network] ?? NETWORK_CHAIN_ID.paseo,
      },
    });
  }

  return {
    kind,
    jwt: issued.jwt,
    credHash: issued.credHash,
    schemaKey: issued.schemaKey,
    subjectDid: issued.subjectDid,
    issuerDid: issued.issuerDid,
    claimsCommitment: commitment,
    commitmentSalt: salt,
    validUntil,
    expiresAt: String(claims.expiresAt),
    anchored: Boolean(anchorTx),
    anchorTx: anchorTx ?? null,
    ttlSeconds: kind === "residence" ? deps.residenceTtl : deps.livenessTtl,
  };
}

export { DEFAULT_LIVENESS_TTL as DEFAULT_TTL_LIVENESS, DEFAULT_RESIDENCE_TTL as DEFAULT_TTL_RESIDENCE };
