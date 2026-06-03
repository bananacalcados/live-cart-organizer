// Public checkout proxy — runs all anonymous checkout DB operations server-side
// with the service_role key, so the underlying tables (pos_sales, pos_sale_items,
// pos_customers, pos_checkout_attempts) no longer need public/anon access.
//
// The saleId / orderId UUID in the checkout URL acts as the capability token,
// exactly like before — but now the table privileges are locked down and every
// write is field-whitelisted and validated here.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOWED_ORIGINS.includes(origin)
    ? origin
    // Allow Lovable preview/sandbox subdomains
    : /\.lovable\.(app|dev)$/.test((() => { try { return new URL(origin).hostname; } catch { return ""; } })())
      ? origin
      : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const digits = (v: unknown) => (typeof v === "string" ? v.replace(/\D/g, "") : "");

// Whitelisted fields the public checkout may write to pos_sales
const SALE_PATCH_KEYS = new Set([
  "customer_name",
  "customer_phone",
  "customer_id",
  "checkout_step",
  "payment_details",
  "shipping_address",
  "total",
  "status",
]);

const ATTEMPT_KEYS = new Set([
  "sale_id",
  "store_id",
  "payment_method",
  "status",
  "error_message",
  "amount",
  "customer_name",
  "customer_phone",
  "customer_email",
  "gateway",
  "transaction_id",
  "metadata",
]);

const CUSTOMER_KEYS = new Set([
  "name",
  "cpf",
  "email",
  "whatsapp",
  "address",
  "address_number",
  "complement",
  "neighborhood",
  "city",
  "state",
  "cep",
]);

function pick(obj: Record<string, unknown>, allowed: Set<string>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj || {})) {
    if (allowed.has(k)) out[k] = obj[k];
  }
  return out;
}

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    switch (action) {
      // ── Load a sale + store name + items (StoreCheckout / CatalogLeadPage) ──
      case "get_sale": {
        const { saleId, storeId } = body;
        if (!isUuid(saleId)) return json({ error: "invalid saleId" }, 400);

        let q = supabase.from("pos_sales").select("*").eq("id", saleId);
        if (isUuid(storeId)) q = q.eq("store_id", storeId);
        const { data: sale, error } = await q.maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (!sale) return json({ sale: null });

        let store_name = "Loja";
        if (sale.store_id) {
          const { data: store } = await supabase
            .from("pos_stores").select("name").eq("id", sale.store_id).maybeSingle();
          if (store?.name) store_name = store.name;
        }

        const { data: items } = await supabase
          .from("pos_sale_items").select("*").eq("sale_id", saleId);

        return json({ sale, store_name, items: items || [] });
      }

      // ── Lightweight status poll ──
      case "get_sale_status": {
        const { saleId } = body;
        if (!isUuid(saleId)) return json({ error: "invalid saleId" }, 400);
        const { data } = await supabase
          .from("pos_sales").select("status, payment_gateway").eq("id", saleId).maybeSingle();
        return json({ status: data?.status ?? null, payment_gateway: data?.payment_gateway ?? null });
      }

      // ── Progressive customer/address/step saves ──
      case "update_sale": {
        const { saleId, storeId, patch } = body;
        if (!isUuid(saleId)) return json({ error: "invalid saleId" }, 400);
        const clean = pick(patch || {}, SALE_PATCH_KEYS);
        if (Object.keys(clean).length === 0) return json({ error: "empty patch" }, 400);
        if (clean.customer_id !== undefined && clean.customer_id !== null && !isUuid(clean.customer_id)) {
          delete clean.customer_id;
        }
        let q = supabase.from("pos_sales").update(clean).eq("id", saleId);
        if (isUuid(storeId)) q = q.eq("store_id", storeId);
        const { error } = await q;
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ── Checkout attempt logging ──
      case "log_attempt": {
        const attempt = pick(body?.attempt || {}, ATTEMPT_KEYS);
        if (!isUuid(attempt.sale_id)) return json({ error: "invalid sale_id" }, 400);
        const { error } = await supabase.from("pos_checkout_attempts").insert(attempt);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "get_attempt_status": {
        const { transactionId } = body;
        if (typeof transactionId !== "string" || transactionId.length === 0)
          return json({ error: "invalid transactionId" }, 400);
        const { data } = await supabase
          .from("pos_checkout_attempts")
          .select("status, error_message")
          .eq("transaction_id", transactionId)
          .maybeSingle();
        return json({ status: data?.status ?? null, error_message: data?.error_message ?? null });
      }

      // ── Customer prefill by CPF (safe subset only) ──
      case "lookup_customer_cpf": {
        const cpf = digits(body?.cpf);
        if (cpf.length !== 11) return json({ customer: null });
        const { data } = await supabase
          .from("pos_customers")
          .select("name, email, whatsapp, cep, address, address_number, complement, neighborhood, city, state")
          .eq("cpf", cpf)
          .limit(1);
        return json({ customer: data && data.length > 0 ? data[0] : null });
      }

      // ── Finalize a sale: upsert customer + mark sale completed ──
      case "complete_sale": {
        const { saleId } = body;
        if (!isUuid(saleId)) return json({ error: "invalid saleId" }, 400);
        const customer = pick(body?.customer || {}, CUSTOMER_KEYS);
        customer.cpf = digits(customer.cpf) || null;
        customer.whatsapp = digits(customer.whatsapp) || null;
        customer.cep = digits(customer.cep) || null;

        let customerId: string | null = null;
        if (customer.cpf) {
          const { data } = await supabase
            .from("pos_customers").select("id").eq("cpf", customer.cpf).maybeSingle();
          if (data) customerId = data.id;
        }
        if (!customerId && customer.whatsapp) {
          const { data } = await supabase
            .from("pos_customers").select("id").eq("whatsapp", customer.whatsapp).maybeSingle();
          if (data) customerId = data.id;
        }
        if (customerId) {
          await supabase.from("pos_customers").update(customer).eq("id", customerId);
        } else {
          const { data } = await supabase
            .from("pos_customers").insert(customer).select("id").single();
          customerId = data?.id || null;
        }

        await supabase.from("pos_sales")
          .update({ status: "completed", customer_id: customerId })
          .eq("id", saleId);

        return json({ ok: true, customerId });
      }

      // ── Pickup sale creation (CustomerRegister) ──
      case "create_pickup_sale": {
        const { storeId, sourceOrderId, customerName, customerPhone, subtotal, discount, total, notes, items } = body;
        if (!isUuid(storeId)) return json({ error: "invalid storeId" }, 400);
        if (!Array.isArray(items) || items.length === 0) return json({ error: "no items" }, 400);

        const { data: sale, error: saleError } = await supabase
          .from("pos_sales")
          .insert({
            store_id: storeId,
            subtotal: Number(subtotal) || 0,
            discount: Number(discount) || 0,
            total: Number(total) || 0,
            status: "pending_pickup",
            sale_type: "pickup",
            source_order_id: isUuid(sourceOrderId) ? sourceOrderId : null,
            customer_name: typeof customerName === "string" ? customerName : null,
            customer_phone: digits(customerPhone) || null,
            notes: typeof notes === "string" ? notes : null,
          })
          .select("id")
          .single();
        if (saleError) return json({ error: saleError.message }, 500);

        const saleItems = items.map((p: Record<string, unknown>) => ({
          sale_id: sale.id,
          product_name: p.product_name ?? p.title ?? null,
          variant_name: p.variant_name ?? p.variant ?? null,
          sku: p.sku ?? null,
          unit_price: Number(p.unit_price ?? p.price) || 0,
          quantity: Number(p.quantity) || 1,
          total_price: (Number(p.unit_price ?? p.price) || 0) * (Number(p.quantity) || 1),
        }));
        const { error: itemsError } = await supabase.from("pos_sale_items").insert(saleItems);
        if (itemsError) return json({ error: itemsError.message }, 500);

        return json({ ok: true, saleId: sale.id });
      }

      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
