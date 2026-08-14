import type { summarizeDiditWebhook } from "./didit-webhook.js";

export type DiditSummary = ReturnType<typeof summarizeDiditWebhook>;

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
  summary: DiditSummary;
  issued: IssuedArtifact[];
  autoIssueError?: string | null;
};

const MAX = 50;
const bySession = new Map<string, QueueItem>();
let lastAny: DiditSummary | null = null;
let lastStatusUpdated: DiditSummary | null = null;

export function recordWebhook(summary: DiditSummary): QueueItem | null {
  lastAny = summary;
  if (summary.webhook_type !== "status.updated") return null;
  lastStatusUpdated = summary;
  const sessionId = String(summary.session_id ?? "");
  if (!sessionId) return null;

  const subjectDid =
    typeof summary.vendor_data === "string" &&
    summary.vendor_data.startsWith("did:peranto:")
      ? summary.vendor_data
      : null;

  const prev = bySession.get(sessionId);
  const item: QueueItem = {
    sessionId,
    subjectDid: subjectDid ?? prev?.subjectDid ?? null,
    status: summary.status != null ? String(summary.status) : null,
    workflowId:
      summary.workflow_id != null ? String(summary.workflow_id) : prev?.workflowId ?? null,
    updatedAt: summary.receivedAt,
    summary,
    issued: prev?.issued ?? [],
    autoIssueError: prev?.autoIssueError ?? null,
  };
  bySession.set(sessionId, item);

  // keep newest first by trimming oldest
  if (bySession.size > MAX) {
    const oldest = [...bySession.entries()].sort((a, b) =>
      a[1].updatedAt.localeCompare(b[1].updatedAt)
    )[0];
    if (oldest) bySession.delete(oldest[0]);
  }
  return item;
}

export function getLastAny() {
  return lastAny;
}

export function getLastStatusUpdated() {
  return lastStatusUpdated;
}

export function listQueue(): QueueItem[] {
  return [...bySession.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

export function getQueueItem(sessionId: string) {
  return bySession.get(sessionId) ?? null;
}

export function attachIssued(
  sessionId: string,
  artifact: IssuedArtifact,
  clearError = true
) {
  const item = bySession.get(sessionId);
  if (!item) return null;
  item.issued = [
    ...item.issued.filter((x) => x.kind !== artifact.kind),
    artifact,
  ];
  if (clearError) item.autoIssueError = null;
  item.updatedAt = new Date().toISOString();
  bySession.set(sessionId, item);
  return item;
}

export function setAutoIssueError(sessionId: string, error: string) {
  const item = bySession.get(sessionId);
  if (!item) return;
  item.autoIssueError = error;
  bySession.set(sessionId, item);
}

export function hasIssued(sessionId: string, kind: "liveness" | "residence") {
  return Boolean(bySession.get(sessionId)?.issued.some((x) => x.kind === kind));
}
