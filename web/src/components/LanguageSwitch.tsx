import { useI18n } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-messages";
import { cn } from "@/lib/utils";

export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const opts: Locale[] = ["es", "en"];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-0.5 text-xs",
        className
      )}
      role="group"
      aria-label={t("lang")}
    >
      {opts.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={cn(
            "rounded-full px-2.5 py-1 font-semibold transition-colors",
            locale === l
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t(l)}
        </button>
      ))}
    </div>
  );
}
