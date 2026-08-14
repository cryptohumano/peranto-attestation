import { useEffect, useState } from "react";
import { BadgeCheck, Fingerprint, Shield, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDesc, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAura, saveCredential } from "@/lib/aura";
import { useAuraSession } from "@/lib/aura-session";
import { createDiditSession, fetchHolderIssued, issueDemo } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { shortAddr } from "@/lib/utils";

export function VerifyPage() {
  const { t } = useI18n();
  const { did, connected, connect, busy: sessionBusy } = useAuraSession();
  const [log, setLog] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<{
    jwt: string;
    schemaKey: string;
    credHash: string;
    kind: string;
    meta?: Record<string, unknown>;
  } | null>(null);

  const locked = busy || sessionBusy;

  useEffect(() => {
    if (!did) return;
    const timer = setInterval(() => {
      void fetchHolderIssued(did)
        .then((items) => {
          const mine = items.find((i) =>
            i.issued.some((x) => x.kind === "liveness")
          );
          const art = mine?.issued.find((x) => x.kind === "liveness");
          if (art && !pendingSave) {
            setPendingSave({
              jwt: art.jwt,
              schemaKey: art.schemaKey,
              credHash: art.credHash,
              kind: art.kind,
              meta: {
                claimsCommitment: art.claimsCommitment,
                commitmentSalt: art.commitmentSalt,
                validUntil: art.validUntil,
                auto: art.auto,
                anchored: art.anchored,
              },
            });
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [did, pendingSave]);

  async function startDidit() {
    if (!did) return;
    setBusy(true);
    try {
      const s = await createDiditSession(did);
      setSessionUrl(s.url);
      setLog(`Sesión ${s.session_id} · vendor_data = DID`);
      window.open(s.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function issueAndSave(kind: "liveness" | "residence") {
    if (!did) return;
    setBusy(true);
    try {
      const aura = getAura();
      if (!aura) throw new Error(t("common.noAura"));
      const issued = await issueDemo(did, kind);
      await saveCredential(aura, {
        jwt: issued.jwt,
        label: kind === "liveness" ? "Liveness" : "Residence",
        schemaKey: issued.schemaKey,
        meta: {
          claimsCommitment: issued.claimsCommitment,
          commitmentSalt: issued.commitmentSalt,
          validUntil: issued.validUntil,
        },
      });
      setLog(
        t("verify.saved", { kind, hash: shortAddr(issued.credHash, 6) })
      );
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <header>
        <p className="mb-2 text-[11px] font-semibold tracking-[0.22em] text-primary uppercase">
          {t("verify.eyebrow")}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          {t("verify.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("verify.subtitle")}</p>
      </header>

      <Card className="overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-primary via-sand to-primary/40" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-5 text-primary" />
            {t("verify.walletTitle")}
          </CardTitle>
          <CardDesc>
            {connected && did ? (
              <span className="break-all font-mono text-xs text-foreground">{did}</span>
            ) : (
              t("shell.needAura")
            )}
          </CardDesc>
        </CardHeader>
        {!connected ? (
          <CardContent>
            <Button
              size="lg"
              disabled={locked}
              onClick={() =>
                void connect()
                  .then(() => setLog(t("shell.walletReady")))
                  .catch((e) =>
                    setLog(e instanceof Error ? e.message : String(e))
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
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="size-5 text-primary" />
            {t("verify.diditTitle")}
          </CardTitle>
          <CardDesc>{t("verify.diditDesc")}</CardDesc>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            variant="secondary"
            disabled={!connected || locked}
            onClick={() => void startDidit()}
          >
            {t("verify.startDidit")}
          </Button>
          {sessionUrl ? (
            <a
              href={sessionUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary underline"
            >
              {t("verify.openSession")}
            </a>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            {t("verify.credTitle")}
          </CardTitle>
          <CardDesc>{t("verify.credDesc")}</CardDesc>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {pendingSave ? (
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-primary/15 text-primary">
                <BadgeCheck className="mr-1 size-3" />
                {t("verify.vcReady")}
              </Badge>
              <Badge>{pendingSave.kind}</Badge>
            </div>
          ) : (
            <p className="text-muted-foreground">{t("verify.waiting")}</p>
          )}
          <div className="flex flex-col gap-2 pt-2">
            {pendingSave ? (
              <Button
                disabled={locked}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      const aura = getAura();
                      if (!aura) throw new Error(t("common.noAura"));
                      await saveCredential(aura, {
                        jwt: pendingSave.jwt,
                        label: "Liveness",
                        schemaKey: pendingSave.schemaKey,
                        meta: pendingSave.meta,
                      });
                      setLog(
                        t("verify.savedAuto", {
                          hash: shortAddr(pendingSave.credHash, 6),
                        })
                      );
                      setPendingSave(null);
                    } catch (e) {
                      setLog(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                {t("verify.saveAuto")}
              </Button>
            ) : null}
            <Button
              disabled={!connected || locked}
              onClick={() => void issueAndSave("liveness")}
            >
              {t("verify.issueLive")}
            </Button>
            <Button
              variant="outline"
              disabled={!connected || locked}
              onClick={() => void issueAndSave("residence")}
            >
              {t("verify.issueRes")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {log ? (
        <p className="rounded-lg border border-border bg-card/80 px-3 py-2 font-mono text-xs">
          {log}
        </p>
      ) : null}
    </div>
  );
}
