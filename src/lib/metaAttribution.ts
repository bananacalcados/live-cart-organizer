/**
 * Memória de atribuição da Meta no navegador (Etapa E).
 *
 * Captura os sinais de clique de anúncio (`fbclid`, `_fbc`, `_fbp`, `ctwa_clid`)
 * e as UTMs logo na PORTA DE ENTRADA (páginas de redirect, links de bio, LPs)
 * e guarda por 90 dias — a janela de clique da Meta.
 *
 * Assim, quando a cliente converte dias depois (checkout, /minha-area), ainda
 * conseguimos enviar o `fbc` no evento de conversão mesmo que o parâmetro
 * original já tenha se perdido nos redirects (Instagram/WhatsApp/Typebot).
 */

const STORAGE_KEY = "bc_meta_attr_v1";
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias

export interface StoredAttribution {
  fbc?: string | null;
  fbp?: string | null;
  fbclid?: string | null;
  ctwa_clid?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  first_url?: string | null;
  ts?: number;
}

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

function readCookieRaw(name: string): string | null {
  try {
    const m = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"),
    );
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/** Formato oficial do cookie `_fbc`: `fb.1.<unix_ms>.<clid>`. */
export function buildFbc(clid: string | null | undefined, clickTimeMs?: number): string | null {
  const id = String(clid ?? "").trim();
  if (!id) return null;
  if (id.startsWith("fb.")) return id;
  const ts = clickTimeMs && clickTimeMs > 0 ? Math.floor(clickTimeMs) : Date.now();
  return `fb.1.${ts}.${id}`;
}

/** Lê os sinais guardados (null se ausentes ou expirados). */
export function getStoredAttribution(): StoredAttribution | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAttribution;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.ts && Date.now() - parsed.ts > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persist(next: StoredAttribution) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* modo privado / storage cheio — ignora */
  }
}

/**
 * Captura os sinais presentes na URL atual + cookies e os funde com o que já
 * estava guardado. Um clique novo (fbclid novo) sobrescreve o anterior;
 * valores ausentes NUNCA apagam os antigos.
 *
 * Chamar no topo de qualquer página de entrada (redirects, LPs, links de bio).
 */
export function captureAttribution(extra?: Partial<StoredAttribution>): StoredAttribution {
  const prev = getStoredAttribution() ?? {};
  const next: StoredAttribution = { ...prev };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    params = new URLSearchParams();
  }

  const fbclid = params.get("fbclid") || extra?.fbclid || null;
  const ctwa = params.get("ctwa_clid") || extra?.ctwa_clid || null;

  // Clique novo redefine a atribuição de clique (last-click da Meta).
  if (fbclid) {
    next.fbclid = fbclid;
    next.fbc = buildFbc(fbclid);
  }
  if (ctwa) {
    next.ctwa_clid = ctwa;
    if (!next.fbc) next.fbc = buildFbc(ctwa);
  }

  // Cookies do pixel têm prioridade sobre o valor sintetizado.
  const cookieFbc = readCookieRaw("_fbc");
  if (cookieFbc) next.fbc = cookieFbc;
  const cookieFbp = readCookieRaw("_fbp");
  if (cookieFbp) next.fbp = cookieFbp;
  if (extra?.fbp && !next.fbp) next.fbp = extra.fbp;
  if (extra?.fbc && !next.fbc) next.fbc = extra.fbc;

  for (const k of UTM_KEYS) {
    const v = params.get(k) || (extra?.[k] as string | undefined) || null;
    if (v) next[k] = v;
  }

  if (fbclid || ctwa || !next.first_url) {
    try {
      next.first_url = window.location.href.slice(0, 500);
    } catch {
      /* ignore */
    }
  }

  next.ts = Date.now();
  persist(next);
  return next;
}

/** `_fbc` efetivo: cookie → fbclid da URL → memória de 90 dias. */
export function resolveFbc(): string | null {
  const cookie = readCookieRaw("_fbc");
  if (cookie) return cookie;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("fbclid");
    if (fromUrl) return buildFbc(fromUrl);
  } catch {
    /* ignore */
  }
  return getStoredAttribution()?.fbc ?? null;
}

/** `_fbp` efetivo: cookie → memória de 90 dias. */
export function resolveFbp(): string | null {
  return readCookieRaw("_fbp") ?? getStoredAttribution()?.fbp ?? null;
}

/** `fbclid` efetivo: URL → memória de 90 dias. */
export function resolveFbclid(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("fbclid");
    if (fromUrl) return fromUrl;
  } catch {
    /* ignore */
  }
  return getStoredAttribution()?.fbclid ?? null;
}

/** UTM efetiva: URL → memória de 90 dias. */
export function resolveUtm(key: (typeof UTM_KEYS)[number]): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(key);
    if (fromUrl) return fromUrl;
  } catch {
    /* ignore */
  }
  return (getStoredAttribution()?.[key] as string | undefined) ?? null;
}

/** Todas as UTMs efetivas, sem chaves vazias. */
export function resolveUtms(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = resolveUtm(k);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * Anexa UTMs + `fbclid` a uma URL de destino (sem sobrescrever o que já existe).
 * Só mexe em URLs http(s) — deep-links (`intent://`, `instagram://`) passam intactos.
 */
export function appendAttributionParams(url: string): string {
  if (!url || !/^https?:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(resolveUtms())) {
      if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    const fbclid = resolveFbclid();
    if (fbclid && !u.searchParams.has("fbclid")) u.searchParams.set("fbclid", fbclid);
    return u.toString();
  } catch {
    return url;
  }
}

/** Payload pronto para mandar ao backend (memória de atribuição por telefone). */
export function attributionPayload(): Record<string, string | null> {
  return {
    fbc: resolveFbc(),
    fbp: resolveFbp(),
    fbclid: resolveFbclid(),
    ctwa_clid: getStoredAttribution()?.ctwa_clid ?? null,
    utm_source: resolveUtm("utm_source"),
    utm_medium: resolveUtm("utm_medium"),
    utm_campaign: resolveUtm("utm_campaign"),
    source_url: (() => {
      try {
        return window.location.href.slice(0, 500);
      } catch {
        return null;
      }
    })(),
  };
}
