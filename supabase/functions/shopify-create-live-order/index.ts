import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LIVE_DEDUPE_ATTR = "lovable_live_dedupe_key";
const LIVE_LOOKBACK_HOURS = 6;
const LOCK_STALE_MS = 10 * 60 * 1000;

type IncomingItem = {
  variantId?: string | null;
  title?: string | null;
  productTitle?: string | null;
  price?: number | null;
  quantity?: number | null;
};

type IncomingCustomer = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  cpf?: string | null;
  address?: {
    street?: string | null;
    number?: string | null;
    city?: string | null;
    state?: string | null;
    cep?: string | null;
  } | null;
};

type LockRow = {
  dedupe_key: string;
  locked_at: string;
  shopify_order_id: string | null;
  shopify_order_name: string | null;
  status: string;
};

function extractVariantNumericId(variantId?: string | null): number | null {
  const match = variantId?.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function money(value: number | string | null | undefined): string {
  return Number(value || 0).toFixed(2);
}

function normalizePhoneDigits(raw: string | null | undefined): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function normalizeEmail(raw: string | null | undefined): string {
  return (raw || "").trim().toLowerCase();
}

function normalizeCpfDigits(raw: string | null | undefined): string {
  return (raw || "").replace(/\D/g, "");
}

function normalizeTitle(raw: string | null | undefined): string {
  return (raw || "Produto").trim().toLowerCase();
}

function formatPhone(raw: string | null | undefined): string | null {
  const full = normalizePhoneDigits(raw);
  if (full.length < 12 || full.length > 13) return null;
  return `+${full}`;
}

function buildLineItems(items: IncomingItem[]) {
  return items.map((item) => {
    const variantId = extractVariantNumericId(item.variantId);
    if (variantId) {
      return {
        variant_id: variantId,
        quantity: Number(item.quantity || 1),
        price: money(item.price),
      };
    }

    return {
      title: item.title || item.productTitle || "Produto",
      quantity: Number(item.quantity || 1),
      price: money(item.price),
    };
  });
}

function buildSerializableLineItems(items: IncomingItem[]) {
  return items.map((item) => ({
    variant_id: extractVariantNumericId(item.variantId)?.toString() || null,
    title: item.title || item.productTitle || "Produto",
    quantity: Number(item.quantity || 1),
    price: money(item.price),
  }));
}

function buildIncomingLineSignature(items: IncomingItem[]): string {
  return items
    .map((item) => {
      const variantId = extractVariantNumericId(item.variantId);
      return `${variantId ?? normalizeTitle(item.title || item.productTitle)}:${Number(item.quantity || 1)}:${money(item.price)}`;
    })
    .sort()
    .join("|");
}

function buildShopifyLineSignature(lineItems: Array<Record<string, unknown>> = []): string {
  return lineItems
    .map((item) => {
      const variantId = typeof item.variant_id === "number" || typeof item.variant_id === "string"
        ? String(item.variant_id)
        : null;
      return `${variantId ?? normalizeTitle(String(item.title || "Produto"))}:${Number(item.quantity || 1)}:${money(item.price as number | string | null | undefined)}`;
    })
    .sort()
    .join("|");
}

function getNoteAttribute(order: Record<string, any>, name: string): string | null {
  const attrs = Array.isArray(order?.note_attributes) ? order.note_attributes : [];
  const attribute = attrs.find((item: any) => item?.name === name);
  return typeof attribute?.value === "string" ? attribute.value : null;
}

function buildSourceTag(source: string): string {
  return source.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "live";
}

function isLockStale(lock: Pick<LockRow, "locked_at" | "status">): boolean {
  if (lock.status !== "processing") return false;
  return Date.now() - new Date(lock.locked_at).getTime() > LOCK_STALE_MS;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveDedupeKey(
  providedDedupeKey: string | null | undefined,
  sessionId: string | null | undefined,
  items: IncomingItem[],
  customer: IncomingCustomer | null | undefined,
) {
  if (providedDedupeKey?.trim()) return providedDedupeKey.trim();

  return await sha256Hex(JSON.stringify({
    scope: "live-commerce",
    sessionId: sessionId || null,
    phone: normalizePhoneDigits(customer?.phone),
    email: normalizeEmail(customer?.email),
    cpf: normalizeCpfDigits(customer?.cpf),
    items: items
      .map((item) => ({
        variantId: extractVariantNumericId(item.variantId),
        title: normalizeTitle(item.title || item.productTitle),
        quantity: Number(item.quantity || 1),
        price: money(item.price),
      }))
      .sort((a, b) => `${a.variantId ?? a.title}`.localeCompare(`${b.variantId ?? b.title}`)),
  }));
}

async function findExistingShopifyOrder(params: {
  shopifyDomain: string;
  shopifyToken: string;
  dedupeKey: string;
  items: IncomingItem[];
  customer: IncomingCustomer | null | undefined;
}) {
  const createdAtMin = new Date(Date.now() - LIVE_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const url = `https://${params.shopifyDomain}/admin/api/2025-01/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(createdAtMin)}&fields=id,name,created_at,phone,email,note_attributes,line_items,customer`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": params.shopifyToken,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Error fetching Shopify orders for dedupe:", errorBody);
    return null;
  }

  const result = await response.json();
  const orders = Array.isArray(result.orders) ? result.orders : [];
  const incomingPhone = normalizePhoneDigits(params.customer?.phone);
  const incomingEmail = normalizeEmail(params.customer?.email);
  const incomingLineSignature = buildIncomingLineSignature(params.items);

  return orders.find((order: Record<string, any>) => {
    const existingDedupeKey = getNoteAttribute(order, LIVE_DEDUPE_ATTR);
    if (existingDedupeKey && existingDedupeKey === params.dedupeKey) {
      return true;
    }

    const samePhone = incomingPhone && normalizePhoneDigits(order.phone || order.customer?.phone) === incomingPhone;
    const sameEmail = incomingEmail && normalizeEmail(order.email || order.customer?.email) === incomingEmail;

    if (!samePhone && !sameEmail) {
      return false;
    }

    return buildShopifyLineSignature(order.line_items || []) === incomingLineSignature;
  }) || null;
}

async function acquireLock(
  supabase: ReturnType<typeof createClient>,
  payload: {
    dedupeKey: string;
    sessionId: string | null;
    source: string;
    customerPhoneNormalized: string;
    customerEmailNormalized: string;
    customerCpfNormalized: string;
    lineSignature: string;
  },
) {
  const insertResult = await supabase
    .from("shopify_live_order_locks")
    .insert({
      dedupe_key: payload.dedupeKey,
      session_id: payload.sessionId,
      source: payload.source,
      customer_phone_normalized: payload.customerPhoneNormalized || null,
      customer_email_normalized: payload.customerEmailNormalized || null,
      customer_cpf_normalized: payload.customerCpfNormalized || null,
      line_signature: payload.lineSignature,
      status: "processing",
    })
    .select("dedupe_key, locked_at, shopify_order_id, shopify_order_name, status")
    .single();

  if (!insertResult.error) {
    return { status: "acquired" as const, lock: insertResult.data as LockRow };
  }

  if (insertResult.error.code !== "23505") {
    throw insertResult.error;
  }

  const existingResult = await supabase
    .from("shopify_live_order_locks")
    .select("dedupe_key, locked_at, shopify_order_id, shopify_order_name, status")
    .eq("dedupe_key", payload.dedupeKey)
    .maybeSingle();

  if (existingResult.error) throw existingResult.error;
  return { status: "exists" as const, lock: existingResult.data as LockRow | null };
}

async function updateLock(
  supabase: ReturnType<typeof createClient>,
  dedupeKey: string,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("shopify_live_order_locks")
    .update({
      ...payload,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("dedupe_key", dedupeKey);

  if (error) {
    console.error("Failed to update Shopify live order lock:", error.message);
  }
}

async function insertSyncRecord(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase.from("shopify_live_order_syncs").insert(payload);
  if (error) {
    console.error("Failed to insert Shopify live order sync record:", error.message);
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let supabaseAdmin: ReturnType<typeof createClient> | null = null;
  let dedupeKey = "";
  let sessionId: string | null = null;
  let source = "live";
  let customerName = "Cliente Live";
  let customerPhoneNormalized = "";
  let customerEmailNormalized = "";
  let customerCpfNormalized = "";
  let lineSignature = "";
  let liveViewerId: string | null = null;
  let orderId: string | null = null;
  let serializedItems: ReturnType<typeof buildSerializableLineItems> = [];

  try {
    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!shopifyDomain || !shopifyToken) {
      throw new Error("Shopify credentials not configured");
    }

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Backend credentials not configured");
    }

    supabaseAdmin = createClient(supabaseUrl, supabaseKey);

    const {
      items,
      customer,
      sessionId: requestSessionId,
      source: requestSource,
      dedupeKey: providedDedupeKey,
      liveViewerId: requestLiveViewerId,
      orderId: requestOrderId,
    } = await req.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("items array is required");
    }

    sessionId = typeof requestSessionId === "string" && requestSessionId.trim() ? requestSessionId : null;
    liveViewerId = typeof requestLiveViewerId === "string" && requestLiveViewerId.trim() ? requestLiveViewerId : null;
    orderId = typeof requestOrderId === "string" && requestOrderId.trim() ? requestOrderId : null;
    source = typeof requestSource === "string" && requestSource.trim() ? requestSource.trim() : "live";
    customerName = (customer?.name || "Cliente Live").trim();
    customerPhoneNormalized = normalizePhoneDigits(customer?.phone);
    customerEmailNormalized = normalizeEmail(customer?.email);
    customerCpfNormalized = normalizeCpfDigits(customer?.cpf);
    lineSignature = buildIncomingLineSignature(items);
    serializedItems = buildSerializableLineItems(items);
    dedupeKey = await resolveDedupeKey(providedDedupeKey, sessionId, items, customer);

    const lockResult = await acquireLock(supabaseAdmin, {
      dedupeKey,
      sessionId,
      source,
      customerPhoneNormalized,
      customerEmailNormalized,
      customerCpfNormalized,
      lineSignature,
    });

    if (lockResult.status === "exists" && lockResult.lock) {
      if (lockResult.lock.shopify_order_id) {
        return jsonResponse({
          success: true,
          deduped: true,
          processing: false,
          shopifyOrderId: lockResult.lock.shopify_order_id,
          shopifyOrderName: lockResult.lock.shopify_order_name,
          dedupeKey,
        });
      }

      if (!isLockStale(lockResult.lock)) {
        await updateLock(supabaseAdmin, dedupeKey, { status: "processing" });
        return jsonResponse({
          success: true,
          deduped: false,
          processing: true,
          dedupeKey,
          message: "Order creation already in progress",
        }, 202);
      }

      await updateLock(supabaseAdmin, dedupeKey, {
        status: "processing",
        error_message: null,
        locked_at: new Date().toISOString(),
      });
    }

    const existingOrder = await findExistingShopifyOrder({
      shopifyDomain,
      shopifyToken,
      dedupeKey,
      items,
      customer,
    });

    if (existingOrder) {
      console.log("Skipping duplicate Shopify live order:", existingOrder.id, existingOrder.name);
      await updateLock(supabaseAdmin, dedupeKey, {
        status: "deduped",
        shopify_order_id: String(existingOrder.id),
        shopify_order_name: existingOrder.name || null,
        error_message: null,
      });
      await insertSyncRecord(supabaseAdmin, {
        dedupe_key: dedupeKey,
        session_id: sessionId,
        source,
        order_id: orderId,
        live_viewer_id: liveViewerId,
        customer_name: customerName,
        customer_phone_normalized: customerPhoneNormalized || null,
        customer_email_normalized: customerEmailNormalized || null,
        customer_cpf_normalized: customerCpfNormalized || null,
        line_signature: lineSignature,
        line_items: serializedItems,
        shopify_order_id: String(existingOrder.id),
        shopify_order_name: existingOrder.name || null,
        shopify_order_created_at: existingOrder.created_at || null,
        sync_status: "deduped",
      });
      return jsonResponse({
        success: true,
        deduped: true,
        processing: false,
        shopifyOrderId: existingOrder.id,
        shopifyOrderName: existingOrder.name,
        dedupeKey,
      });
    }

    const lineItems = buildLineItems(items);
    const phone = formatPhone(customer?.phone);
    const fullName = customerName;
    const nameParts = fullName.split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ").trim() || "-";

    const shopifyCustomer: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
    };
    if (customer?.email) shopifyCustomer.email = customer.email;
    if (phone) shopifyCustomer.phone = phone;

    let shippingAddress: Record<string, unknown> | null = null;
    const addr = customer?.address;
    if (addr && (addr.street || addr.city)) {
      shippingAddress = {
        first_name: firstName,
        last_name: lastName,
        address1: addr.street ? `${addr.street}, ${addr.number || ""}`.trim() : undefined,
        city: addr.city || undefined,
        province: addr.state || undefined,
        zip: addr.cep || undefined,
        country: "BR",
        phone: phone || undefined,
      };
    }

    const noteAttributes: Array<{ name: string; value: string }> = [
      { name: LIVE_DEDUPE_ATTR, value: dedupeKey },
    ];
    if (customer?.cpf) {
      noteAttributes.push({ name: "cpf", value: customer.cpf });
    }
    if (sessionId) {
      noteAttributes.push({ name: "live_session_id", value: String(sessionId) });
    }
    if (source) {
      noteAttributes.push({ name: "lovable_source", value: String(source) });
    }
    if (liveViewerId) {
      noteAttributes.push({ name: "live_viewer_id", value: String(liveViewerId) });
    }
    if (orderId) {
      noteAttributes.push({ name: "live_order_id", value: String(orderId) });
    }

    const sourceTag = buildSourceTag(source);
    const shopifyOrder = {
      order: {
        line_items: lineItems,
        financial_status: "paid",
        note: `Pedido via Live Commerce${customer?.cpf ? ` | CPF: ${customer.cpf}` : ""} | Cliente: ${fullName} | Tel: ${customer?.phone || "N/A"}`,
        tags: ["live-commerce", "auto-sync", sourceTag].filter(Boolean).join(","),
        customer: shopifyCustomer,
        note_attributes: noteAttributes,
        ...(customer?.email ? { email: customer.email } : {}),
        ...(phone ? { phone } : {}),
        ...(shippingAddress ? { shipping_address: shippingAddress, billing_address: shippingAddress } : {}),
      },
    };

    console.log("Creating Shopify order from live:", JSON.stringify({ customer: shopifyCustomer, itemCount: lineItems.length, dedupeKey, source }));

    const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/orders.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyToken,
      },
      body: JSON.stringify(shopifyOrder),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Shopify error:", errorBody);
      throw new Error(`Shopify API error ${response.status}: ${errorBody}`);
    }

    const result = await response.json();
    console.log("Shopify live order created:", result.order?.id, result.order?.name);

    await updateLock(supabaseAdmin, dedupeKey, {
      status: "created",
      shopify_order_id: result.order?.id ? String(result.order.id) : null,
      shopify_order_name: result.order?.name || null,
      error_message: null,
    });

    await insertSyncRecord(supabaseAdmin, {
      dedupe_key: dedupeKey,
      session_id: sessionId,
      source,
      order_id: orderId,
      live_viewer_id: liveViewerId,
      customer_name: customerName,
      customer_phone_normalized: customerPhoneNormalized || null,
      customer_email_normalized: customerEmailNormalized || null,
      customer_cpf_normalized: customerCpfNormalized || null,
      line_signature: lineSignature,
      line_items: serializedItems,
      shopify_order_id: result.order?.id ? String(result.order.id) : null,
      shopify_order_name: result.order?.name || null,
      shopify_order_created_at: result.order?.created_at || null,
      sync_status: "created",
    });

    return jsonResponse({
      success: true,
      deduped: false,
      processing: false,
      shopifyOrderId: result.order?.id,
      shopifyOrderName: result.order?.name,
      dedupeKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error creating Shopify live order:", message);

    if (supabaseAdmin && dedupeKey) {
      await updateLock(supabaseAdmin, dedupeKey, {
        status: "failed",
        error_message: message,
      });
      await insertSyncRecord(supabaseAdmin, {
        dedupe_key: dedupeKey,
        session_id: sessionId,
        source,
        order_id: orderId,
        live_viewer_id: liveViewerId,
        customer_name: customerName,
        customer_phone_normalized: customerPhoneNormalized || null,
        customer_email_normalized: customerEmailNormalized || null,
        customer_cpf_normalized: customerCpfNormalized || null,
        line_signature: lineSignature || "failed-without-signature",
        line_items: serializedItems,
        sync_status: "failed",
        resolution_notes: message,
      });
    }

    return jsonResponse({ error: message }, 500);
  }
});