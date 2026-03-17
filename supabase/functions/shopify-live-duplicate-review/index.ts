import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ReviewLineItem = {
  title: string;
  variantId: string | null;
  quantity: number;
  price: string;
};

type ReviewOrder = {
  shopifyOrderId: string;
  shopifyOrderName: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  customerName: string;
  customerPhoneNormalized: string | null;
  customerEmailNormalized: string | null;
  customerCpfNormalized: string | null;
  lineSignature: string;
  lineItems: ReviewLineItem[];
  source: string | null;
  sessionMatch: boolean;
  tags: string[];
};

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

function money(value: number | string | null | undefined): string {
  return Number(value || 0).toFixed(2);
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

function simplifyLineItems(lineItems: Array<Record<string, unknown>> = []): ReviewLineItem[] {
  return lineItems.map((item) => ({
    title: String(item.title || "Produto"),
    variantId: typeof item.variant_id === "number" || typeof item.variant_id === "string"
      ? String(item.variant_id)
      : null,
    quantity: Number(item.quantity || 1),
    price: money(item.price as number | string | null | undefined),
  }));
}

function getNoteAttribute(order: Record<string, any>, name: string): string | null {
  const attrs = Array.isArray(order?.note_attributes) ? order.note_attributes : [];
  const attribute = attrs.find((item: any) => item?.name === name);
  return typeof attribute?.value === "string" ? attribute.value : null;
}

function inferCustomerName(order: Record<string, any>): string {
  const candidate = [
    order?.customer?.first_name,
    order?.customer?.last_name,
  ].filter(Boolean).join(" ").trim();

  return candidate
    || order?.customer?.name
    || order?.shipping_address?.name
    || order?.billing_address?.name
    || order?.email
    || order?.phone
    || "Cliente";
}

function toReviewOrder(order: Record<string, any>, sessionId: string): ReviewOrder | null {
  const source = getNoteAttribute(order, "lovable_source");
  const sessionNote = getNoteAttribute(order, "live_session_id");
  const tags = String(order.tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const isLiveOrder = tags.includes("live-commerce")
    || sessionNote === sessionId
    || (source ? source.startsWith("live") : false);

  if (!isLiveOrder) return null;

  const customerPhoneNormalized = normalizePhoneDigits(
    order.phone || order.customer?.phone || order.shipping_address?.phone || order.billing_address?.phone,
  ) || null;
  const customerEmailNormalized = normalizeEmail(order.email || order.customer?.email) || null;
  const customerCpfNormalized = normalizeCpfDigits(getNoteAttribute(order, "cpf")) || null;
  const lineItems = simplifyLineItems(order.line_items || []);
  const lineSignature = buildShopifyLineSignature(order.line_items || []);

  if (!lineSignature) return null;

  return {
    shopifyOrderId: String(order.id),
    shopifyOrderName: String(order.name || order.order_number || order.id),
    createdAt: String(order.created_at || new Date().toISOString()),
    cancelledAt: order.cancelled_at || null,
    cancelReason: order.cancel_reason || null,
    customerName: inferCustomerName(order),
    customerPhoneNormalized,
    customerEmailNormalized,
    customerCpfNormalized,
    lineSignature,
    lineItems,
    source,
    sessionMatch: sessionNote === sessionId,
    tags,
  };
}

function buildIdentityKey(order: ReviewOrder): string | null {
  if (order.customerCpfNormalized) return `cpf:${order.customerCpfNormalized}`;
  if (order.customerPhoneNormalized) return `phone:${order.customerPhoneNormalized}`;
  if (order.customerEmailNormalized) return `email:${order.customerEmailNormalized}`;
  return null;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

    if (!supabaseUrl || !anonKey || !serviceKey || !shopifyDomain || !shopifyToken) {
      throw new Error("Missing backend configuration");
    }

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );

    if (claimsError || !claimsData?.claims?.sub) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const callerId = claimsData.claims.sub;
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const [{ data: isAdmin }, { data: isManager }] = await Promise.all([
      serviceClient.rpc("has_role", { _user_id: callerId, _role: "admin" }),
      serviceClient.rpc("has_role", { _user_id: callerId, _role: "manager" }),
    ]);

    if (!isAdmin && !isManager) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const { sessionId } = await req.json();
    if (!sessionId) {
      return jsonResponse({ error: "sessionId is required" }, 400);
    }

    const { data: session, error: sessionError } = await serviceClient
      .from("live_sessions")
      .select("id, title, created_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!session) {
      return jsonResponse({ error: "Live session not found" }, 404);
    }

    const createdAtMin = new Date(new Date(session.created_at).getTime() - 60 * 60 * 1000).toISOString();
    const createdAtMax = new Date().toISOString();

    const shopifyOrders: Record<string, any>[] = [];
    let pageUrl = `https://${shopifyDomain}/admin/api/2025-01/orders.json?status=any&created_at_min=${encodeURIComponent(createdAtMin)}&created_at_max=${encodeURIComponent(createdAtMax)}&limit=250&fields=id,name,created_at,cancelled_at,cancel_reason,phone,email,tags,note_attributes,line_items,customer,shipping_address,billing_address`;

    for (let page = 0; page < 10; page++) {
      const response = await fetch(pageUrl, {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyToken,
        },
      });

      if (!response.ok) {
        throw new Error(`Shopify API error ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      shopifyOrders.push(...((data.orders || []) as Record<string, any>[]));

      const linkHeader = response.headers.get("Link");
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (match) {
          pageUrl = match[1];
          continue;
        }
      }

      break;
    }

    const relevantOrders = shopifyOrders
      .map((order) => toReviewOrder(order, sessionId))
      .filter((order): order is ReviewOrder => Boolean(order));

    const grouped = new Map<string, ReviewOrder[]>();
    for (const order of relevantOrders) {
      const identityKey = buildIdentityKey(order);
      if (!identityKey) continue;
      const groupKey = `${identityKey}::${order.lineSignature}`;
      const current = grouped.get(groupKey) || [];
      current.push(order);
      grouped.set(groupKey, current);
    }

    const groups = Array.from(grouped.entries())
      .map(([duplicateGroupKey, orders]) => {
        if (orders.length < 2) return null;
        const sortedOrders = [...orders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        const primaryOrder = sortedOrders.find((order) => !order.cancelledAt) || sortedOrders[0];
        const sample = primaryOrder;

        return {
          duplicateGroupKey,
          matchReason: "Mesmo cliente e mesma composição exata de itens.",
          customerName: sample.customerName,
          customerPhoneNormalized: sample.customerPhoneNormalized,
          customerEmailNormalized: sample.customerEmailNormalized,
          customerCpfNormalized: sample.customerCpfNormalized,
          lineSignature: sample.lineSignature,
          primaryOrderId: primaryOrder.shopifyOrderId,
          orders: sortedOrders.map((order) => ({
            ...order,
            isPrimary: order.shopifyOrderId === primaryOrder.shopifyOrderId,
            canCancel: !order.cancelledAt && order.shopifyOrderId !== primaryOrder.shopifyOrderId,
          })),
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.orders.length || 0) - (a?.orders.length || 0));

    return jsonResponse({
      groups,
      totalGroups: groups.length,
      totalOrdersConsidered: relevantOrders.length,
      liveSession: {
        id: session.id,
        title: session.title,
        createdAt: session.created_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error reviewing duplicate live Shopify orders:", message);
    return jsonResponse({ error: message }, 500);
  }
});