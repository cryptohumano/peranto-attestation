type AuraProvider = {
  isAura?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export function getAura(): AuraProvider | null {
  const w = window as unknown as {
    aura?: AuraProvider;
    ethereum?: AuraProvider & { providers?: AuraProvider[] };
  };
  if (w.aura?.request) return w.aura;
  const hit = w.ethereum?.providers?.find((p) => p.isAura);
  if (hit) return hit;
  if (w.ethereum?.isAura) return w.ethereum;
  return null;
}

export async function getHolderDid(aura: AuraProvider): Promise<string> {
  const info = (await aura.request({ method: "peranto_getDid" })) as {
    did: string;
  };
  return info.did;
}

export async function getHolderInfo(aura: AuraProvider): Promise<{
  did: string;
  address: string;
}> {
  const info = (await aura.request({ method: "peranto_getDid" })) as {
    did: string;
    address?: string;
  };
  let address = info.address ?? "";
  if (!address && info.did) {
    const parts = info.did.split(":");
    address = parts[parts.length - 1] ?? "";
  }
  return { did: info.did, address };
}

export async function requestSession(aura: AuraProvider) {
  return aura.request({ method: "peranto_requestSession", params: [] });
}

/** EIP-191 personal_sign for Ops / curator login. */
export async function personalSign(
  aura: AuraProvider,
  message: string,
  address: string
): Promise<string> {
  const hexMsg = `0x${Array.from(new TextEncoder().encode(message))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
  try {
    return (await aura.request({
      method: "personal_sign",
      params: [hexMsg, address],
    })) as string;
  } catch {
    return (await aura.request({
      method: "personal_sign",
      params: [message, address],
    })) as string;
  }
}

export async function saveCredential(
  aura: AuraProvider,
  params: {
    jwt: string;
    label: string;
    schemaKey: string;
    meta?: Record<string, unknown>;
  }
) {
  return aura.request({
    method: "peranto_saveCredential",
    params: [params],
  });
}

export async function requestCredential(
  aura: AuraProvider,
  params: {
    schemaKeys: string[];
    challenge: string;
    mode?: "credential" | "claims";
    disclose?: string[];
  }
) {
  return aura.request({
    method: "peranto_requestCredential",
    params: [params],
  });
}

/** Prove compliance inside Aura; returns publicSignals only (no salt/claims). */
export async function proveComplianceGate(
  aura: AuraProvider,
  params: { minScoreBps: number; allowlist: string[] }
) {
  return (await aura.request({
    method: "peranto_proveComplianceGate",
    params: [params],
  })) as {
    mode: "honk" | "algebraic";
    liveCredHash: string;
    resCredHash: string;
    publicSignals: unknown;
    proof?: { proof: string; publicInputs: string[] };
    note: string;
  };
}
