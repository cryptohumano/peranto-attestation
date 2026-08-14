import {
  formatDid,
  verifyPresentation,
  computeAllowlistRoot,
  type CompliancePolicy,
  type ComplianceGateProof,
  type PerantoNetwork,
  PerantoClient,
} from "@peranto/sdk";
import type { Address, Hex } from "viem";
import {
  ApplicationMode,
  ApplicationStatus,
  type Application,
  type Prisma,
} from "@prisma/client";
import { prisma } from "./db.js";

export type SubmitClaimsInput = {
  mode: "claims";
  presentation: unknown;
  challenge?: string;
  applicantNote?: string;
  externalRef?: string;
  bountyId?: string;
};

export type SubmitZkInput = {
  mode: "zk";
  liveCredHash: string;
  resCredHash: string;
  publicSignals: ComplianceGateProof["publicSignals"];
  policy?: Partial<CompliancePolicy>;
  subjectDid?: string;
  applicantNote?: string;
  externalRef?: string;
  bountyId?: string;
};

export type SubmitApplicationInput = SubmitClaimsInput | SubmitZkInput;

function discloseStr(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}

function cleanExternalRef(v?: string | null): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 200);
  return s || null;
}

export function serializeApp(a: Application) {
  const checks = (a.checksJson ?? {}) as Record<string, unknown>;
  const profile = (a.profileJson ?? {}) as Record<string, unknown>;
  return {
    id: a.id,
    bountyId: a.bountyId,
    subjectDid: a.subjectDid,
    subjectAddress: a.subjectAddress,
    mode: a.mode,
    status: a.status,
    ok: a.ok,
    challenge: a.challenge,
    liveCredHash: a.liveCredHash,
    resCredHash: a.resCredHash,
    schemaKey: a.schemaKey,
    liveValid: a.liveValid,
    residenceValid: a.residenceValid,
    jwtValid: a.jwtValid,
    onChainValid: a.onChainValid,
    commitmentMatch: a.commitmentMatch,
    policyRootMatch: a.policyRootMatch,
    disclosed: {
      score: a.disclosedScore,
      country: a.disclosedCountry,
      expiresAt: a.disclosedExpires,
    },
    warnings: (checks.warnings as string[] | undefined) ??
      (profile.warnings as string[] | undefined) ??
      [],
    profile: a.profileJson,
    checks: a.checksJson,
    applicantNote: a.applicantNote,
    externalRef: a.externalRef,
    curatorNote: a.curatorNote,
    reviewedAt: a.reviewedAt,
    reviewedBy: a.reviewedBy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export async function submitApplication(params: {
  input: SubmitApplicationInput;
  client: PerantoClient;
  network: PerantoNetwork;
  policy: CompliancePolicy;
  anchor: boolean;
}) {
  const { input, client, network, policy } = params;
  const bountyId = input.bountyId?.trim() || "kusama-privacy-identity";
  const externalRef = cleanExternalRef(input.externalRef);

  if (input.mode === "claims") {
    const verified = await verifyPresentation(input.presentation, {
      expectedChallenge: input.challenge,
    });
    if (!verified.ok || !verified.holderDid) {
      throw new Error(verified.error ?? "presentation invalid");
    }
    let onChainValid: boolean | null = null;
    if (verified.credHash) {
      onChainValid = await client.isCredentialValid(verified.credHash as Hex);
    }
    const claims = (verified.claims ?? {}) as Record<string, unknown>;
    const presentationOk = Boolean(verified.ok && verified.holderDid);
    const warnings: string[] = [];
    if (presentationOk && onChainValid === false) {
      warnings.push(
        "credHash no está Active on-chain (emite/ancla de nuevo con ANCHOR o Ensure attester)"
      );
    }
    // Pass if Aura presentation verifies. On-chain is reported separately for curators.
    const ok = presentationOk;
    const subjectDid = verified.holderDid!;
    const subjectAddress = subjectDid.split(":").pop() as string;

    const profile = {
      mode: "claims",
      subjectDid,
      subject: subjectAddress,
      schemaKey: verified.schemaKey ?? null,
      credHash: verified.credHash ?? null,
      onChainValid,
      warnings,
      disclosed: {
        score: claims.score ?? claims.livenessScore ?? null,
        country: claims.country ?? null,
        expiresAt: claims.expiresAt ?? null,
        provider: claims.provider ?? null,
      },
      note: "Derived from Aura presentation — no Didit PII stored",
      checkedAt: new Date().toISOString(),
    };

    const row = await prisma.application.create({
      data: {
        bountyId,
        subjectDid,
        subjectAddress,
        mode: ApplicationMode.CLAIMS,
        status: ok ? ApplicationStatus.PASSED : ApplicationStatus.FAILED,
        ok,
        challenge: input.challenge ?? verified.challenge ?? null,
        liveCredHash: verified.credHash ? String(verified.credHash) : null,
        schemaKey: verified.schemaKey ?? null,
        jwtValid: verified.jwtValid ?? null,
        onChainValid,
        disclosedScore: discloseStr(
          claims.score ?? claims.livenessScore ?? null
        ),
        disclosedCountry: discloseStr(claims.country),
        disclosedExpires: discloseStr(claims.expiresAt),
        profileJson: profile as Prisma.InputJsonValue,
        checksJson: {
          presentationOk,
          onChainValid,
          warnings,
        } as Prisma.InputJsonValue,
        applicantNote: input.applicantNote?.slice(0, 500) ?? null,
        externalRef,
      },
    });
    return serializeApp(row);
  }

  // ZK binding
  const liveCredHash = input.liveCredHash as Hex;
  const resCredHash = input.resCredHash as Hex;
  const publicSignals = input.publicSignals;
  if (!liveCredHash?.startsWith("0x") || !resCredHash?.startsWith("0x")) {
    throw new Error("liveCredHash and resCredHash required");
  }
  if (!publicSignals) throw new Error("publicSignals required");

  const pol: CompliancePolicy = {
    minScoreBps: Number(input.policy?.minScoreBps ?? policy.minScoreBps),
    allowlist: Array.isArray(input.policy?.allowlist)
      ? input.policy!.allowlist!
      : policy.allowlist,
    now: Math.floor(Date.now() / 1000),
  };

  const liveValid = await client.isCredentialValid(liveCredHash);
  const resValid = await client.isCredentialValid(resCredHash);
  const live = await client.getCredentialStatusV2(liveCredHash);
  const residence = await client.getCredentialStatusV2(resCredHash);

  const root = computeAllowlistRoot(pol.allowlist);
  const commitmentMatch =
    String(publicSignals.liveCommitment).toLowerCase() ===
      live.claimsCommitment.toLowerCase() &&
    String(publicSignals.resCommitment).toLowerCase() ===
      residence.claimsCommitment.toLowerCase();
  const policyRootMatch =
    String(publicSignals.allowlistRoot).toLowerCase() === root.toLowerCase();
  const scoreMatch = Number(publicSignals.minScoreBps) === pol.minScoreBps;
  const subjectMatch =
    live.subject.toLowerCase() === residence.subject.toLowerCase();

  const ok =
    liveValid &&
    resValid &&
    commitmentMatch &&
    policyRootMatch &&
    scoreMatch &&
    subjectMatch;

  const subjectAddress = live.subject as Address;
  const subjectDid =
    input.subjectDid?.startsWith("did:peranto:")
      ? input.subjectDid
      : formatDid(network, subjectAddress);

  const profile = {
    mode: "zk",
    subjectDid,
    subject: subjectAddress,
    liveValid,
    residenceValid: resValid,
    commitmentMatch,
    policyRootMatch,
    minScoreBps: pol.minScoreBps,
    allowlist: pol.allowlist,
    allowlistRoot: root,
    disclosed: null,
    note: "ZK binding stored — claim values not retained",
    checkedAt: new Date().toISOString(),
  };

  const checks = {
    liveValid,
    resValid,
    commitmentMatch,
    policyRootMatch,
    scoreMatch,
    subjectMatch,
  };

  const row = await prisma.application.create({
    data: {
      bountyId,
      subjectDid,
      subjectAddress,
      mode: ApplicationMode.ZK,
      status: ok ? ApplicationStatus.PASSED : ApplicationStatus.FAILED,
      ok,
      liveCredHash,
      resCredHash,
      liveValid,
      residenceValid: resValid,
      commitmentMatch,
      policyRootMatch,
      profileJson: profile as Prisma.InputJsonValue,
      checksJson: checks as Prisma.InputJsonValue,
      applicantNote: input.applicantNote?.slice(0, 500) ?? null,
      externalRef,
    },
  });
  return serializeApp(row);
}

export async function listApplications(opts: {
  bountyId?: string;
  status?: ApplicationStatus;
  take?: number;
}) {
  const rows = await prisma.application.findMany({
    where: {
      bountyId: opts.bountyId || undefined,
      status: opts.status || undefined,
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 100,
  });
  return rows.map(serializeApp);
}

export async function getApplication(id: string) {
  const row = await prisma.application.findUnique({ where: { id } });
  return row ? serializeApp(row) : null;
}

export async function listMine(subjectDid: string) {
  const rows = await prisma.application.findMany({
    where: { subjectDid },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return rows.map(serializeApp);
}

export async function reviewApplication(params: {
  id: string;
  reviewedBy: string;
  status?: ApplicationStatus;
  curatorNote?: string;
  externalRef?: string | null;
}) {
  const data: Prisma.ApplicationUpdateInput = {};
  if (params.status) {
    data.status = params.status;
    data.reviewedAt = new Date();
    data.reviewedBy = params.reviewedBy;
  }
  if (params.curatorNote !== undefined) {
    data.curatorNote = params.curatorNote?.slice(0, 1000) ?? null;
  }
  if (params.externalRef !== undefined) {
    data.externalRef = cleanExternalRef(params.externalRef);
  }
  if (Object.keys(data).length === 0) {
    const row = await prisma.application.findUniqueOrThrow({
      where: { id: params.id },
    });
    return serializeApp(row);
  }
  const row = await prisma.application.update({
    where: { id: params.id },
    data,
  });
  return serializeApp(row);
}
