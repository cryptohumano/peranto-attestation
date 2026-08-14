import { createHmac, timingSafeEqual } from "node:crypto";

/** Match Didit's float normalisation: whole-valued floats → ints. */
export function shortenFloats(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(shortenFloats);
  if (data !== null && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => [
        k,
        shortenFloats(v),
      ])
    );
  }
  if (typeof data === "number" && !Number.isInteger(data) && data % 1 === 0) {
    return Math.trunc(data);
  }
  return data;
}

export function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj as object)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((obj as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return obj;
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function verifyDiditSignatureV2(
  jsonBody: unknown,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !timestampHeader) return false;
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;
  const canonical = JSON.stringify(sortKeys(shortenFloats(jsonBody)));
  const expected = createHmac("sha256", secret)
    .update(canonical, "utf8")
    .digest("hex");
  return safeEqualHex(expected, signatureHeader);
}

export function verifyDiditSignatureSimple(
  jsonBody: Record<string, unknown>,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !timestampHeader) return false;
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;
  const canonical = [
    jsonBody.timestamp ?? "",
    jsonBody.session_id ?? "",
    jsonBody.status ?? "",
    jsonBody.webhook_type ?? "",
  ].join(":");
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  return safeEqualHex(expected, signatureHeader);
}

type FeatureRow = {
  node_id?: string;
  status?: string;
  score?: number;
  method?: string;
  document_type?: string;
  country?: string;
  region?: string;
};

function mapLiveness(arr: unknown): FeatureRow[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      node_id: o.node_id != null ? String(o.node_id) : undefined,
      status: o.status != null ? String(o.status) : undefined,
      score: typeof o.score === "number" ? o.score : undefined,
      method: o.method != null ? String(o.method) : undefined,
    };
  });
}

function mapPoa(arr: unknown): FeatureRow[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const parsed = (o.poa_parsed_address ?? {}) as Record<string, unknown>;
    return {
      node_id: o.node_id != null ? String(o.node_id) : undefined,
      status: o.status != null ? String(o.status) : undefined,
      document_type:
        o.document_type != null ? String(o.document_type) : undefined,
      country: parsed.country != null ? String(parsed.country) : undefined,
      region: parsed.region != null ? String(parsed.region) : undefined,
    };
  });
}

function mapId(arr: unknown): FeatureRow[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      node_id: o.node_id != null ? String(o.node_id) : undefined,
      status: o.status != null ? String(o.status) : undefined,
      document_type:
        o.document_type != null ? String(o.document_type) : undefined,
    };
  });
}

/** Redacted summary for logs / inspection — no URLs, names, or raw address. */
export function summarizeDiditWebhook(
  body: Record<string, unknown>,
  meta?: { isTest?: boolean; sigOk?: string }
) {
  const decision = (body.decision ?? {}) as Record<string, unknown>;
  return {
    receivedAt: new Date().toISOString(),
    isTest: Boolean(meta?.isTest),
    signature: meta?.sigOk ?? "unknown",
    webhook_type: body.webhook_type ?? null,
    status: body.status ?? null,
    session_id: body.session_id ?? null,
    vendor_data: body.vendor_data ?? null,
    workflow_id: body.workflow_id ?? null,
    environment: body.environment ?? null,
    decisionPresent: Boolean(body.decision),
    liveness_checks: mapLiveness(decision.liveness_checks),
    poa_verifications: mapPoa(decision.poa_verifications),
    id_verifications: mapId(decision.id_verifications),
    face_matches_count: Array.isArray(decision.face_matches)
      ? decision.face_matches.length
      : 0,
    aml_screenings_count: Array.isArray(decision.aml_screenings)
      ? decision.aml_screenings.length
      : 0,
    /** Suggested Peranto mapping */
    mapHint: {
      livenessVc: Array.isArray(decision.liveness_checks)
        ? "peranto:LivenessCheck:v1 from liveness_checks[0].score"
        : null,
      residenceVc: Array.isArray(decision.poa_verifications)
        ? "peranto:ProofOfResidence:v1 from poa_parsed_address.country"
        : null,
      subjectDid:
        typeof body.vendor_data === "string" &&
        body.vendor_data.startsWith("did:peranto:")
          ? body.vendor_data
          : "set vendor_data = did:peranto:… at session create",
    },
  };
}
