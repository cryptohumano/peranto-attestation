import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Inbox,
  Link2,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDesc, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  curatorLogin,
  fetchCuratorApplications,
  fetchHealth,
  getCuratorToken,
  opsChallenge,
  opsLogout,
  reviewCuratorApplication,
  setCuratorToken,
  type ApplicationRow,
  type Health,
} from "@/lib/api";
import { getAura, getHolderInfo, personalSign, requestSession } from "@/lib/aura";
import { useAuraSession } from "@/lib/aura-session";
import {
  buildComplianceReceipt,
  receiptToMarkdown,
} from "@/lib/compliance-receipt";
import { useI18n } from "@/lib/i18n";
import { cn, shortAddr } from "@/lib/utils";

type Filter = "all" | "PASSED" | "FAILED" | "REVIEWED" | "ZK" | "CLAIMS";

function statusTone(status: string, ok: boolean) {
  if (status === "REVIEWED") return "border-l-sand bg-sand/10";
  if (status === "PASSED" || ok) return "border-l-primary bg-primary/5";
  if (status === "FAILED" || !ok) return "border-l-destructive bg-destructive/5";
  return "border-l-border bg-card";
}

function didMonogram(did: string) {
  const addr = did.split(":").pop() ?? did;
  return addr.slice(2, 4).toUpperCase();
}

export function CuratorPage() {
  const { t, locale } = useI18n();
  const auraSession = useAuraSession();
  const [health, setHealth] = useState<Health | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const auraReady = auraSession.auraReady;
  const [items, setItems] = useState<ApplicationRow[]>([]);
  const [selected, setSelected] = useState<ApplicationRow | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [note, setNote] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [receiptMsg, setReceiptMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const unlocked = Boolean(address && getCuratorToken());

  function relativeTime(iso: string) {
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return iso;
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return t("common.now");
    if (mins < 60) return t("common.minsAgo", { n: mins });
    const h = Math.round(mins / 60);
    if (h < 48) return t("common.hoursAgo", { n: h });
    return new Date(ts).toLocaleDateString(locale);
  }

  const stats = useMemo(() => {
    const passed = items.filter((i) => i.status === "PASSED" || i.ok).length;
    const failed = items.filter((i) => i.status === "FAILED" || !i.ok).length;
    const reviewed = items.filter((i) => i.status === "REVIEWED").length;
    const zk = items.filter((i) => i.mode === "ZK").length;
    const claims = items.filter((i) => i.mode === "CLAIMS").length;
    return { passed, failed, reviewed, zk, claims, total: items.length };
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((a) => {
      if (filter === "all") return true;
      if (filter === "ZK" || filter === "CLAIMS") return a.mode === filter;
      return a.status === filter;
    });
  }, [items, filter]);

  function clearSession() {
    setCuratorToken(null);
    setAddress(null);
    setItems([]);
    setSelected(null);
  }

  async function refresh() {
    try {
      const next = await fetchCuratorApplications();
      setItems(next);
      setSelected((cur) =>
        cur ? next.find((x) => x.id === cur.id) ?? null : null
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/401|session|ops session|curator session|unauthorized/i.test(msg)) {
        clearSession();
        setErr(t("gate.sessionExpired"));
        return;
      }
      throw e;
    }
  }

  useEffect(() => {
    void fetchHealth().then(setHealth).catch(() => undefined);
    if (getCuratorToken()) {
      setAddress("session");
      void refresh().catch((e) => {
        clearSession();
        setErr(e instanceof Error ? e.message : String(e));
      });
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const timer = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 8000);
    return () => clearInterval(timer);
  }, [unlocked]);

  async function connect() {
    setBusy(true);
    setErr("");
    try {
      if (!auraSession.connected) {
        await auraSession.connect().catch(() => undefined);
      }
      const aura = getAura();
      if (!aura) {
        throw new Error(t("gate.noAuraDetail"));
      }
      await requestSession(aura);
      const info = await getHolderInfo(aura);
      const h = health ?? (await fetchHealth());
      const allow = (h.curatorAllowlist ?? h.opsAllowlist ?? []).map((a) =>
        a.toLowerCase()
      );
      if (!info.address || !allow.includes(info.address.toLowerCase())) {
        throw new Error(
          t("gate.notAllowlisted", {
            addr: info.address ? shortAddr(info.address, 6) : "(vacía)",
          })
        );
      }
      const ch = await opsChallenge();
      const sig = await personalSign(aura, ch.message, info.address);
      const session = await curatorLogin(ch.challengeId, sig);
      setAddress(session.address);
      setErr("");
      await refresh();
    } catch (e) {
      clearSession();
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await opsLogout().catch(() => undefined);
    clearSession();
    setErr("");
  }

  async function markReviewed(id: string) {
    setBusy(true);
    try {
      await reviewCuratorApplication(id, {
        status: "REVIEWED",
        curatorNote: note || undefined,
        // Keep existing ref if input left blank (avoid wiping after stale session)
        ...(externalRef.trim()
          ? { externalRef: externalRef.trim() }
          : selected?.externalRef
            ? {}
            : { externalRef: null }),
      });
      setNote("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveExternalRef(id: string) {
    setBusy(true);
    setReceiptMsg("");
    try {
      await reviewCuratorApplication(id, {
        externalRef: externalRef || null,
      });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyReceipt(format: "json" | "md") {
    if (!selected) return;
    const receipt = buildComplianceReceipt(selected, health?.policy);
    const text =
      format === "json"
        ? JSON.stringify(receipt, null, 2)
        : receiptToMarkdown(receipt);
    try {
      await navigator.clipboard.writeText(text);
      setReceiptMsg(t("gate.receiptCopied"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (!unlocked) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
            {t("gate.eyebrow")}
          </p>
          <h1 className="font-display text-3xl font-semibold">
            {t("gate.titleLocked")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("gate.subtitleLocked")}
          </p>
        </div>
        <Card className="overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-primary via-sand to-primary/40" />
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="size-5" />
              {t("gate.auraState")}
            </CardTitle>
            <CardDesc>
              {t("common.extension")}:{" "}
              {auraReady
                ? t("common.detected")
                : auraReady === null
                  ? t("common.loading")
                  : t("common.notDetected")}
              {health?.curatorAllowlist?.[0]
                ? ` · ${t("common.allowlist")} ${shortAddr(health.curatorAllowlist[0], 6)}`
                : null}
            </CardDesc>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={busy || auraSession.busy}
              onClick={() => void connect()}
            >
              <Lock className="size-4" />
              {busy || auraSession.busy
                ? t("common.connecting")
                : t("common.enterAura")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => auraSession.redetect()}
            >
              <RefreshCw className="size-3.5" />
              {t("common.detectShort")}
            </Button>
            {err ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {err}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  const filters: { id: Filter; label: string; count?: number }[] = [
    { id: "all", label: t("common.all"), count: stats.total },
    { id: "PASSED", label: t("common.pass"), count: stats.passed },
    { id: "FAILED", label: t("common.fail"), count: stats.failed },
    { id: "REVIEWED", label: t("common.reviewed"), count: stats.reviewed },
    { id: "ZK", label: t("common.zk"), count: stats.zk },
    { id: "CLAIMS", label: t("common.claims"), count: stats.claims },
  ];

  const countries = (health?.policy?.allowlist ?? []).slice(0, 4).join(", ");
  const countriesExtra = (health?.policy?.allowlist?.length ?? 0) > 4 ? "…" : "";

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
            {t("gate.eyebrow")}
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("gate.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("gate.policyLine", {
              addr:
                shortAddr(address === "session" ? "" : address ?? "", 6) ||
                t("common.session"),
              score: health?.policy?.minScoreBps ?? "—",
              countries: `${countries}${countriesExtra}`,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" />
            {t("common.refresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            {t("common.logout")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: t("common.pass"),
            value: stats.passed,
            icon: ShieldCheck,
            tone: "text-primary",
          },
          {
            label: t("common.fail"),
            value: stats.failed,
            icon: ShieldAlert,
            tone: "text-destructive",
          },
          {
            label: t("common.zk"),
            value: stats.zk,
            icon: EyeOff,
            tone: "text-tide-deep",
          },
          {
            label: t("common.claims"),
            value: stats.claims,
            icon: Eye,
            tone: "text-sand",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-border bg-card/80 px-4 py-3 shadow-[0_1px_0_rgba(13,92,99,0.06)]"
          >
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {s.label}
              </p>
              <s.icon className={cn("size-4", s.tone)} />
            </div>
            <p className="font-display mt-1 text-3xl font-semibold tabular-nums">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === f.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted/60"
            )}
          >
            {f.label}
            {f.count != null ? (
              <span className="ml-1 opacity-80">{f.count}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Inbox className="size-4" />
            {t("gate.ofTotal", {
              filtered: filtered.length,
              total: items.length,
            })}
          </div>
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {t("gate.emptyFilter")}
              </CardContent>
            </Card>
          ) : (
            filtered.map((a) => {
              const active = selected?.id === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setSelected(a);
                    setShowRaw(false);
                    setExternalRef(a.externalRef ?? "");
                    setNote(a.curatorNote ?? "");
                    setReceiptMsg("");
                  }}
                  className={cn(
                    "w-full rounded-xl border border-l-4 p-4 text-left transition-all",
                    statusTone(a.status, a.ok),
                    active
                      ? "ring-2 ring-primary/40 shadow-sm"
                      : "hover:border-primary/30"
                  )}
                >
                  <div className="flex gap-3">
                    <div
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold",
                        a.ok
                          ? "bg-primary/15 text-primary"
                          : "bg-destructive/10 text-destructive"
                      )}
                    >
                      {didMonogram(a.subjectDid)}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {a.ok ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                            <CheckCircle2 className="size-3.5" />{" "}
                            {t("common.pass")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                            <XCircle className="size-3.5" /> {t("common.fail")}
                          </span>
                        )}
                        <Badge className="text-[10px]">{a.status}</Badge>
                        <Badge className="text-[10px]">
                          {a.mode === "ZK" ? (
                            <span className="inline-flex items-center gap-1">
                              <EyeOff className="size-3" /> {t("common.zk")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Eye className="size-3" /> {t("common.claims")}
                            </span>
                          )}
                        </Badge>
                        {a.onChainValid === true ? (
                          <Badge className="bg-primary/15 text-[10px] text-primary">
                            <Link2 className="mr-1 size-3" />
                            {t("common.onChain")}
                          </Badge>
                        ) : a.onChainValid === false ? (
                          <Badge className="bg-destructive/10 text-[10px] text-destructive">
                            {t("common.offChain")}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {a.subjectDid}
                      </p>
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        {a.disclosed?.score != null ? (
                          <span className="rounded-md bg-muted px-2 py-0.5">
                            {t("common.score")} {a.disclosed.score}
                          </span>
                        ) : null}
                        {a.disclosed?.country != null ? (
                          <span className="rounded-md bg-muted px-2 py-0.5">
                            {a.disclosed.country}
                          </span>
                        ) : a.mode === "ZK" ? (
                          <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                            {t("gate.hiddenClaims")}
                          </span>
                        ) : null}
                        {a.applicantNote ? (
                          <span
                            className="max-w-[10rem] truncate rounded-md bg-muted px-2 py-0.5 text-muted-foreground"
                            title={a.applicantNote}
                          >
                            {a.applicantNote}
                          </span>
                        ) : null}
                        {a.externalRef ? (
                          <span
                            className="max-w-[9rem] truncate rounded-md bg-sand/20 px-2 py-0.5 text-tide-deep"
                            title={a.externalRef}
                          >
                            {a.externalRef}
                          </span>
                        ) : null}
                        <span className="text-muted-foreground">
                          {relativeTime(a.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </section>

        <section className="lg:sticky lg:top-4 lg:self-start">
          {selected ? (
            <Card className="overflow-hidden">
              <div
                className={cn(
                  "h-1.5",
                  selected.ok
                    ? "bg-gradient-to-r from-primary to-tide-deep"
                    : "bg-gradient-to-r from-destructive to-sand"
                )}
              />
              <CardHeader>
                <CardTitle className="font-display text-xl">
                  {t("gate.profileTitle")}
                </CardTitle>
                <CardDesc className="break-all font-mono text-[11px]">
                  {selected.subjectDid}
                </CardDesc>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
                      {t("common.result")}
                    </p>
                    <p className="font-semibold">
                      {selected.ok ? "PASS" : "FAIL"} · {selected.status}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
                      {t("common.mode")}
                    </p>
                    <p className="font-semibold">{selected.mode}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
                      On-chain
                    </p>
                    <p className="font-semibold">
                      {selected.onChainValid == null
                        ? "—"
                        : selected.onChainValid
                          ? t("gate.onChainValid")
                          : t("gate.onChainInvalid")}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
                      {t("common.received")}
                    </p>
                    <p className="font-semibold">
                      {relativeTime(selected.createdAt)}
                    </p>
                  </div>
                </div>

                {(selected.disclosed?.score != null ||
                  selected.disclosed?.country != null) && (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      Disclosed
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selected.disclosed?.score != null ? (
                        <div className="rounded-xl border border-border bg-card px-4 py-3">
                          <p className="text-[10px] text-muted-foreground uppercase">
                            {t("common.score")}
                          </p>
                          <p className="font-display text-2xl font-semibold">
                            {selected.disclosed.score}
                          </p>
                        </div>
                      ) : null}
                      {selected.disclosed?.country != null ? (
                        <div className="rounded-xl border border-border bg-card px-4 py-3">
                          <p className="text-[10px] text-muted-foreground uppercase">
                            {t("common.country")}
                          </p>
                          <p className="font-display text-2xl font-semibold">
                            {selected.disclosed.country}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                {selected.mode === "ZK" ? (
                  <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                    {t("gate.zkNote")}
                  </p>
                ) : null}

                {selected.warnings && selected.warnings.length > 0 ? (
                  <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2">
                    <p className="mb-1 text-[11px] font-semibold text-destructive">
                      {t("common.warnings")}
                    </p>
                    <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
                      {selected.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div>
                  <button
                    type="button"
                    className="text-xs text-primary underline"
                    onClick={() => setShowRaw((v) => !v)}
                  >
                    {showRaw ? t("common.hideJson") : t("common.showJson")}
                  </button>
                  {showRaw ? (
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-[10px]">
                      {JSON.stringify(selected.profile ?? selected, null, 2)}
                    </pre>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("gate.applicantNote")}
                  </p>
                  {selected.applicantNote ? (
                    <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                      {selected.applicantNote}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      {t("gate.noApplicantNote")}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {t("gate.externalRef")}
                    </p>
                    <a
                      href="https://formstr.app/i/kusama-pop"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-primary underline"
                    >
                      {t("gate.openFormstr")}
                    </a>
                  </div>
                  {selected.externalRef ? (
                    <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-xs break-all text-primary">
                      {selected.externalRef}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      —
                    </p>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      placeholder={t("gate.externalRefPlaceholder")}
                      value={externalRef}
                      onChange={(e) => setExternalRef(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void saveExternalRef(selected.id)}
                    >
                      {t("gate.saveRef")}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("common.curatorNote")}
                  </p>
                  <Input
                    placeholder={t("common.curatorNote")}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy || selected.status === "REVIEWED"}
                    onClick={() => void markReviewed(selected.id)}
                  >
                    {t("common.markReviewed")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void copyReceipt("json")}
                  >
                    <Copy className="size-3.5" />
                    {t("gate.copyReceiptJson")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void copyReceipt("md")}
                  >
                    <Copy className="size-3.5" />
                    {t("gate.copyReceiptMd")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSelected(null)}
                  >
                    {t("common.close")}
                  </Button>
                </div>
                {receiptMsg ? (
                  <p className="text-xs text-primary">{receiptMsg}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex min-h-64 flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
                <Inbox className="size-8 text-primary/40" />
                <p>{t("gate.selectHint")}</p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>

      {err ? <p className="text-sm text-destructive">{err}</p> : null}
    </div>
  );
}
