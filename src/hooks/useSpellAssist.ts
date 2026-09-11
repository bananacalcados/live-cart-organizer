import { useCallback, useEffect, useRef, useState } from "react";
import { findMisspellings, warmupSpell, type Misspelling } from "@/lib/spellAssist/dictionary";

const IGNORED_KEY = "spellassist:ignored";

// Vocabulário pessoal: lido do localStorage UMA vez por sessão (antes era
// lido/parseado a cada montagem do composer) e compartilhado entre todos os chats.
let ignoredSingleton: Set<string> | null = null;
function getIgnored(): Set<string> {
  if (ignoredSingleton) return ignoredSingleton;
  try {
    const raw = localStorage.getItem(IGNORED_KEY);
    ignoredSingleton = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    ignoredSingleton = new Set();
  }
  return ignoredSingleton;
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
 *
 * Performance:
 *  - o dicionário é preparado em tempo ocioso (requestIdleCallback) assim que o
 *    composer aparece — não trava a 1ª tecla digitada;
 *  - só palavras COMPLETAS são verificadas (a que ainda está sendo digitada é
 *    ignorada), e resultados são cacheados por palavra em `findMisspellings`.
 */
export function useSpellAssist(text: string, enabled = true) {
  const [suggestions, setSuggestions] = useState<Misspelling[]>([]);
  const ignoredRef = useRef<Set<string> | null>(null);
  if (!ignoredRef.current) ignoredRef.current = getIgnored();

  // Aquece o dicionário quando o navegador estiver ocioso (1x por sessão).
  useEffect(() => {
    if (!enabled) return;
    return warmupSpell();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !text.trim()) {
      setSuggestions((s) => (s.length ? [] : s));
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const found = await findMisspellings(text, { skipTrailingWord: true });
      if (cancelled) return;
      const ignored = ignoredRef.current!;
      const next = found.filter((m) => !ignored.has(m.word.toLowerCase()));
      setSuggestions((prev) => {
        // Evita re-render do composer quando a lista de sugestões não mudou.
        if (
          prev.length === next.length &&
          prev.every((p, i) => p.word === next[i].word && p.start === next[i].start)
        ) return prev;
        return next;
      });
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
    const set = ignoredRef.current!;
    set.add(word.toLowerCase());
    persistIgnored(set);
    setSuggestions((s) => s.filter((m) => m.word.toLowerCase() !== word.toLowerCase()));
  }, []);

  return { suggestions, dismiss, addToDictionary };
}
