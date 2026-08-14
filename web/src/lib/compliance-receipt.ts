import type { ApplicationRow } from "@/lib/api";

export type ReceiptPolicy = {
  minScoreBps?: number;
  allowlist?: string[];
};

/** Business-facing compliance receipt for Formstr / curator archives (no Didit PII). */
export function buildComplianceReceipt(
  app: ApplicationRow,
  policy?: ReceiptPolicy | null
) {
  const disclosed =
    app.mode === "CLAIMS"
      ? {
          score: app.disclosed?.score ?? null,
          country: app.disclosed?.country ?? null,
          expiresAt: app.disclosed?.expiresAt ?? null,
        }
      : null;

  return {
    type: "peranto.ComplianceReceipt.v1",
    formstrPortal: "https://formstr.app/i/kusama-pop",
    externalRef: app.externalRef ?? null,
    applicationId: app.id,
    bountyId: app.bountyId,
    subjectDid: app.subjectDid,
    subjectAddress: app.subjectAddress,
    mode: app.mode,
    result: {
      ok: app.ok,
      status: app.status,
      onChainValid: app.onChainValid ?? null,
    },
    policy: {
      minScoreBps: policy?.minScoreBps ?? null,
      allowlist: policy?.allowlist ?? null,
    },
    credentials: {
      liveCredHash: app.liveCredHash ?? null,
      resCredHash: app.resCredHash ?? null,
      schemaKey: app.schemaKey ?? null,
    },
    disclosed,
    warnings: app.warnings ?? [],
    applicantNote: app.applicantNote ?? null,
    curatorNote: app.curatorNote ?? null,
    reviewedAt: app.reviewedAt ?? null,
    createdAt: app.createdAt,
    note:
      app.mode === "ZK"
        ? "ZK mode: claim values not retained. Process evidence only."
        : "Claims mode: only selectively disclosed fields; no Didit documents.",
  };
}

export function receiptToMarkdown(
  receipt: ReturnType<typeof buildComplianceReceipt>
) {
  const lines = [
    `# Compliance receipt`,
    ``,
    `- **Application:** \`${receipt.applicationId}\``,
    `- **Formstr ref:** ${receipt.externalRef ?? "—"}`,
    `- **Portal:** ${receipt.formstrPortal}`,
    `- **Subject:** \`${receipt.subjectDid}\``,
    `- **Mode:** ${receipt.mode}`,
    `- **Result:** ${receipt.result.ok ? "PASS" : "FAIL"} · ${receipt.result.status}`,
    `- **On-chain:** ${receipt.result.onChainValid == null ? "—" : String(receipt.result.onChainValid)}`,
    `- **Policy:** score≥${receipt.policy.minScoreBps ?? "—"} · allowlist ${(receipt.policy.allowlist ?? []).join(", ") || "—"}`,
    `- **Live cred:** \`${receipt.credentials.liveCredHash ?? "—"}\``,
    `- **Residence cred:** \`${receipt.credentials.resCredHash ?? "—"}\``,
    `- **Created:** ${receipt.createdAt}`,
    `- **Reviewed:** ${receipt.reviewedAt ?? "—"}`,
  ];
  if (receipt.disclosed) {
    lines.push(
      `- **Disclosed:** score=${receipt.disclosed.score ?? "—"} country=${receipt.disclosed.country ?? "—"}`
    );
  }
  if (receipt.applicantNote) {
    lines.push(`- **Applicant note:** ${receipt.applicantNote}`);
  }
  if (receipt.curatorNote) {
    lines.push(`- **Curator note:** ${receipt.curatorNote}`);
  }
  lines.push(``, `_${receipt.note}_`);
  return lines.join("\n");
}
