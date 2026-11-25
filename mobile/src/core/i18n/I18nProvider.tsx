import * as Localization from "expo-localization";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { getKv, setKv } from "@/core/offline/db";
import { translate, type I18nKey, type Lang } from "./dict";

const LANG_KV_KEY = "dukaanos.lang";

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: I18nKey) => string;
  isUrdu: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectInitialLang(): Lang {
  const saved = getKv(LANG_KV_KEY);
  if (saved === "en" || saved === "ur") return saved;
  try {
    const code = Localization.getLocales()[0]?.languageCode?.toLowerCase();
    return code === "ur" ? "ur" : "en";
  } catch {
    return "en";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  const setLang = useCallback((next: Lang) => {
    setKv(LANG_KV_KEY, next);
    setLangState(next);
  }, []);

  const t = useCallback((key: I18nKey) => translate(key, lang), [lang]);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t,
      isUrdu: lang === "ur",
    }),
    [lang, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used inside I18nProvider");
  return ctx;
}
