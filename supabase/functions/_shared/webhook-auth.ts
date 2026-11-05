// Autenticação de webhooks de mensageria (Meta / Z-API / uazapi / WaSender).
// Modo observação: grava válida/inválida/ausente por provedor em
// webhook_signature_state (RPC record_webhook_auth). A rejeição só liga
// sozinha após ≥1h de observação e 20 eventos válidos seguidos. Sem secret
// configurado, nunca rejeita (só conta).
export type AuthResult = "valid" | "invalid" | "missing" | "no_secret";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function verifyMetaSignature(raw: string, header: string | null, secret: string | undefined): Promise<AuthResult> {
  if (!secret) return "no_secret";
  if (!header || !header.startsWith("sha256=")) return "missing";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(hex, header.slice(7).toLowerCase()) ? "valid" : "invalid";
}

/** Segredo na URL (?token=) ou no header x-webhook-token. */
export function checkUrlToken(req: Request, envName: string): AuthResult {
  const secret = Deno.env.get(envName);
  if (!secret) return "no_secret";
  const url = new URL(req.url);
  const got = url.searchParams.get("token") || req.headers.get("x-webhook-token") || "";
  if (!got) return "missing";
  return safeEqual(got, secret) ? "valid" : "invalid";
}

const enforcedCache = new Map<string, { v: boolean; at: number }>();

/** Registra o resultado e devolve true se a requisição deve seguir. */
export async function gateWebhook(supabase: any, provider: string, result: AuthResult): Promise<boolean> {
  try {
    const c = enforcedCache.get(provider);
    // Já em rejeição e válido: não precisa travar a linha a cada mensagem.
    if (c?.v && result === "valid" && Date.now() - c.at < 300_000) return true;
    const { data, error } = await supabase.rpc("record_webhook_auth", { p_provider: provider, p_result: result });
    if (error) return true; // falha de registro nunca derruba mensagem
    const enforced = data === true;
    enforcedCache.set(provider, { v: enforced, at: Date.now() });
    if (result === "valid" || result === "no_secret") return true;
    return !enforced;
  } catch {
    return true;
  }
}
