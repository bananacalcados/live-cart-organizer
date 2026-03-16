import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LIVE_DEDUPE_ATTR = "lovable_live_dedupe_key";
const LIVE_LOOKBACK_HOURS = 6;

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
    cpf: (customer?.cpf || "").replace(/\D/g, ""),
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

    if (!shopifyDomain || !shopifyToken) {
      throw new Error("Shopify credentials not configured");
    }

    const { items, customer, sessionId, source, dedupeKey: providedDedupeKey } = await req.json();
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("items array is required");
    }

    const dedupeKey = await resolveDedupeKey(providedDedupeKey, sessionId, items, customer);
    const existingOrder = await findExistingShopifyOrder({
      shopifyDomain,
      shopifyToken,
      dedupeKey,
      items,
      customer,
    });

    if (existingOrder) {
      console.log("Skipping duplicate Shopify live order:", existingOrder.id, existingOrder.name);
      return new Response(
        JSON.stringify({
          success: true,
          deduped: true,
          shopifyOrderId: existingOrder.id,
          shopifyOrderName: existingOrder.name,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const lineItems = buildLineItems(items);
    const phone = formatPhone(customer?.phone);
    const fullName = (customer?.name || "Cliente Live").trim();
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

    const shopifyOrder = {
      order: {
        line_items: lineItems,
        financial_status: "paid",
        note: `Pedido via Live Commerce${customer?.cpf ? ` | CPF: ${customer.cpf}` : ""} | Cliente: ${fullName} | Tel: ${customer?.phone || "N/A"}`,
        tags: "live-commerce,auto-sync",
        customer: shopifyCustomer,
        note_attributes: noteAttributes,
        ...(customer?.email ? { email: customer.email } : {}),
        ...(phone ? { phone } : {}),
        ...(shippingAddress ? { shipping_address: shippingAddress, billing_address: shippingAddress } : {}),
      },
    };

    console.log("Creating Shopify order from live:", JSON.stringify({ customer: shopifyCustomer, itemCount: lineItems.length, dedupeKey }));

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

    return new Response(
      JSON.stringify({
        success: true,
        deduped: false,
        shopifyOrderId: result.order?.id,
        shopifyOrderName: result.order?.name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error creating Shopify live order:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
