import { randomBytes, createHash } from "node:crypto";
import type { Address, Hex } from "viem";
import { recoverMessageAddress, getAddress } from "viem";

type Challenge = { message: string; exp: number };
type Session = { address: Address; exp: number };

const challenges = new Map<string, Challenge>();
const sessions = new Map<string, Session>();

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function prune() {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k);
  for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k);
}

export function normalizeAllowlist(addrs: string[]): Address[] {
  const out: Address[] = [];
  for (const a of addrs) {
    try {
      if (a?.startsWith("0x") && a.length === 42) out.push(getAddress(a));
    } catch {
      /* skip */
    }
  }
  return [...new Set(out.map((x) => x.toLowerCase()))].map((x) =>
    getAddress(x)
  );
}

export function isAllowlisted(address: string, allowlist: Address[]): boolean {
  try {
    const a = getAddress(address).toLowerCase();
    return allowlist.some((x) => x.toLowerCase() === a);
  } catch {
    return false;
  }
}

export function createOpsChallenge(origin: string): {
  challengeId: string;
  message: string;
  expiresAt: string;
} {
  prune();
  const challengeId = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const message = [
    "Peranto Ops login",
    `Origin: ${origin}`,
    `Challenge: ${challengeId}`,
    `IssuedAt: ${issuedAt}`,
  ].join("\n");
  challenges.set(challengeId, {
    message,
    exp: Date.now() + CHALLENGE_TTL_MS,
  });
  return {
    challengeId,
    message,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  };
}

export async function loginOps(params: {
  challengeId: string;
  signature: Hex;
  allowlist: Address[];
}): Promise<{ token: string; address: Address; expiresAt: string }> {
  prune();
  const ch = challenges.get(params.challengeId);
  if (!ch) throw new Error("challenge expired or unknown");
  challenges.delete(params.challengeId);

  const address = await recoverMessageAddress({
    message: ch.message,
    signature: params.signature,
  });
  if (!isAllowlisted(address, params.allowlist)) {
    throw new Error("address not in ops allowlist");
  }

  const token = createHash("sha256")
    .update(randomBytes(32))
    .digest("hex");
  const exp = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { address, exp });
  return {
    token,
    address,
    expiresAt: new Date(exp).toISOString(),
  };
}

export function resolveOpsSession(token: string | undefined | null): Address | null {
  if (!token) return null;
  prune();
  const s = sessions.get(token);
  if (!s) return null;
  return s.address;
}

export function logoutOps(token: string | undefined | null) {
  if (token) sessions.delete(token);
}
