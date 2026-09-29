import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

/**
 * Confirmação automática de pagamento para links gerados no WhatsApp do PDV
 * (checkout, Pix e boleto com link_origin = "whatsapp_chat").
 * Mesmo texto da confirmação da Live, com o link de rastreio.
 * Envia SEMPRE pela instância em que o link foi gerado (payment_details.whatsapp_number_id);
 * sem esse dado (links antigos), usa a última instância da conversa com a cliente.
 * O cashback NÃO é gerado aqui — quem gera é automation-trigger-pos-sale; aqui só lemos.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

function normalizePhoneBR(raw: string) {
  let p = String(raw || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = p.slice(1);
  if (!p.startsWith("55") && p.length <= 11) p = "55" + p;
  if (p.startsWith("55") && p.length === 12) p = p.slice(0, 4) + "9" + p.slice(4);
  return p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let saleId = "";
  try {
    const body = await req.json().catch(() => ({}));
    saleId = String(body?.sale_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(saleId)) return json({ error: "sale_id required" }, 400);

    const { data: sale } = await supabase
      .from("pos_sales")
      .select("id, status, status_cancelamento, sale_type, customer_name, customer_phone, customer_id, payment_details, is_store_pickup")
      .eq("id", saleId)
      .maybeSingle();
    if (!sale) return json({ handled: false, reason: "sale_not_found" });
    const pd = (sale.payment_details || {}) as any;
    if (pd.link_origin !== "whatsapp_chat") return json({ handled: false, reason: "not_whatsapp_link" });
    if (!["paid", "completed"].includes(String(sale.status))) return json({ handled: false, reason: "not_paid" });
    if (String(sale.status_cancelamento || "ativo") !== "ativo") return json({ handled: false, reason: "cancelled" });

    // Idempotência: uma única confirmação por venda.
    const { error: claimErr } = await supabase.from("pos_link_confirmation_sent").insert({ sale_id: saleId });
    if (claimErr) return json({ handled: false, reason: "already_sent" });
    const release = () => supabase.from("pos_link_confirmation_sent").delete().eq("sale_id", saleId);

    let rawPhone = sale.customer_phone || pd.customer_phone || "";
    if (!rawPhone && sale.customer_id) {
      const { data: c } = await supabase.from("pos_customers").select("whatsapp").eq("id", sale.customer_id).maybeSingle();
      rawPhone = c?.whatsapp || "";
    }
    if (!String(rawPhone).replace(/\D/g, "")) { await release(); return json({ handled: false, reason: "no_phone" }); }
    const fullPhone = normalizePhoneBR(rawPhone);
    const suffix8 = fullPhone.slice(-8);
    const firstName = String(sale.customer_name || pd.customer_name || "").trim().split(/\s+/)[0] || "Cliente";
    const name = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();

    // Dá tempo para o cashback (automation-trigger-pos-sale) e o rastreio nascerem.
    await sleep(5000);

    const { data: items } = await supabase
      .from("pos_sale_items")
      .select("product_name, variant_name, quantity")
      .eq("sale_id", saleId);
    const list = (items && items.length ? items : (pd.items_detail || []).map((i: any) => ({
      product_name: i.title, variant_name: i.variant, quantity: i.quantity,
    }))) as any[];
    const productLines = list.map((p, i) => {
      const qty = Number(p.quantity || 1);
      return `*${i + 1}. ${p.product_name || "Produto"}${p.variant_name ? ` — ${p.variant_name}` : ""}*${qty > 1 ? ` (${qty}x)` : ""}`;
    }).join("\n");

    let cashbackLine = "";
    const { data: cb } = await supabase
      .from("internal_cashback")
      .select("cashback_amount, min_purchase, expires_at")
      .ilike("customer_phone", `%${suffix8}`)
      .eq("is_used", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cb) {
      cashbackLine = `\n\n💰 *Você ganhou ${fmt(Number(cb.cashback_amount))} de cashback* para sua próxima compra acima de *${fmt(Number(cb.min_purchase))}*. Válido até *${new Date(cb.expires_at).toLocaleDateString("pt-BR")}*`;
    }

    let trackingLine = "";
    let { data: ship } = await supabase
      .from("shipment_simulations").select("id, tracking_code, merged_into_id").eq("sale_id", saleId).maybeSingle();
    let guard = 0;
    while (ship?.merged_into_id && guard < 5) {
      const { data: parent } = await supabase
        .from("shipment_simulations").select("id, tracking_code, merged_into_id").eq("id", ship.merged_into_id).maybeSingle();
      if (!parent) break;
      ship = parent; guard++;
    }
    if (ship?.tracking_code) {
      trackingLine = `\n\n🚚 *LINK DE RASTREIO DO PEDIDO:*\n\nhttps://checkout.bananacalcados.com.br/rastreio/${ship.tracking_code}`;
    }

    const message = `Oi ${name}! Pagamento confirmado ✅\n\n` +
      (productLines ? `Confira seu pedido:\n\n${productLines}` : "Recebemos seu pagamento.") +
      cashbackLine + `\n\n📦 Seu pedido seguirá para a expedição.` + trackingLine + `\n\n` +
      `Está tudo correto? Responda *SIM* para confirmar ou avise o que precisa ser corrigido 😊`;

    // Instância: a do link; fallback = última conversa com a cliente.
    let numberId: string | null = pd.whatsapp_number_id || null;
    let via = "link";
    if (!numberId) {
      const { data: last } = await supabase
        .from("whatsapp_messages").select("whatsapp_number_id")
        .like("phone", `%${suffix8}`).not("whatsapp_number_id", "is", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      numberId = last?.whatsapp_number_id || null;
      via = "last_conversation";
    }
    if (!numberId) { await release(); return json({ handled: false, reason: "no_instance" }); }
    const { data: wn } = await supabase.from("whatsapp_numbers").select("provider, label").eq("id", numberId).maybeSingle();
    const prov = String(wn?.provider || "");
    console.log(`[pos-link-confirmation] sale ${saleId} → ${wn?.label}/${prov} via ${via}`);

    const headers = { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };
    const resp = prov === "meta"
      ? await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
          method: "POST", headers, body: JSON.stringify({ phone: fullPhone, message, whatsappNumberId: numberId }),
        })
      : await fetch(`${supabaseUrl}/functions/v1/${prov === "uazapi" ? "uazapi" : prov === "wasender" ? "wasender" : "zapi"}-send-message`, {
          method: "POST", headers,
          body: JSON.stringify({ phone: fullPhone, message, whatsapp_number_id: numberId, whatsappNumberId: numberId }),
        });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error(`[pos-link-confirmation] send failed ${resp.status}: ${txt}`);
      await release();
      return json({ handled: false, reason: "send_failed", status: resp.status, details: txt });
    }
    const d = await resp.json().catch(() => ({}));
    const providerMessageId = String(d?.messageId || d?.messageid || d?.id || d?.data?.messageId || d?.data?.messageid || d?.data?.id || "") || null;

    await supabase.from("whatsapp_messages").insert({
      phone: fullPhone, message, direction: "outgoing", message_id: providerMessageId,
      status: "sent", whatsapp_number_id: numberId,
    });
    await supabase.from("pos_link_confirmation_sent").update({ whatsapp_number_id: numberId, sent_at: new Date().toISOString() }).eq("sale_id", saleId);
    return json({ handled: true, via });
  } catch (e) {
    console.error("[pos-link-confirmation] error", e);
    if (saleId) await supabase.from("pos_link_confirmation_sent").delete().eq("sale_id", saleId).is("sent_at", null);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
