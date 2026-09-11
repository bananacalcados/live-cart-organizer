/**
 * Engine de ortografia offline (sem IA) baseado em nspell + dicionário Hunspell pt-BR.
 *
 * - O nspell roda num WEB WORKER (`spell.worker.ts`): o parse do dicionário
 *   (~5 MB) leva vários segundos de CPU e, na thread principal, congelava a tela
 *   do chat (abrir conversa / 1ª tecla). Aqui a thread principal só troca
 *   mensagens com o worker.
 * - O worker é criado LAZY (1x por sessão) — no aquecimento ocioso ou na 1ª
 *   verificação — e o dicionário é baixado dentro dele.
 * - Allowlist de gírias/marcas para reduzir falsos positivos do dicionário.
 */

export interface Misspelling {
  word: string;
  start: number;
  end: number;
  suggestions: string[];
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

// ── Worker ──────────────────────────────────────────────────────────────────
type WorkerOut =
  | { type: "ready"; ok: boolean }
  | { type: "result"; id: number; results: Record<string, string[] | null> };

let worker: Worker | null = null;
let workerFailed = false;
let reqSeq = 0;
const pending = new Map<number, (r: Record<string, string[] | null>) => void>();

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    workerFailed = true;
    return null;
  }
  try {
    const w = new Worker(new URL("./spell.worker.ts", import.meta.url), { type: "module" });
    const base = import.meta.env.BASE_URL || "/";
    const abs = (p: string) => new URL(`${base}dict/pt/${p}`, window.location.origin).toString();
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === "result") {
        const cb = pending.get(msg.id);
        if (cb) { pending.delete(msg.id); cb(msg.results); }
      } else if (msg.type === "ready" && !msg.ok) {
        workerFailed = true;
      }
    };
    w.onerror = () => {
      workerFailed = true;
      // libera quem estiver esperando (sem sugestões)
      for (const [id, cb] of pending) { pending.delete(id); cb({}); }
      try { w.terminate(); } catch { /* ignore */ }
      worker = null;
    };
    w.postMessage({ type: "init", affUrl: abs("index.aff"), dicUrl: abs("index.dic") });
    worker = w;
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

function checkWords(words: string[]): Promise<Record<string, string[] | null>> {
  const w = getWorker();
  if (!w || words.length === 0) return Promise.resolve({});
  const id = ++reqSeq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ type: "check", id, words });
  });
}

/**
 * Prepara o corretor em tempo OCIOSO do navegador: cria o worker e ele mesmo
 * baixa/parseia o dicionário, sem tocar na thread principal.
 * Idempotente — a 2ª chamada em diante não faz nada. Devolve função de cancelamento.
 */
export function warmupSpell(): () => void {
  if (worker || workerFailed || typeof window === "undefined") return () => {};
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(() => { getWorker(); }, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(() => { getWorker(); }, 1500);
  return () => window.clearTimeout(id);
}

const WORD_RE = /[\p{L}]+(?:['’-][\p{L}]+)*/gu;

// Cache por palavra (case-sensitive, pois "Ana" ≠ "ana" para o dicionário):
// `null` = correta; array = sugestões. `spell.suggest` (distância de edição) é a
// parte cara — cacheá-la evita refazer o cálculo a cada tecla para a mesma palavra.
const CACHE_LIMIT = 4000;
const wordCache = new Map<string, string[] | null>();
function remember(word: string, value: string[] | null) {
  if (wordCache.size >= CACHE_LIMIT) {
    // descarta a entrada mais antiga (Map preserva ordem de inserção)
    const first = wordCache.keys().next().value;
    if (first !== undefined) wordCache.delete(first);
  }
  wordCache.set(word, value);
}

export interface FindMisspellingsOptions {
  /**
   * Ignora a última palavra quando o texto NÃO termina em espaço/pontuação —
   * ou seja, a palavra que ainda está sendo digitada. Evita marcar "obrig" como
   * erro enquanto a pessoa termina de escrever "obrigada".
   */
  skipTrailingWord?: boolean;
}

/** Retorna palavras possivelmente erradas, com até 3 sugestões cada. */
export async function findMisspellings(
  text: string,
  options: FindMisspellingsOptions = {},
): Promise<Misspelling[]> {
  if (!text || !text.trim()) return [];

  const trailingIncomplete = options.skipTrailingWord === true && /[\p{L}]$/u.test(text);

  // 1) Extrai as palavras candidatas (barato, na thread principal).
  const candidates: { word: string; start: number; end: number }[] = [];
  const seenKeys = new Set<string>();
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0];
    const start = match.index ?? 0;
    const end = start + word.length;

    if (trailingIncomplete && end === text.length) continue; // ainda digitando
    if (word.length < 3) continue; // muito curto p/ valer a pena
    if (/\d/.test(word)) continue;
    // Formas com hífen ("comprá-lo", "envie-me") ficam fora: as regras de clíticos
    // foram removidas do dicionário (eram 70% do tamanho) e são raras no chat.
    if (word.includes("-")) continue;
    if (word === word.toUpperCase() && word.length > 1) continue; // sigla (ex: PIX)
    if (ALLOWLIST.has(word.toLowerCase())) continue;

    // evita repetir a mesma palavra várias vezes na barra
    const key = word.toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    candidates.push({ word, start, end });
  }
  if (candidates.length === 0) return [];

  // 2) Só o que não está em cache vai ao worker (o custo real fica lá).
  const unknown = candidates.filter((c) => !wordCache.has(c.word)).map((c) => c.word);
  if (unknown.length > 0) {
    const results = await checkWords(unknown);
    for (const word of unknown) {
      // Sem resposta (worker indisponível) => não marca como erro, nem cacheia.
      if (!(word in results)) continue;
      remember(word, results[word]);
    }
  }

  // 3) Monta a saída na ordem do texto.
  const out: Misspelling[] = [];
  for (const c of candidates) {
    const suggestions = wordCache.get(c.word);
    if (!suggestions) continue;
    out.push({ word: c.word, start: c.start, end: c.end, suggestions });
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
