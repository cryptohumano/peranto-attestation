import { Link, NavLink, Outlet } from "react-router-dom";
import { Menu, Wallet, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useAuraSession } from "@/lib/aura-session";
import { useI18n } from "@/lib/i18n";
import { cn, shortAddr } from "@/lib/utils";

const NAV = [
  { to: "/", end: true, key: "nav.verify" as const },
  { to: "/apply", end: false, key: "nav.apply" as const },
  { to: "/gate", end: false, key: "nav.gate" as const },
  { to: "/ops", end: false, key: "nav.ops" as const },
];

function AuraConnectControl() {
  const { t } = useI18n();
  const { connected, address, did, busy, auraReady, connect, disconnect } =
    useAuraSession();

  if (connected) {
    const label = address
      ? shortAddr(address, 4)
      : did
        ? shortAddr(did.split(":").pop() ?? did, 4)
        : "—";
    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
          title={did ?? undefined}
        >
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          {t("nav.connected")}
          <span className="font-mono font-medium text-tide-deep">{label}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden h-8 text-xs sm:inline-flex"
          onClick={disconnect}
        >
          {t("common.logout")}
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      disabled={busy || auraReady === false}
      onClick={() => void connect().catch(() => undefined)}
      title={
        auraReady === false ? t("nav.installAura") : t("common.connectAura")
      }
    >
      <Wallet className="size-3.5" />
      {busy ? t("common.connecting") : t("common.connectAura")}
    </Button>
  );
}

function NavLinks({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <nav className={cn("flex items-center gap-1", className)}>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )
          }
        >
          {t(item.key)}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { t } = useI18n();
  const { error, clearError, auraReady, redetect } = useAuraSession();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <Link
            to="/"
            className="shrink-0 font-display text-lg font-semibold tracking-tight text-ink"
          >
            {t("brand")}
            <span className="ml-1.5 text-sm font-normal text-primary">
              Attest
            </span>
          </Link>

          <NavLinks className="ml-2 hidden md:flex" />

          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitch className="hidden sm:inline-flex" />
            <AuraConnectControl />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
          </div>
        </div>

        {open ? (
          <div className="border-t border-border px-4 py-3 md:hidden">
            <NavLinks
              className="flex-col items-stretch"
              onNavigate={() => setOpen(false)}
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <LanguageSwitch />
              {auraReady === false ? (
                <button
                  type="button"
                  className="text-xs text-primary underline"
                  onClick={redetect}
                >
                  {t("common.detectShort")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-center text-xs text-destructive">
            <span>
              {error === "AURA_NOT_FOUND" ? t("nav.installAura") : error}
            </span>
            <button
              type="button"
              className="ml-2 underline"
              onClick={clearError}
            >
              {t("common.close")}
            </button>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:py-10">
        <Outlet />
      </main>

      <footer className="mt-auto border-t border-border/70 bg-card/50">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-5 text-center text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <p>
            <span className="font-display font-semibold text-foreground">
              {t("brand")} Attest
            </span>
            <span className="mx-1.5 text-border">·</span>
            {t("footer.tagline")}
          </p>
          <p>{t("footer.hint")}</p>
        </div>
      </footer>
    </div>
  );
}
