// Regiões que exigem consentimento prévio para rastreamento publicitário (EEE, Reino Unido, Suíça).
const CONSENT_REGIONS = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO","GB","CH"]);
export const ORDINARY_NOTICE = "selfservice-meta-ordinary-v1";

export async function loadSelfserviceAdvertising(sb: any, id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await sb.from("selfservice_advertising_consents").select("id,advertising,region,notice_version,updated_at").eq("id", id).maybeSingle();
  if (error || !data || !data.advertising || data.notice_version !== "selfservice-meta-v1") return null;
  return data;
}

async function isRefused(sb: any, id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  const { data } = await sb.from("selfservice_advertising_consents").select("advertising").eq("id", id).maybeSingle();
  return !!data && data.advertising === false;
}

/**
 * full = aceite explícito (pode mandar dados pessoais com hash);
 * ordinary = sem aceite, fora de região de consentimento e sem recusa: só clique/IP/navegador/valor.
 */
export async function resolveSelfserviceAdvertising(sb: any, raw: any) {
  const consent = await loadSelfserviceAdvertising(sb, raw?.consent_id);
  if (consent) return { mode: "full" as const, consentId: consent.id, snapshot: consent };
  if (await isRefused(sb, raw?.consent_id)) return { mode: "refused" as const, consentId: raw.consent_id, snapshot: { advertising: false, ordinary: false } };
  const region = typeof raw?.ordinary_region === "string" && /^[A-Z]{2}$/.test(raw.ordinary_region) ? raw.ordinary_region : null;
  if (!region || region === "XX" || region === "T1" || CONSENT_REGIONS.has(region)) return null;
  return { mode: "ordinary" as const, consentId: null, snapshot: { advertising: false, ordinary: true, region, notice_version: ORDINARY_NOTICE, at: new Date().toISOString() } };
}

export function ordinaryAllowed(snapshot: any) {
  return !!snapshot && snapshot.ordinary === true && snapshot.notice_version === ORDINARY_NOTICE && typeof snapshot.region === "string" && !CONSENT_REGIONS.has(snapshot.region);
}

export function cleanSelfserviceSignals(raw: any, req: Request) {
  const fbc = typeof raw?.fbc === "string" && /^fb\.\d\.\d{13}\.[\w-]{1,500}$/.test(raw.fbc) ? raw.fbc : null;
  const fbp = typeof raw?.fbp === "string" && /^fb\.\d\.\d{13}\.\d+$/.test(raw.fbp) ? raw.fbp : null;
  // Never put personal form fields or query strings in event URLs.
  let url: string | null = null;
  try { const u = new URL(raw?.source_url || ""); if (["checkout.bananacalcados.com.br", "localhost", "live-cart-organizer.lovable.app"].includes(u.hostname)) url = u.origin + u.pathname; } catch { /* no URL */ }
  return { fbc, fbp, client_user_agent: String(req.headers.get("user-agent") || "").slice(0, 500), client_ip: (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "").trim(), event_source_url: url };
}
