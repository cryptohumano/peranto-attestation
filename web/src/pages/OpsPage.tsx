import { useEffect, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Ban,
  Lock,
  Stamp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDesc, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ensureAttester,
  fetchAttesterStatus,
  fetchDiditLast,
  fetchHealth,
  fetchOpsSchemas,
  fetchQueue,
  getOpsToken,
  issueFromQueue,
  opsChallenge,
  opsLogin,
  opsLogout,
  registerSchema,
  revokeCredential,
  setOpsToken,
  syncOpsSchemas,
  type DiditLast,
  type Health,
  type OpsDeployment,
  type OpsSchemaRow,
  type QueueItem,
} from "@/lib/api";
import { getAura, getHolderInfo, personalSign, requestSession } from "@/lib/aura";
import { useAuraSession } from "@/lib/aura-session";
import { useI18n } from "@/lib/i18n";
import { shortAddr } from "@/lib/utils";

export function OpsPage() {
  const { t } = useI18n();
  const auraSession = useAuraSession();
  const [health, setHealth] = useState<Health | null>(null);
  const [last, setLast] = useState<DiditLast | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [authAddress, setAuthAddress] = useState<string | null>(null);
  const [attesterStatus, setAttesterStatus] = useState<{
    authorized: { liveness: boolean; residence: boolean };
    anchor: boolean;
  } | null>(null);
  const [deployment, setDeployment] = useState<OpsDeployment | null>(null);
  const [schemas, setSchemas] = useState<OpsSchemaRow[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [revokeHash, setRevokeHash] = useState("");

  const unlocked = Boolean(authAddress && getOpsToken());

  async function refreshAuthed() {
    setHealth(await fetchHealth());
    if (!getOpsToken()) return;
    setLast(await fetchDiditLast(true));
    setQueue(await fetchQueue());
    try {
      setAttesterStatus(await fetchAttesterStatus());
    } catch {
      /* ignore until authorized on-chain */
    }
    try {
      const cat = await fetchOpsSchemas();
      setDeployment(cat.deployment);
      setSchemas(cat.schemas);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void fetchHealth().then(setHealth).catch(() => undefined);
    if (getOpsToken()) {
      setAuthAddress("session");
      void refreshAuthed().catch((e) =>
        setErr(e instanceof Error ? e.message : String(e))
      );
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const timer = setInterval(() => {
      void refreshAuthed().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [unlocked]);

  async function connectOps() {
    setBusy("login");
    setErr("");
    setMsg("");
    try {
      if (!auraSession.connected) {
        await auraSession.connect().catch(() => undefined);
      }
      const aura = getAura();
      if (!aura) throw new Error(t("ops.noAura"));
      await requestSession(aura);
      const info = await getHolderInfo(aura);
      const h = health ?? (await fetchHealth());
      const allow = (h.opsAllowlist ?? []).map((a) => a.toLowerCase());
      if (!allow.includes(info.address.toLowerCase())) {
        throw new Error(
          t("ops.notAllowlisted", { addr: shortAddr(info.address, 6) })
        );
      }
      const ch = await opsChallenge();
      const sig = await personalSign(aura, ch.message, info.address);
      const session = await opsLogin(ch.challengeId, sig);
      setAuthAddress(session.address);
      setMsg(t("ops.opsOk", { addr: shortAddr(session.address, 6) }));
      await refreshAuthed();
    } catch (e) {
      setOpsToken(null);
      setAuthAddress(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await opsLogout();
    setAuthAddress(null);
    setQueue([]);
    setLast(null);
    setMsg(t("ops.sessionClosed"));
  }

  async function onIssue(sessionId: string, kind: "liveness" | "residence") {
    setBusy(`${sessionId}-${kind}`);
    setMsg("");
    try {
      const r = await issueFromQueue(sessionId, kind);
      setMsg(
        t("ops.issued", {
          kind,
          hash: shortAddr(r.credHash, 6),
          anchored: r.anchored,
        })
      );
      await refreshAuthed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onRevoke() {
    if (!revokeHash.startsWith("0x")) return;
    setBusy("revoke");
    try {
      const r = await revokeCredential(revokeHash, "ops revoke");
      setMsg(t("ops.revoked", { hash: shortAddr(r.txHash, 6) }));
      setRevokeHash("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onRegister(kind: "liveness" | "residence") {
    setBusy(`schema-${kind}`);
    try {
      const r = await registerSchema(kind);
      setMsg(t("ops.schemaTx", { kind, hash: shortAddr(r.txHash, 6) }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onEnsure() {
    setBusy("ensure");
    try {
      const r = await ensureAttester();
      setMsg(t("ops.ensureMsg", { json: JSON.stringify(r.results) }));
      await refreshAuthed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onSyncCatalog() {
    setBusy("sync");
    try {
      const cat = await syncOpsSchemas();
      setDeployment(cat.deployment);
      setSchemas(cat.schemas);
      setMsg(t("ops.syncMsg", { n: cat.schemas.length }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!unlocked) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
            {t("ops.eyebrow")}
          </p>
          <h1 className="font-display text-2xl font-semibold">
            {t("ops.lockedTitle")}
          </h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="size-5" />
              {t("ops.deployerOnly")}
            </CardTitle>
            <CardDesc>
              {t("ops.lockedDesc", {
                addr: health?.deployer ? shortAddr(health.deployer, 6) : "…",
              })}
            </CardDesc>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              disabled={busy !== null || auraSession.busy}
              onClick={() => void connectOps()}
            >
              <Wallet className="size-4" />
              {t("common.enterAura")}
            </Button>
            {err ? <p className="text-sm text-destructive">{err}</p> : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
            {t("ops.eyebrow")}
          </p>
          <h1 className="font-display text-2xl font-semibold">
            {t("ops.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("ops.session", {
              addr: shortAddr(
                authAddress === "session"
                  ? health?.attester ?? ""
                  : authAddress ?? "",
                6
              ),
            })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          {t("common.logout")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-5" />
            {t("ops.health")}
          </CardTitle>
          <CardDesc>{t("ops.healthDesc")}</CardDesc>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-xs">
          {health ? (
            <>
              <p>origin {health.origin}</p>
              <p>
                attester {shortAddr(health.attester, 6)} · deployer{" "}
                {shortAddr(health.deployer ?? "", 6)}
              </p>
              <p>
                anchor {String(health.anchor)} · autoIssue{" "}
                {String(health.autoIssue)} · queue {queue.length}
              </p>
              <p>
                auth Liveness{" "}
                {String(attesterStatus?.authorized.liveness ?? "…")} · Residence{" "}
                {String(attesterStatus?.authorized.residence ?? "…")}
              </p>
            </>
          ) : (
            <p>{t("common.loading")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("ops.catalogTitle")}</CardTitle>
          <CardDesc>{t("ops.catalogDesc")}</CardDesc>
        </CardHeader>
        <CardContent className="space-y-3">
          {deployment ? (
            <div className="space-y-1 font-mono text-[11px]">
              <p>network {deployment.network}</p>
              <p>SchemaRegistry {shortAddr(deployment.schemaRegistry, 8)}</p>
              <p>AttesterRegistry {shortAddr(deployment.attesterRegistry, 8)}</p>
              <p>
                CredentialStatus{" "}
                {shortAddr(deployment.credentialStatusRegistry, 8)}
              </p>
              {deployment.complianceZkVerifier ? (
                <p>
                  ComplianceZkVerifier{" "}
                  {shortAddr(deployment.complianceZkVerifier, 8)}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("ops.noSnapshot")}</p>
          )}
          <div className="space-y-2">
            {schemas.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("ops.noSchemas")}</p>
            ) : (
              schemas.map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{s.schemaKey}</span>
                    {s.onChain ? (
                      <Badge className="bg-primary/15 text-primary">
                        {t("common.onChain")}
                      </Badge>
                    ) : (
                      <Badge>{t("common.pending")}</Badge>
                    )}
                    {s.authorized ? (
                      <Badge className="bg-primary/15 text-primary">
                        {t("common.attesterOk")}
                      </Badge>
                    ) : (
                      <Badge>{t("common.noAuth")}</Badge>
                    )}
                    <Badge>{s.source}</Badge>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    id {shortAddr(s.schemaId, 8)}
                    {s.registerTx
                      ? ` · tx ${shortAddr(s.registerTx, 6)}`
                      : ""}
                  </p>
                </div>
              ))
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void onSyncCatalog()}
          >
            {t("ops.syncCatalog")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("ops.schemaFlow")}</CardTitle>
          <CardDesc>{t("ops.schemaFlowDesc")}</CardDesc>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void onRegister("liveness")}
          >
            {t("ops.registerLive")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void onRegister("residence")}
          >
            {t("ops.registerRes")}
          </Button>
          <Button size="sm" disabled={busy !== null} onClick={() => void onEnsure()}>
            {t("ops.ensure")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("ops.lastWebhook")}</CardTitle>
        </CardHeader>
        <CardContent>
          {last ? (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge>{last.status}</Badge>
                {last.status === "Approved" ? (
                  <Badge className="bg-primary/15 text-primary">
                    <BadgeCheck className="mr-1 size-3" />
                    {t("ops.ready")}
                  </Badge>
                ) : null}
              </div>
              <p className="font-mono text-xs break-all">
                {last.session_id} · {last.vendor_data}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("ops.noEvents")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stamp className="size-5" />
            {t("ops.sessions")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("ops.emptyQueue")}</p>
          ) : (
            queue.map((item) => {
              const liveDone = item.issued.some((i) => i.kind === "liveness");
              const resDone = item.issued.some((i) => i.kind === "residence");
              return (
                <div
                  key={item.sessionId}
                  className="rounded-lg border border-border bg-muted/30 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{item.status}</Badge>
                    <span className="font-mono text-[11px]">
                      {item.sessionId.slice(0, 8)}…
                    </span>
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                    {item.subjectDid ?? t("ops.noDid")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={
                        !item.subjectDid ||
                        liveDone ||
                        item.status !== "Approved" ||
                        busy !== null
                      }
                      onClick={() => void onIssue(item.sessionId, "liveness")}
                    >
                      {t("ops.issueLive")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!item.subjectDid || resDone || busy !== null}
                      onClick={() => void onIssue(item.sessionId, "residence")}
                    >
                      {t("ops.issueRes")}
                    </Button>
                  </div>
                  {item.issued.map((i) => (
                    <p key={i.credHash} className="mt-1 font-mono text-[10px]">
                      {i.kind} {shortAddr(i.credHash, 8)} anchor=
                      {String(i.anchored)}
                      <button
                        type="button"
                        className="ml-2 text-primary underline"
                        onClick={() => setRevokeHash(i.credHash)}
                      >
                        {t("ops.revoke")}
                      </button>
                    </p>
                  ))}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="size-5" />
            {t("ops.revokeTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder={t("ops.revokePlaceholder")}
            value={revokeHash}
            onChange={(e) => setRevokeHash(e.target.value.trim())}
          />
          <Button
            variant="outline"
            disabled={busy !== null || !revokeHash.startsWith("0x")}
            onClick={() => void onRevoke()}
          >
            {t("ops.revokeBtn")}
          </Button>
        </CardContent>
      </Card>

      {msg ? <p className="text-sm text-primary">{msg}</p> : null}
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
    </div>
  );
}
