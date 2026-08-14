import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { messages, type Locale, type MessageTree } from "./i18n-messages";

const STORAGE_KEY = "peranto_locale";

type Dict = Record<string, unknown>;

function getByPath(obj: Dict, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Dict)) {
      return (acc as Dict)[key];
    }
    return undefined;
  }, obj);
}

function interpolate(
  template: string,
  vars?: Record<string, string | number | boolean | null | undefined>
) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] == null ? "" : String(vars[k])
  );
}

type I18nValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (
    key: string,
    vars?: Record<string, string | number | boolean | null | undefined>
  ) => string;
  messages: MessageTree;
};

const I18nContext = createContext<I18nValue | null>(null);

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "es" || saved === "en") return saved;
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "es";
  return nav.toLowerCase().startsWith("en") ? "en" : "es";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === "es" ? "Peranto Attest" : "Peranto Attest";
  }, [locale]);

  const t = useCallback(
    (
      key: string,
      vars?: Record<string, string | number | boolean | null | undefined>
    ) => {
      const tree = messages[locale] as unknown as Dict;
      const hit = getByPath(tree, key);
      if (typeof hit === "string") return interpolate(hit, vars);
      const fallback = getByPath(messages.es as unknown as Dict, key);
      if (typeof fallback === "string") return interpolate(fallback, vars);
      return key;
    },
    [locale]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      messages: messages[locale] as MessageTree,
    }),
    [locale, setLocale, t]
  );

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
