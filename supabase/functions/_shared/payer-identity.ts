// Identidade do pagador para gateways (antifraude).
//
// Problema real: pedidos da live em que a cliente NUNCA abriu a área de membros
// (a equipe preencheu nome/CPF direto no card do pedido) chegavam ao gateway com
// o @ do Instagram no campo de nome — o sistema já tinha o nome real salvo.
//
// Este helper busca o nome/CPF/e-mail reais já cadastrados (customer_registrations
// do pedido → registro pelo telefone → customers_unified) e sobrescreve o que
// vier "sujo" do cliente. Nunca lança erro: no pior caso devolve o que recebeu.

const DIGITS = (v?: string | null) => String(v ?? "").replace(/\D/g, "");

/** Nome real = 2+ palavras, sem @, sem dígitos, sem cara de handle. */
export function isRealFullName(raw?: string | null): boolean {
  const v = String(raw ?? "").trim();
  if (!v || v.includes("@") || /\d/.test(v)) return false;
  if (/[._]/.test(v)) return false;
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((p) => /^[a-zA-ZÀ-ÿ'’-]{2,}$/.test(p));
}

export type PayerIdentity = {
  name?: string | null;
  cpf?: string | null;
  email?: string | null;
};

/**
 * Completa a identidade do pagador com os dados já cadastrados no sistema.
 * Retorna `{ name, cpf, email, enrichedFrom }`.
 */
export async function enrichPayerIdentity(
  supabase: any,
  opts: { orderId?: string | null; phone?: string | null; current: PayerIdentity }
): Promise<PayerIdentity & { enrichedFrom: string | null }> {
  const out: PayerIdentity & { enrichedFrom: string | null } = {
    name: opts.current.name ?? null,
    cpf: DIGITS(opts.current.cpf) || null,
    email: opts.current.email ?? null,
    enrichedFrom: null,
  };

  const needsName = !isRealFullName(out.name);
  const needsCpf = (out.cpf || "").length !== 11;
  const needsEmail = !out.email;
  if (!needsName && !needsCpf && !needsEmail) return out;

  const apply = (src: string, row: any) => {
    if (!row) return;
    if (!isRealFullName(out.name) && isRealFullName(row.full_name || row.name)) {
      out.name = String(row.full_name || row.name).trim();
      out.enrichedFrom = src;
    }
    if ((out.cpf || "").length !== 11 && DIGITS(row.cpf).length === 11) out.cpf = DIGITS(row.cpf);
    if (!out.email && row.email) out.email = String(row.email).trim();
  };

  try {
    if (opts.orderId) {
      const { data } = await supabase
        .from("customer_registrations")
        .select("full_name, cpf, email")
        .eq("order_id", opts.orderId)
        .maybeSingle();
      apply("registration_order", data);
    }

    const suf = DIGITS(opts.phone).slice(-8);
    if (suf.length === 8 && (!isRealFullName(out.name) || (out.cpf || "").length !== 11 || !out.email)) {
      const { data: regs } = await supabase
        .from("customer_registrations")
        .select("full_name, cpf, email, created_at")
        .ilike("whatsapp", `%${suf}`)
        .order("created_at", { ascending: false })
        .limit(5);
      for (const r of regs || []) apply("registration_phone", r);

      if (!isRealFullName(out.name) || (out.cpf || "").length !== 11 || !out.email) {
        const { data: unified } = await supabase
          .from("customers_unified")
          .select("name, cpf, email")
          .ilike("phone_e164", `%${suf}`)
          .limit(3);
        for (const u of unified || []) apply("customers_unified", u);
      }
    }
  } catch (e) {
    console.error("[payer-identity] falha ao enriquecer identidade:", e);
  }

  if (out.enrichedFrom) {
    console.log(`[payer-identity] nome do pagador corrigido a partir de ${out.enrichedFrom}`);
  }
  return out;
}
