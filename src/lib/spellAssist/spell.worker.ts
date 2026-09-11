/**
 * Web Worker do corretor ortográfico.
 *
 * O parse do dicionário Hunspell pt-BR (~5 MB) pelo nspell leva VÁRIOS segundos
 * de CPU. Rodando aqui, fora da thread principal, a tela do chat nunca trava —
 * nem ao abrir a conversa nem na 1ª tecla digitada. A thread principal só envia
 * palavras e recebe `null` (correta) ou uma lista de sugestões.
 */
import nspell from "nspell";

interface NspellLike {
  correct: (word: string) => boolean;
  suggest: (word: string) => string[];
}

type InMsg =
  | { type: "init"; affUrl: string; dicUrl: string }
  | { type: "check"; id: number; words: string[] };

type OutMsg =
  | { type: "ready"; ok: boolean }
  | { type: "result"; id: number; results: Record<string, string[] | null> };

const ctx = self as unknown as { postMessage: (m: OutMsg) => void; onmessage: ((e: MessageEvent<InMsg>) => void) | null };

console.log("[spell.worker] booted");
let spell: NspellLike | null = null;
let loading: Promise<NspellLike | null> | null = null;

function load(affUrl: string, dicUrl: string) {
  if (!loading) {
    loading = (async () => {
      try {
        const [aff, dic] = await Promise.all([
          fetch(affUrl).then((r) => r.text()),
          fetch(dicUrl).then((r) => r.text()),
        ]);
        console.log("[spell.worker] fetched", aff.length, dic.length); const t0 = Date.now();
        spell = (nspell as unknown as (aff: string, dic: string) => NspellLike)(aff, dic);
        console.log("[spell.worker] parsed in", Date.now() - t0, "ms");
        ctx.postMessage({ type: "ready", ok: true });
        return spell;
      } catch (err) {
        console.error("[spell.worker] failed", err);
        ctx.postMessage({ type: "ready", ok: false });
        return null;
      }
    })();
  }
  return loading;
}

ctx.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === "init") {
    void load(msg.affUrl, msg.dicUrl);
    return;
  }
  if (msg.type === "check") {
    const s = spell ?? (loading ? await loading : null);
    const results: Record<string, string[] | null> = {};
    if (s) {
      for (const word of msg.words) {
        try {
          if (s.correct(word)) {
            results[word] = null;
          } else {
            const sug = s.suggest(word).slice(0, 3);
            results[word] = sug.length ? sug : null;
          }
        } catch {
          results[word] = null;
        }
      }
    } else {
      for (const word of msg.words) results[word] = null;
    }
    ctx.postMessage({ type: "result", id: msg.id, results });
  }
};
