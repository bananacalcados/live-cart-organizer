// Helper compartilhado para resolver qual conta Mercado Pago usar.
// Suporta múltiplas contas (CNPJs diferentes) com troca dinâmica via tabela mercadopago_accounts.
// Sempre cai pra MERCADOPAGO_ACCESS_TOKEN do env como último fallback (compatibilidade legado).

interface MpAccount {
  account_id: string | null;
  access_token: string;
  is_sandbox: boolean;
  account_name: string;
  source: "order" | "sale" | "active" | "env_fallback";
}

const ENV_FALLBACK_NAME = "Conta Legado (env)";

function envFallback(): MpAccount | null {
  const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (!token) return null;
  return {
    account_id: null,
    access_token: token,
    is_sandbox: token.startsWith("TEST-"),
    account_name: ENV_FALLBACK_NAME,
    source: "env_fallback",
  };
}

/** Conta MP atualmente ativa (pra gerar pagamentos novos). */
export async function getActiveMpAccount(supabase: any): Promise<MpAccount | null> {
  try {
    const { data, error } = await supabase.rpc("get_active_mp_account");
    if (error) {
      console.warn("[mp-account] get_active_mp_account error:", error.message);
      return envFallback();
    }
    if (data && data.length > 0) {
      const row = data[0];
      return {
        account_id: row.id,
        access_token: row.access_token,
        is_sandbox: row.is_sandbox || false,
        account_name: row.name,
        source: "active",
      };
    }
    return envFallback();
  } catch (err: any) {
    console.warn("[mp-account] getActiveMpAccount fallback:", err.message);
    return envFallback();
  }
}

/** Conta MP que processou um pedido específico (orders.mp_account_id) ou conta ativa. */
export async function getMpAccountForOrder(
  supabase: any,
  orderId: string
): Promise<MpAccount | null> {
  try {
    const { data, error } = await supabase.rpc("get_mp_token_for_order", { p_order_id: orderId });
    if (error || !data || data.length === 0) {
      console.warn("[mp-account] getMpAccountForOrder fallback to env:", error?.message);
      return envFallback();
    }
    const row = data[0];
    if (!row.access_token) return envFallback();
    return {
      account_id: row.account_id,
      access_token: row.access_token,
      is_sandbox: row.is_sandbox || false,
      account_name: row.account_name || "Desconhecida",
      source: "order",
    };
  } catch (err: any) {
    console.warn("[mp-account] getMpAccountForOrder error:", err.message);
    return envFallback();
  }
}

/** Conta MP que processou uma venda PDV específica. */
export async function getMpAccountForSale(
  supabase: any,
  saleId: string
): Promise<MpAccount | null> {
  try {
    const { data, error } = await supabase.rpc("get_mp_token_for_sale", { p_sale_id: saleId });
    if (error || !data || data.length === 0) {
      console.warn("[mp-account] getMpAccountForSale fallback to env:", error?.message);
      return envFallback();
    }
    const row = data[0];
    if (!row.access_token) return envFallback();
    return {
      account_id: row.account_id,
      access_token: row.access_token,
      is_sandbox: row.is_sandbox || false,
      account_name: row.account_name || "Desconhecida",
      source: "sale",
    };
  } catch (err: any) {
    console.warn("[mp-account] getMpAccountForSale error:", err.message);
    return envFallback();
  }
}

/** Pra webhooks: descobre a conta a partir do payment_id. */
export async function getMpAccountByPaymentId(
  supabase: any,
  paymentId: string
): Promise<MpAccount | null> {
  try {
    const { data, error } = await supabase.rpc("get_mp_token_by_payment_id", {
      p_payment_id: paymentId,
    });
    if (error || !data || data.length === 0) {
      console.warn("[mp-account] getMpAccountByPaymentId fallback to env:", error?.message);
      return envFallback();
    }
    const row = data[0];
    if (!row.access_token) return envFallback();
    return {
      account_id: row.account_id,
      access_token: row.access_token,
      is_sandbox: row.is_sandbox || false,
      account_name: row.account_name || "Desconhecida",
      source: row.source_type === "active_fallback" ? "active" : (row.source_type as any),
    };
  } catch (err: any) {
    console.warn("[mp-account] getMpAccountByPaymentId error:", err.message);
    return envFallback();
  }
}

/** Lista todas as contas (pra polling iterar). */
export async function listAllMpAccountsForPolling(
  supabase: any
): Promise<Array<{ account_id: string | null; access_token: string; account_name: string }>> {
  const out: Array<{ account_id: string | null; access_token: string; account_name: string }> = [];
  try {
    // Direct query (service role) — não passa pela RPC pra trazer todas, não só a ativa.
    const { data } = await supabase
      .from("mercadopago_accounts")
      .select("id, name, access_token");
    if (data) {
      for (const r of data) {
        if (r.access_token) {
          out.push({ account_id: r.id, access_token: r.access_token, account_name: r.name });
        }
      }
    }
  } catch (err: any) {
    console.warn("[mp-account] listAllMpAccountsForPolling error:", err.message);
  }
  // Sempre inclui o env como último (compatibilidade pedidos legado)
  const fb = envFallback();
  if (fb && !out.some((a) => a.access_token === fb.access_token)) {
    out.push({ account_id: null, access_token: fb.access_token, account_name: ENV_FALLBACK_NAME });
  }
  return out;
}
