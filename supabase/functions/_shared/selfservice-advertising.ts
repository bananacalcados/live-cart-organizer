export async function loadSelfserviceAdvertising(sb: any, id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await sb.from("selfservice_advertising_consents").select("id,advertising,region,notice_version,updated_at").eq("id", id).maybeSingle();
  if (error || !data || !data.advertising || data.notice_version !== "selfservice-meta-v1") return null;
  return data;
}
export function cleanSelfserviceSignals(raw: any, req: Request) {
  const fbc = typeof raw?.fbc === "string" && /^fb\.\d\.\d{13}\.[\w-]{1,500}$/.test(raw.fbc) ? raw.fbc : null;
  const fbp = typeof raw?.fbp === "string" && /^fb\.\d\.\d{13}\.\d+$/.test(raw.fbp) ? raw.fbp : null;
  // Never put personal form fields or query strings in event URLs.
  let url: string | null = null;
  try { const u = new URL(raw?.source_url || ""); if (["checkout.bananacalcados.com.br", "localhost", "live-cart-organizer.lovable.app"].includes(u.hostname)) url = u.origin + u.pathname; } catch { /* no URL */ }
  return { fbc, fbp, client_user_agent: String(req.headers.get("user-agent") || "").slice(0, 500), client_ip: (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "").trim(), event_source_url: url };
}