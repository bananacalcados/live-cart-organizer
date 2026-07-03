// pos-conditional-create
// Cria um CONDICIONAL (etapa 1): pedido enviado ao cliente para experimentar.
// - Insere pos_sales com status='conditional', is_conditional=true,
//   conditional_status='draft_sent', sale_type='online' (herda aba Envios/endereço).
// - Insere os itens e então chama process_pos_sale_sale_event para BAIXAR o estoque
//   (registrando ajustes sale_event='sale' — isso torna a finalização idempotente).
// - NÃO conta faturamento (status 'conditional' é ignorado por pos_sale_to_faturamento)
//   e NÃO dá pontos de gamificação (ainda não é venda).
//
// Body: { store_id, seller_id, customer, items, notes }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await anon.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);

    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const { store_id, seller_id, customer, items, notes } = body || {};

    if (!store_id) return json({ error: "store_id é obrigatório" }, 400);
    if (!Array.isArray(items) || items.length === 0) return json({ error: "items é obrigatório" }, 400);
    if (!customer?.name || !customer?.cpf || !(customer?.whatsapp || customer?.phone) ||
        !customer?.email || !customer?.cep || !customer?.address) {
      return json({ error: "Dados obrigatórios do cliente ausentes (nome, CPF, telefone, email, endereço)" }, 400);
    }

    const subtotal = items.reduce((s: number, i: any) => s + Number(i.price || 0) * Number(i.quantity || 0), 0);

    const shippingAddr = {
      name: customer.name,
      cpf: customer.cpf,
      phone: customer.whatsapp || customer.phone,
      cep: customer.cep,
      address: customer.address,
      address_number: customer.address_number || customer.addressNumber || null,
      complement: customer.complement || null,
      neighborhood: customer.neighborhood || null,
      city: customer.city || null,
      state: customer.state || null,
    };

    // 1) Cria a venda em condicional
    const { data: sale, error: saleErr } = await db
      .from("pos_sales")
      .insert({
        store_id,
        seller_id: seller_id || null,
        customer_id: customer?.id || null,
        customer_name: customer.name,
        customer_phone: customer.whatsapp || customer.phone || null,
        customer_cpf: customer.cpf || null,
        customer_email: customer.email || null,
        customer_cep: customer.cep || null,
        customer_city: customer.city || null,
        customer_state: customer.state || null,
        subtotal,
        discount: 0,
        total: subtotal,
        status: "conditional",
        is_conditional: true,
        conditional_status: "draft_sent",
        sale_type: "online",
        expedition_status: "pending",
        shipping_address: shippingAddr,
        notes: `📦 Condicional${notes ? ` · ${notes}` : ""}`,
        payment_details: { link_origin: "pdv_venda", conditional: true },
      })
      .select("id")
      .single();
    if (saleErr) return json({ error: saleErr.message }, 500);
    const saleId = sale.id;

    // 2) Insere itens
    const saleItems = items.map((item: any) => ({
      sale_id: saleId,
      sku: item.sku || "",
      product_name: item.name,
      variant_name: item.variant || null,
      size: item.size || null,
      category: item.category || null,
      quantity: item.quantity,
      unit_price: item.price,
      total_price: Number(item.price || 0) * Number(item.quantity || 0),
      barcode: item.barcode || null,
      tiny_product_id: item.tiny_id ? String(item.tiny_id) : null,
    }));
    const { error: itemsErr } = await db.from("pos_sale_items").insert(saleItems);
    if (itemsErr) return json({ error: itemsErr.message, sale_id: saleId }, 500);

    // 3) Baixa o estoque (registra ajustes sale_event='sale' -> finalização idempotente)
    const { error: rpcErr } = await db.rpc("process_pos_sale_sale_event", { p_sale_id: saleId });
    if (rpcErr) {
      console.error("[pos-conditional-create] process error", rpcErr);
      return json({ ok: true, sale_id: saleId, stock_warning: rpcErr.message });
    }

    return json({ ok: true, sale_id: saleId });
  } catch (e) {
    console.error("[pos-conditional-create]", e);
    return json({ error: (e as Error).message || "Erro interno" }, 500);
  }
});
