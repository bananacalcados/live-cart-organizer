/**
 * Engine de ortografia offline (sem IA) baseado em nspell + dicionário Hunspell pt-BR.
 *
 * - Carregamento LAZY: o dicionário (~5 MB) só é baixado quando o primeiro chat
 *   precisa verificar uma mensagem. Fica em cache no módulo (1x por sessão).
 * - Allowlist de gírias/marcas para reduzir falsos positivos do dicionário.
 */

export interface Misspelling {
  word: string;
  start: number;
  end: number;
  suggestions: string[];
}

interface NspellLike {
  correct: (word: string) => boolean;
  suggest: (word: string) => string[];
}

/** Gírias, abreviações de chat e marcas que NÃO devem ser marcadas como erro. */
const ALLOWLIST = new Set<string>([
  // abreviações / gírias de chat
  "vc", "voce", "pra", "pro", "pras", "pros", "blz", "vlw", "obg", "tbm", "tb",
  "qnd", "qdo", "pq", "oq", "dnv", "hj", "msg", "msm", "mt", "mto", "mta", "mtos",
  "ta", "to", "neh", "ne", "rs", "rsrs", "kk", "kkk", "kkkk", "add", "ok", "okay",
  "app", "apps", "pdf", "pix", "cep", "cpf", "cnpj", "whatsapp", "zap", "zapzap",
  "insta", "stories", "story", "reels", "link", "links", "online", "off", "kit",
  "kits", "combo", "combos", "num", "tam", "qtd", "obs", "nf", "nfe", "boa",
  "amada", "amado", "linda", "lindo", "flor", "querida", "querido",
  // marcas de calçados comuns
  "modare", "usaflex", "beira", "vizzano", "moleca", "dakota", "ramarim",
  "bottero", "mississipi", "cartago", "ipanema", "rider", "melissa", "havaianas",
  "klin", "bibi", "ortope", "ortopedico", "piccadilly", "comfortflex", "azaleia",
  "kolosh", "bebece", "campesi", "democrata", "ferracini", "pegada", "westcoast",
  "banana", "calcados",
]);

let spellPromise: Promise<NspellLike> | null = null;

async function getSpell(): Promise<NspellLike> {
  if (!spellPromise) {
    spellPromise = (async () => {
      const [nspellMod, affMod, dicMod] = await Promise.all([
        import("nspell"),
        // dicionários carregados como texto cru (compatível com browser/Vite)
        import("dictionary-pt/index.aff?raw"),
        import("dictionary-pt/index.dic?raw"),
      ]);
      const nspell = (nspellMod as { default: (aff: string, dic: string) => NspellLike }).default;
      return nspell((affMod as { default: string }).default, (dicMod as { default: string }).default);
    })();
  }
  return spellPromise;
}

const WORD_RE = /[\p{L}]+(?:['’-][\p{L}]+)*/gu;

/** Retorna palavras possivelmente erradas, com até 3 sugestões cada. */
export async function findMisspellings(text: string): Promise<Misspelling[]> {
  if (!text || !text.trim()) return [];

  let spell: NspellLike;
  try {
    spell = await getSpell();
  } catch {
    // se o dicionário falhar ao carregar, simplesmente não sugerimos nada
    return [];
  }

  const out: Misspelling[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0];
    const start = match.index ?? 0;
    const end = start + word.length;

    if (word.length < 3) continue; // muito curto p/ valer a pena
    if (/\d/.test(word)) continue;
    if (word === word.toUpperCase() && word.length > 1) continue; // sigla (ex: PIX)
    if (ALLOWLIST.has(word.toLowerCase())) continue;
    if (spell.correct(word)) continue;

    // evita repetir a mesma palavra várias vezes na barra
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const suggestions = spell.suggest(word).slice(0, 3);
    if (suggestions.length === 0) continue; // sem sugestão útil

    out.push({ word, start, end, suggestions });
  }

  return out;
}

/** Aplica a substituição preservando a capitalização da palavra original. */
export function applySuggestion(text: string, m: Misspelling, replacement: string): string {
  let repl = replacement;
  // se a original começa com maiúscula, mantém a sugestão capitalizada
  if (m.word[0] && m.word[0] === m.word[0].toUpperCase() && repl[0]) {
    repl = repl[0].toUpperCase() + repl.slice(1);
  }

  if (text.slice(m.start, m.end) === m.word) {
    return text.slice(0, m.start) + repl + text.slice(m.end);
  }
  // fallback: posição mudou desde a detecção → troca a 1ª ocorrência
  const idx = text.indexOf(m.word);
  if (idx === -1) return text;
  return text.slice(0, idx) + repl + text.slice(idx + m.word.length);
}
