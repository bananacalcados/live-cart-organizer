// Bloqueio de venda para clientes com chargeback (Etapa 4).
// Validação SEMPRE no servidor: qualquer função que cria cobrança/pedido chama
// assertNoChargebackBlock() antes de falar com o gateway.

export interface ChargebackGateInput {
  phone?: string | null;
  cpf?: string | null;
  orderId?: string | null;
  posSaleId?: string | null;
  customerUnifiedId?: string | null;
}

export interface ChargebackGateResult {
  blocked: boolean;
  customer_name?: string | null;
  reason?: string | null;
  status?: string | null;
  amount?: number | null;
  order_name?: string | null;
  chargeback_date?: string | null;
  chargeback_id?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : null);

export async function checkChargebackGate(
  supabase: any,
  input: ChargebackGateInput,
): Promise<ChargebackGateResult> {
  try {
    const { data, error } = await supabase.rpc("chargeback_gate", {
      p_phone: input.phone ?? null,
      p_cpf: input.cpf ?? null,
      p_order_id: uuidOrNull(input.orderId),
      p_pos_sale_id: uuidOrNull(input.posSaleId),
      p_customer_unified_id: uuidOrNull(input.customerUnifiedId),
    });
    if (error) {
      // Falha na checagem nunca derruba a venda — apenas registra.
      console.error("[chargeback-guard] rpc error", error.message);
      return { blocked: false };
    }
    return (data as ChargebackGateResult) || { blocked: false };
  } catch (e) {
    console.error("[chargeback-guard] exception", e);
    return { blocked: false };
  }
}

/** Só gestores (admin/manager) autenticados podem liberar uma venda bloqueada. */
export async function canOverrideChargeback(req: Request): Promise<boolean> {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return false;

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: userData } = await admin.auth.getUser(token);
    const userId = userData?.user?.id;
    if (!userId) return false;

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    return (roles || []).some((r: any) => r.role === "admin" || r.role === "manager");
  } catch (e) {
    console.error("[chargeback-guard] override check failed", e);
    return false;
  }
}

/**
 * Retorna uma Response 403 pronta quando o cliente está bloqueado,
 * ou null quando a venda pode seguir.
 */
export async function assertNoChargebackBlock(
  req: Request,
  supabase: any,
  input: ChargebackGateInput,
  corsHeaders: Record<string, string>,
  overrideRequested = false,
): Promise<Response | null> {
  const gate = await checkChargebackGate(supabase, input);
  if (!gate.blocked) return null;

  if (overrideRequested && (await canOverrideChargeback(req))) {
    console.log("[chargeback-guard] venda liberada por gestor", gate.chargeback_id);
    return null;
  }

  const who = gate.customer_name ? ` (${gate.customer_name})` : "";
  return new Response(
    JSON.stringify({
      error: `Cliente bloqueado por chargeback${who}. Venda não autorizada.`,
      code: "CHARGEBACK_BLOCKED",
      chargeback: gate,
    }),
    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
