import { create } from "zustand";
import { en, type MessageKey } from "./en";
import { th } from "./th";

export type Lang = "th" | "en";
export const LANGS: Array<{ id: Lang; label: string }> = [
  { id: "th", label: "ไทย" },
  { id: "en", label: "English" },
];

const STORAGE_KEY = "vtt.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "th" || saved === "en") return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("th") ? "th" : "en";
}

interface LangState {
  lang: Lang;
  setLang(lang: Lang): void;
}

export const useLang = create<LangState>((set) => ({
  lang: initialLang(),
  setLang(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang;
    set({ lang });
  },
}));

const dictionaries: Record<Lang, Partial<Record<MessageKey, string>>> = { en, th };

/** Translates a key; `{name}` placeholders are filled from `vars`. Falls back to English. */
export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = dictionaries[lang][key] ?? en[key];
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : raw;
}

export function useT() {
  const lang = useLang((s) => s.lang);
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
}

export type { MessageKey };
