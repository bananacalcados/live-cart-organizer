import { pickConfirmedGateway } from "../selfservice-cashback-rule.ts";

export const FISCAL_MIXED_COMPANIES_REASON = "pagamento em CNPJs diferentes – emitir manualmente";
export const FISCAL_UNIDENTIFIED_GATEWAY_REASON = "gateway não identificado – escolher CNPJ";

export interface FiscalCompanyChoice {
  enabled: boolean;
  companyId: string | null;
  rule: "legacy" | "gateway_mapped" | "default_gateway" | "store" | "manual" | "manual_split" | "mixed_companies" | "unidentified_gateway";
  gateways: string[];
  companyIds: string[];
  mixed: boolean;
  pendingReason?: string | null;
  evidence?: string;
}

export function normalizeFiscalGateway(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["pagar", "pagarme", "pagar.me"].includes(normalized)) return "pagarme";
  if (["mercadopago", "mp"].includes(normalized)) return "mercadopago";
  return normalized;
}

function concreteGateway(value: unknown): string | null {
  const gateway = normalizeFiscalGateway(value);
  if (!gateway || [
    "storecheckout", "shopify", "online", "manual", "pixmanual", "pos", "cash",
    "dinheiro", "vps", "valepresente", "crediario", "delivery", "gatewaywebhook", "paymentwebhook", "webhook", "null", "undefined",
  ].includes(gateway)) return null;
  return gateway;
}

export function chooseFiscalCompany(input: {
  enabled: boolean;
  defaultCompanyId: string | null;
  storeCompanyId?: string | null;
  forcedCompanyId?: string | null;
  gateways: string[];
  mappings: Record<string, string>;
  evidence?: string;
}): FiscalCompanyChoice {
  const gateways = [...new Set(input.gateways.map(concreteGateway).filter(Boolean) as string[])];
  if (!input.enabled) {
    return { enabled: false, companyId: null, rule: "legacy", gateways, companyIds: [], mixed: false, evidence: input.evidence };
  }
  if (!gateways.length) {
    const companyId = input.forcedCompanyId || input.storeCompanyId || null;
    return {
      enabled: true, companyId, rule: input.forcedCompanyId ? "manual" : "store",
      gateways, companyIds: companyId ? [companyId] : [], mixed: false, evidence: input.evidence,
    };
  }

  let usedDefault = false;
  const companyIds = [...new Set(gateways.map((gateway) => {
    if (input.mappings[gateway]) return input.mappings[gateway];
    usedDefault = true;
    return input.defaultCompanyId;
  }).filter(Boolean) as string[])];

  if (companyIds.length > 1) {
    if (input.forcedCompanyId) {
      return {
        enabled: true, companyId: input.forcedCompanyId, rule: "manual_split", gateways,
        companyIds, mixed: false, pendingReason: null, evidence: input.evidence,
      };
    }
    const unidentified = input.evidence === "gateway_ids_ambiguous";
    return {
      enabled: true, companyId: null,
      rule: unidentified ? "unidentified_gateway" : "mixed_companies", gateways,
      companyIds, mixed: !unidentified,
      pendingReason: unidentified ? FISCAL_UNIDENTIFIED_GATEWAY_REASON : FISCAL_MIXED_COMPANIES_REASON,
      evidence: input.evidence,
    };
  }

  return {
    enabled: true, companyId: companyIds[0] || input.defaultCompanyId,
    rule: usedDefault ? "default_gateway" : "gateway_mapped", gateways,
    companyIds, mixed: false, evidence: input.evidence,
  };
}

function gatewaysFromIds(...rows: any[]): string[] {
  const gateways: string[] = [];
  for (const row of rows) {
    if (!row) continue;
    const candidates: Array<[unknown, string]> = [
      [row.pagarme_order_id, "pagarme"],
      [row.austpay_transaction_id, "austpay"],
      [row.appmax_order_id, "appmax"],
      [row.mercadopago_payment_id, "mercadopago"],
      [row.vindi_transaction_id, "vindi"],
    ];
    for (const [id, gateway] of candidates) {
      if (id && !gateways.includes(gateway)) gateways.push(gateway);
    }
  }
  return gateways;
}

export function selectFiscalGatewayEvidence(input: {
  order?: any;
  sale?: any;
  attempts?: { gateway?: string | null; status?: string | null; created_at?: string | null }[];
}): { gateways: string[]; evidence: string } {
  const { order, sale, attempts = [] } = input;
  const orderSnapshotGateway = concreteGateway(order?.gateway_snapshot?.gateway);
  let confirmedGateway: string | null = null;
  let confirmedEvidence = "";
  if (order && !orderSnapshotGateway) {
    const approved = pickConfirmedGateway({
      notes: order.notes,
      mercadopago_payment_id: null,
      pagarme_order_id: null,
      austpay_transaction_id: null,
      appmax_order_id: null,
      vindi_transaction_id: null,
    }, attempts);
    confirmedGateway = concreteGateway(approved);
    if (confirmedGateway) {
      confirmedEvidence = attempts.some((a) => a.status === "success" && concreteGateway(a.gateway) === confirmedGateway)
        ? "approved_attempt" : "order_note";
    }
  }
  const saleGateway = concreteGateway(sale?.gateway_snapshot?.gateway) || concreteGateway(sale?.payment_gateway);
  const orderGateway = concreteGateway(order?.payment_confirmed_source);
  const idGateways = gatewaysFromIds(order, sale);
  const selected = orderSnapshotGateway || confirmedGateway || saleGateway || orderGateway || idGateways[0] || null;
  if (!selected) return { gateways: [], evidence: "none" };
  return {
    gateways: orderSnapshotGateway || confirmedGateway || saleGateway || orderGateway ? [selected] : idGateways,
    evidence: orderSnapshotGateway ? "order_gateway_snapshot"
      : confirmedGateway ? confirmedEvidence
      : saleGateway ? "pos_sale_confirmation"
      : orderGateway ? "order_confirmation"
      : idGateways.length > 1 ? "gateway_ids_ambiguous" : "unique_gateway_id",
  };
}

export async function resolveFiscalCompanyForSource(
  db: any,
  input: { saleId?: string | null; orderId?: string | null; storeCompanyId?: string | null; forcedCompanyId?: string | null },
): Promise<FiscalCompanyChoice> {
  const { data: config } = await db.from("fiscal_gateway_company_config")
    .select("emit_by_gateway, default_company_id").eq("id", true).maybeSingle();
  const enabled = !!config?.emit_by_gateway;

  const [saleRes, mapRes] = await Promise.all([
    input.saleId ? db.from("pos_sales").select("id, source_order_id, payment_gateway, gateway_snapshot, pagarme_order_id, austpay_transaction_id, appmax_order_id, mercadopago_payment_id, vindi_transaction_id").eq("id", input.saleId).maybeSingle() : Promise.resolve({ data: null }),
    db.from("fiscal_gateway_company_map").select("gateway, company_id").eq("is_active", true),
  ]);
  const sale = saleRes.data;
  const linkedOrderId = sale?.source_order_id || input.orderId || null;
  let { data: order } = linkedOrderId
    ? await db.from("orders").select("id, notes, payment_confirmed_source, gateway_snapshot, pagarme_order_id, austpay_transaction_id, appmax_order_id, mercadopago_payment_id, vindi_transaction_id").eq("id", linkedOrderId).maybeSingle()
    : { data: null };
  if (!order && input.saleId && !linkedOrderId) {
    const fallback = await db.from("orders").select("id, notes, payment_confirmed_source, gateway_snapshot, pagarme_order_id, austpay_transaction_id, appmax_order_id, mercadopago_payment_id, vindi_transaction_id")
      .eq("pos_sale_id", input.saleId).order("paid_at", { ascending: false }).limit(1).maybeSingle();
    order = fallback.data;
  }

  const splitFilters = [input.saleId ? `sale_id.eq.${input.saleId}` : null, order?.id ? `order_id.eq.${order.id}` : null].filter(Boolean);
  const { data: splits } = splitFilters.length
    ? await db.from("payment_splits").select("gateway, status").in("status", ["approved", "paid"]).or(splitFilters.join(","))
    : { data: [] };

  let gateways: string[] = [];
  let evidence = "none";
  const splitGateways = [...new Set((splits || []).map((s: any) => concreteGateway(s.gateway)).filter(Boolean) as string[])];
  if (splitGateways.length) {
    gateways = splitGateways;
    evidence = "payment_splits";
  } else {
    // A prioridade é a prova de aprovação, nunca a simples presença de IDs:
    // snapshot do pedido → mesmo critério do cashback → confirmação da venda → IDs.
    const orderSnapshotGateway = concreteGateway(order?.gateway_snapshot?.gateway);
    let confirmedGateway: string | null = null;
    let confirmedEvidence = "";
    if (order && !orderSnapshotGateway) {
      const { data: attempts } = await db.from("pos_checkout_attempts")
        .select("gateway,status,created_at").eq("sale_id", order.id)
        .order("created_at", { ascending: false }).limit(20);
      const approved = pickConfirmedGateway({
        notes: order.notes,
        mercadopago_payment_id: null,
        pagarme_order_id: null,
        austpay_transaction_id: null,
        appmax_order_id: null,
        vindi_transaction_id: null,
      }, attempts || []);
      confirmedGateway = concreteGateway(approved);
      if (confirmedGateway) {
        confirmedEvidence = (attempts || []).some((a: any) => a.status === "success" && concreteGateway(a.gateway) === confirmedGateway)
          ? "approved_attempt" : "order_note";
      }
    }
    const saleGateway = concreteGateway(sale?.gateway_snapshot?.gateway) || concreteGateway(sale?.payment_gateway);
    const orderGateway = concreteGateway(order?.payment_confirmed_source);
    const idGateways = gatewaysFromIds(order, sale);
    const selected = orderSnapshotGateway || confirmedGateway || saleGateway || orderGateway || idGateways[0] || null;
    if (selected) {
      gateways = orderSnapshotGateway || confirmedGateway || saleGateway || orderGateway ? [selected] : idGateways;
      evidence = orderSnapshotGateway ? "order_gateway_snapshot"
        : confirmedGateway ? confirmedEvidence
        : saleGateway ? "pos_sale_confirmation"
        : orderGateway ? "order_confirmation"
        : idGateways.length > 1 ? "gateway_ids_ambiguous" : "unique_gateway_id";
    }
  }

  const mappings = Object.fromEntries(((mapRes.data || []) as any[]).map((row) => [normalizeFiscalGateway(row.gateway), row.company_id]));
  return chooseFiscalCompany({
    enabled,
    defaultCompanyId: config?.default_company_id || null,
    storeCompanyId: input.storeCompanyId,
    forcedCompanyId: input.forcedCompanyId,
    gateways,
    mappings,
    evidence,
  });
}

export async function recordFiscalCompanyPending(
  db: any,
  input: { sourceType: "pos_sale" | "order"; sourceId: string; choice: FiscalCompanyChoice },
) {
  if (!input.choice.pendingReason) return;
  await db.from("fiscal_emission_pendings").upsert({
    source_type: input.sourceType,
    source_id: input.sourceId,
    reason: input.choice.pendingReason,
    gateways: input.choice.gateways,
    company_ids: input.choice.companyIds,
    status: "open",
    resolved_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "source_type,source_id" });
}

export async function resolveFiscalPending(
  db: any,
  sourceType: "pos_sale" | "order",
  sourceId: string,
) {
  await db.from("fiscal_emission_pendings").update({
    status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("source_type", sourceType).eq("source_id", sourceId).eq("status", "open");
}
