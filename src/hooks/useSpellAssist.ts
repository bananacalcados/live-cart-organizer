import { useCallback, useEffect, useRef, useState } from "react";
import { findMisspellings, type Misspelling } from "@/lib/spellAssist/dictionary";

const IGNORED_KEY = "spellassist:ignored";

function loadIgnored(): Set<string> {
  try {
    const raw = localStorage.getItem(IGNORED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function persistIgnored(set: Set<string>) {
  try {
    localStorage.setItem(IGNORED_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

/**
 * useSpellAssist — observa o texto digitado (com debounce) e devolve sugestões
 * de palavras possivelmente erradas. NÃO altera o texto sozinho; quem decide é o
 * componente que chama `applySuggestion`.
 */
export function useSpellAssist(text: string, enabled = true) {
  const [suggestions, setSuggestions] = useState<Misspelling[]>([]);
  const ignoredRef = useRef<Set<string>>(loadIgnored());

  useEffect(() => {
    if (!enabled || !text.trim()) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const found = await findMisspellings(text);
      if (cancelled) return;
      setSuggestions(found.filter((m) => !ignoredRef.current.has(m.word.toLowerCase())));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, enabled]);

  /** Remove a sugestão só desta vez (não persiste). */
  const dismiss = useCallback((word: string) => {
    setSuggestions((s) => s.filter((m) => m.word.toLowerCase() !== word.toLowerCase()));
  }, []);

  /** Ignora a palavra para sempre (vocabulário pessoal em localStorage). */
  const addToDictionary = useCallback((word: string) => {
    ignoredRef.current.add(word.toLowerCase());
    persistIgnored(ignoredRef.current);
    setSuggestions((s) => s.filter((m) => m.word.toLowerCase() !== word.toLowerCase()));
  }, []);

  return { suggestions, dismiss, addToDictionary };
}
