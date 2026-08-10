// Link mágico da Área de Membros: abre /minha-area já autenticado para o telefone
// da cliente, sem precisar digitar telefone nem código.
//
// Segurança: o token puro só existe dentro do link enviado. No banco guardamos
// apenas o SHA-256 dele. Um telefone tem no máximo 1 token ativo (rotaciona).

const MEMBER_AREA_URL = "https://checkout.bananacalcados.com.br/minha-area";
const DEFAULT_TTL_DAYS = 30;

/** Telefone BR normalizado em dígitos com DDI 55. */
export function normalizeMagicPhone(raw: string | null | undefined): string | null {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") ? d : `55${d}`;
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Gera (rotacionando) o link autenticado da Área de Membros para um telefone.
 * Nunca lança: em caso de erro devolve o link público simples.
 */
export async function issueMagicLink(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  phone: string | null | undefined,
  ttlDays = DEFAULT_TTL_DAYS,
): Promise<string> {
  try {
    const normalized = normalizeMagicPhone(phone);
    if (!normalized) return MEMBER_AREA_URL;

    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    // Não revogamos tokens antigos: a cliente pode clicar num link de um disparo
    // anterior (WhatsApp guarda o histórico) e ele precisa continuar funcionando
    // até expirar.

    const { error } = await supabase.from("member_area_magic_links").insert({
      phone: normalized,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (error) {
      console.error("[member-magic-link] insert failed:", error);
      return MEMBER_AREA_URL;
    }

    return `${MEMBER_AREA_URL}?ml=${token}`;
  } catch (e) {
    console.error("[member-magic-link] issue error:", e);
    return MEMBER_AREA_URL;
  }
}

/** Valida o token do link e devolve o telefone dono dele (ou null). */
export async function redeemMagicLink(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  token: string | null | undefined,
): Promise<string | null> {
  const raw = String(token || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) return null;
  try {
    const tokenHash = await sha256Hex(raw.toLowerCase());
    const { data } = await supabase
      .from("member_area_magic_links")
      .select("id, phone, expires_at, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (!data || data.revoked_at) return null;
    if (new Date(data.expires_at) < new Date()) return null;

    await supabase
      .from("member_area_magic_links")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id);

    return data.phone as string;
  } catch (e) {
    console.error("[member-magic-link] redeem error:", e);
    return null;
  }
}
