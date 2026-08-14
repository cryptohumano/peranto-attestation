import { useEffect, useState } from "react";
import { Eye, EyeOff, Send, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDesc, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  fetchHealth,
  fetchMyApplications,
  submitClaimsApplication,
  submitZkApplication,
  type ApplicationRow,
  type Health,
} from "@/lib/api";
import {
  getAura,
  proveComplianceGate,
  requestCredential,
} from "@/lib/aura";
import { useAuraSession } from "@/lib/aura-session";
import { useI18n } from "@/lib/i18n";
import { shortAddr } from "@/lib/utils";

const SCHEMA_LIVENESS = "peranto:LivenessCheck:v1";
const SCHEMA_RESIDENCE = "peranto:ProofOfResidence:v1";
const BOUNTY_ID = "kusama-privacy-identity";

export function ApplyPage() {
  const { t, locale } = useI18n();
  const { did, connected, connect, busy: sessionBusy } = useAuraSession();
  const [health, setHealth] = useState<Health | null>(null);
  const [note, setNote] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [mode, setMode] = useState<"claims" | "zk">("claims");
  const [mine, setMine] = useState<ApplicationRow[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const locked = busy || sessionBusy;

  async function refreshMine(d: string) {
    setMine(await fetchMyApplications(d));
  }

  useEffect(() => {
    void fetchHealth().then(setHealth).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!did) {
      setMine([]);
      return;
    }
    void refreshMine(did).catch(() => undefined);
  }, [did]);

  async function shareAndSubmit(kind: "liveness" | "residence") {
    if (!did) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const aura = getAura();
      if (!aura) throw new Error(t("apply.noAura"));
      const challenge = crypto.randomUUID();
      const schemaKey =
        kind === "liveness" ? SCHEMA_LIVENESS : SCHEMA_RESIDENCE;
      const disclose =
        kind === "liveness" ? ["score", "expiresAt"] : ["country", "expiresAt"];
      setMsg(t("apply.openShare"));
      const presentation = await requestCredential(aura, {
        schemaKeys: [schemaKey],
        challenge,
        mode: "claims",
        disclose,
      });
      const { application } = await submitClaimsApplication({
        presentation,
        challenge,
        applicantNote: note || undefined,
        externalRef: externalRef || undefined,
        bountyId: BOUNTY_ID,
      });
      setMsg(
        t("apply.sentClaims", {
          kind,
          status: application.status,
          id: shortAddr(application.id, 4),
        })
      );
      await refreshMine(did);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function proveAndSubmitZk() {
    if (!did) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const aura = getAura();
      if (!aura) throw new Error(t("apply.noAura"));
      const policy = health?.policy ?? {
        minScoreBps: 9000,
        allowlist: ["MX", "CO", "AR", "ES", "PT"],
      };
      setMsg(t("apply.openZk"));
      const proof = await proveComplianceGate(aura, {
        minScoreBps: policy.minScoreBps,
        allowlist: policy.allowlist,
      });
      const { application } = await submitZkApplication({
        liveCredHash: proof.liveCredHash,
        resCredHash: proof.resCredHash,
        publicSignals: proof.publicSignals,
        proof: proof.proof,
        subjectDid: did,
        applicantNote: note || undefined,
        externalRef: externalRef || undefined,
        bountyId: BOUNTY_ID,
      });
      setMsg(
        t("apply.sentZk", {
          status: application.status,
          ok: application.ok,
          id: shortAddr(application.id, 4),
          mode: proof.mode,
        })
      );
      await refreshMine(did);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <header>
        <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
          {t("apply.eyebrow")}
        </p>
        <h1 className="font-display text-3xl font-semibold">{t("apply.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("apply.subtitle")}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-5" />
            Aura
          </CardTitle>
          <CardDesc>
            {connected && did ? (
              <span className="break-all font-mono text-xs">{did}</span>
            ) : (
              t("shell.needAura")
            )}
          </CardDesc>
        </CardHeader>
        {!connected ? (
          <CardContent>
            <Button
              disabled={locked}
              onClick={() =>
                void connect().catch((e) =>
                  setErr(e instanceof Error ? e.message : String(e))
                )
              }
            >
              {t("common.connectAura")}
            </Button>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("apply.modeTitle")}</CardTitle>
          <CardDesc>{t("apply.modeDesc")}</CardDesc>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button
            type="button"
            variant={mode === "claims" ? "default" : "outline"}
            disabled={locked}
            onClick={() => setMode("claims")}
          >
            <Eye className="size-4" />
            {t("apply.modeClaims")}
          </Button>
          <Button
            type="button"
            variant={mode === "zk" ? "default" : "outline"}
            disabled={locked}
            onClick={() => setMode("zk")}
          >
            <EyeOff className="size-4" />
            {t("apply.modeZk")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="size-5" />
            {mode === "claims" ? t("apply.sendClaims") : t("apply.sendZk")}
          </CardTitle>
          <CardDesc>
            {mode === "claims" ? t("apply.claimsDesc") : t("apply.zkDesc")}
          </CardDesc>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("apply.externalRefLabel")}
            </label>
            <Input
              placeholder={t("apply.externalRefPlaceholder")}
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {t("apply.externalRefHint")}{" "}
              <a
                href="https://formstr.app/i/kusama-pop"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                formstr.app/i/kusama-pop
              </a>
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("apply.noteLabel")}
            </label>
            <Input
              placeholder={t("common.optionalNote")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {t("apply.noteHint")}
            </p>
          </div>
          {mode === "claims" ? (
            <>
              <Button
                disabled={!connected || locked}
                onClick={() => void shareAndSubmit("liveness")}
              >
                {t("apply.shareLive")}
              </Button>
              <Button
                variant="outline"
                disabled={!connected || locked}
                onClick={() => void shareAndSubmit("residence")}
              >
                {t("apply.shareRes")}
              </Button>
            </>
          ) : (
            <Button
              disabled={!connected || locked}
              onClick={() => void proveAndSubmitZk()}
            >
              {t("apply.proveZk")}
            </Button>
          )}
        </CardContent>
      </Card>

      {mine.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("apply.yourSubs")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {mine.map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-1 rounded border border-border px-2 py-1.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{a.status}</Badge>
                  <Badge>{a.mode}</Badge>
                  {a.externalRef ? (
                    <Badge className="max-w-[10rem] truncate" title={a.externalRef}>
                      {a.externalRef}
                    </Badge>
                  ) : null}
                  {a.onChainValid === false ? (
                    <Badge className="bg-destructive/10 text-destructive">
                      {t("common.offChain")}
                    </Badge>
                  ) : null}
                  <span className="font-mono text-[11px]">
                    {shortAddr(a.id, 4)} ·{" "}
                    {new Date(a.createdAt).toLocaleString(locale)}
                  </span>
                </div>
                  {a.applicantNote ? (
                    <p className="text-[11px] text-muted-foreground">
                      {a.applicantNote}
                    </p>
                  ) : null}
                {a.warnings?.length ? (
                  <p className="text-[11px] text-destructive">{a.warnings[0]}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {msg ? <p className="text-sm text-primary">{msg}</p> : null}
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
    </div>
  );
}
