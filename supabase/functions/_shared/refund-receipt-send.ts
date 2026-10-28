// Fase 4 — envio do comprovante de estorno à cliente pelo WhatsApp.
// Nunca automático: só ação manual (prévia + Enviar). Reaproveita as funções de
// envio de mídia já existentes por provider; não cria provedor novo.

export const DEFAULT_RECEIPT_MESSAGE =
  "Olá, {nome}! Seu estorno de {valor} referente à compra de {data_compra} foi realizado. Segue o comprovante em anexo. {aviso_prazo}";
const AVISO_CARTAO = "O valor aparece na fatura do cartão conforme o prazo do seu banco, podendo ser na fatura atual ou na próxima.";
const AVISO_PIX = "O valor já foi devolvido para a conta que fez o pagamento. O código da devolução Pix (E2E) está no comprovante.";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function maskPhone(p: string | null) {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  return d.length < 6 ? d : `${d.slice(0, 4)}*****${d.slice(-4)}`;
}

export function renderReceiptMessage(tpl: string, vars: { nome: string; valor: number; dataCompra: string | null; codigo: string; isPix: boolean }) {
  const date = vars.dataCompra ? new Date(vars.dataCompra).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-";
  return (tpl || DEFAULT_RECEIPT_MESSAGE)
    .split("{nome}").join(vars.nome || "")
    .split("{valor}").join(brl(vars.valor))
    .split("{data_compra}").join(date)
    .split("{codigo}").join(vars.codigo || "")
    .split("{aviso_prazo}").join(vars.isPix ? AVISO_PIX : AVISO_CARTAO)
    .trim();
}

function normPhone(raw: string | null | undefined): string | null {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length === 12 && d.startsWith("55")) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  return d.length >= 12 && d.length <= 13 ? d : null;
}

export interface ReceiptSendPlan {
  ok: boolean;
  error?: string;
  blocked?: string;
  refund?: any;
  phone?: string | null;
  phoneMasked?: string;
  instance?: { id: string; provider: string; label: string } | null;
  message?: string;
  fileName?: string;
  customerName?: string | null;
}

export async function planReceiptSend(supabase: any, refundId: string, preferredNumberId?: string | null): Promise<ReceiptSendPlan> {
  const { data: row } = await supabase.from("gateway_refunds")
    .select("id, source, source_id, amount, status, card_brand, receipt_path, receipt_code, receipt_sent_at, receipt_sent_to, receipt_sent_channel")
    .eq("id", refundId).maybeSingle();
  if (!row) return { ok: false, error: "Estorno não encontrado." };
  if (!["concluido","concluido_manual"].includes(row.status)) return { ok: false, error: "Só é possível enviar comprovante de estorno concluído." };
  if (!row.receipt_path || !row.receipt_code) return { ok: false, error: "O comprovante ainda não foi gerado." };

  let rawPhone: string | null = null;
  let name: string | null = null;
  let createdAt: string | null = null;
  if (row.source === "order") {
    const { data } = await supabase.from("orders").select("created_at, customer:customers(full_name, whatsapp)").eq("id", row.source_id).maybeSingle();
    rawPhone = data?.customer?.whatsapp || null; name = data?.customer?.full_name || null; createdAt = data?.created_at || null;
  } else {
    const { data } = await supabase.from("pos_sales").select("created_at, customer_name, customer_phone").eq("id", row.source_id).maybeSingle();
    rawPhone = data?.customer_phone || null; name = data?.customer_name || null; createdAt = data?.created_at || null;
  }
  const phone = normPhone(rawPhone);

  const { data: cfg } = await supabase.rpc("refund_config");
  const message = renderReceiptMessage(String(cfg?.receipt_message_template || ""), {
    nome: (name || "").trim().split(/\s+/)[0] || "", valor: Number(row.amount), dataCompra: createdAt,
    codigo: row.receipt_code, isPix: !row.card_brand,
  });
  const base: ReceiptSendPlan = {
    ok: true, refund: row, phone, phoneMasked: maskPhone(phone), message, customerName: name,
    fileName: `Comprovante-de-estorno-${row.receipt_code}.pdf`, instance: null,
  };
  if (!phone) return { ...base, blocked: "A cliente não tem WhatsApp cadastrado nesta venda/pedido — não é possível enviar." };

  // Instância: a da conversa aberta (se informada) ou a última conversa com a cliente.
  let numberId: string | null = preferredNumberId || null;
  if (!numberId) {
    const { data: last } = await supabase.from("whatsapp_messages")
      .select("whatsapp_number_id").in("phone", [phone, phone.slice(2)])
      .not("whatsapp_number_id", "is", null).order("created_at", { ascending: false }).limit(1);
    numberId = last?.[0]?.whatsapp_number_id || null;
  }
  if (!numberId) return { ...base, blocked: "Não há conversa de WhatsApp com esta cliente — abra o atendimento por uma instância antes de enviar." };
  const { data: inst } = await supabase.from("whatsapp_numbers").select("id, provider, label, phone_display, is_active").eq("id", numberId).maybeSingle();
  if (!inst || inst.is_active === false) return { ...base, blocked: "A instância da conversa está desativada." };
  const provider = ["meta", "uazapi", "wasender"].includes(inst.provider) ? inst.provider : "zapi";
  const instance = { id: inst.id, provider, label: `${inst.label || "WhatsApp"}${inst.phone_display ? ` (${inst.phone_display})` : ""}` };

  if (provider === "meta") {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: inc } = await supabase.from("whatsapp_messages").select("id")
      .in("phone", [phone, phone.slice(2)]).eq("whatsapp_number_id", inst.id).eq("direction", "incoming")
      .gte("created_at", since).limit(1);
    if (!inc || inc.length === 0) return { ...base, instance, blocked: "Janela de 24h fechada — envie um template ou aguarde a cliente responder." };
  }
  return { ...base, instance };
}

export async function executeReceiptSend(supabase: any, plan: ReceiptSendPlan, text: string, userId: string, userName: string | null) {
  const row = plan.refund;
  const inst = plan.instance;
  if (!inst || !row) return {ok:false,error:"Comprovante ou instância não disponível."};
  const { data: signed } = await supabase.storage.from("refund-receipts").createSignedUrl(row.receipt_path, 3600);
  const url = signed?.signedUrl;
  if (!url) return { ok: false, error: "Não consegui gerar o link do comprovante." };

  const fn = inst.provider === "meta" ? "meta-whatsapp-send"
    : inst.provider === "uazapi" ? "uazapi-send-media"
    : inst.provider === "wasender" ? "wasender-send-media" : "zapi-send-media";
  const payload = inst.provider === "meta"
    ? { phone: plan.phone, type: "document", mediaUrl: url, caption: text, fileName: plan.fileName, whatsapp_number_id: inst.id }
    : { phone: plan.phone, mediaUrl: url, mediaType: "document", caption: text, fileName: plan.fileName, filename: plan.fileName, whatsapp_number_id: inst.id };

  const resp = await fetch(`${(globalThis as any).Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${(globalThis as any).Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data?.success === false || data?.error) {
    const detail = typeof data?.error === "string" ? data.error : data?.error?.message || `HTTP ${resp.status}`;
    return { ok: false, error: `O WhatsApp recusou o envio: ${detail}` };
  }
  const messageId = data?.messageId ?? data?.data?.messageId ?? data?.data?.messageid ?? data?.data?.id ?? data?.data?.zaapId ?? null;

  // Histórico da conversa, como as outras mensagens enviadas pelo sistema.
  await supabase.from("whatsapp_messages").insert({
    phone: plan.phone, message: text, direction: "outgoing", status: "sent",
    message_id: messageId != null ? String(messageId) : null, whatsapp_number_id: inst.id, channel: "whatsapp",
    media_type: "document", media_url: url, sender_user_id: userId, sender_name: userName,
  });
  const now = new Date().toISOString();
  await supabase.from("gateway_refunds").update({
    receipt_sent_at: now, receipt_sent_by: userId, receipt_sent_to: plan.phoneMasked,
    receipt_sent_channel: `${inst.provider} · ${inst.label}`, updated_at: now,
  }).eq("id", row.id);
  return { ok: true, sent_at: now };
}
