import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyPaymentConfirmed } from "../_shared/payment-confirmed.ts";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

async function createShopifyOrder(
  order: Record<string, unknown>,
  customer: Record<string, unknown> | null,
) {
  const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

  if (!shopifyDomain || !shopifyToken) {
    console.log("Shopify credentials not configured, skipping order creation");
    return null;
  }

  const products = order.products as Array<{
    shopifyId: string;
    title: string;
    variant: string;
    price: number;
    quantity: number;
    sku?: string;
  }>;

  const lineItems = products.map((p) => {
    const variantIdMatch = p.shopifyId?.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
    if (variantIdMatch) {
      return { variant_id: parseInt(variantIdMatch[1]), quantity: p.quantity, price: p.price.toFixed(2) };
    }
    return { title: p.title, quantity: p.quantity, price: p.price.toFixed(2) };
  });

  let discountAmount = 0;
  const subtotal = products.reduce((sum, p) => sum + p.price * p.quantity, 0);
  if (order.discount_type && order.discount_value) {
    const dv = order.discount_value as number;
    discountAmount = order.discount_type === "percentage" ? subtotal * (dv / 100) : dv;
  }

  const shopifyOrder: Record<string, unknown> = {
    order: {
      line_items: lineItems,
      financial_status: "paid",
      note: `Pedido pago via PIX (Mercado Pago) - CRM Order #${(order.id as string).substring(0, 8)}`,
      tags: "pix,crm,mercadopago",
      ...(customer
        ? (() => {
            const customerObj: Record<string, unknown> = {
              customer: { first_name: (customer.instagram_handle as string) || "Cliente" },
            };
            const rawPhone = (customer.whatsapp as string) || "";
            if (rawPhone) {
              const digits = rawPhone.replace(/\D/g, "");
              if (digits.length >= 10) {
                customerObj.phone = digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
              }
            }
            return customerObj;
          })()
        : {}),
      ...(discountAmount > 0
        ? { discount_codes: [{ code: "CRM-DISCOUNT", amount: discountAmount.toFixed(2), type: "fixed_amount" }] }
        : {}),
    },
  };

  try {
    const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/orders.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken },
      body: JSON.stringify(shopifyOrder),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Shopify order creation failed:", error);
      return null;
    }

    const result = await response.json();
    console.log("Shopify order created:", result.order?.id);
    return result.order;
  } catch (error) {
    console.error("Shopify order creation error:", error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const { paymentId, orderId } = await req.json();

    if (!paymentId || !/^\d+$/.test(String(paymentId))) {
      return new Response(JSON.stringify({ error: "Invalid paymentId" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!accessToken) {
      throw new Error("MERCADOPAGO_ACCESS_TOKEN is not configured");
    }

    // Check payment status at Mercado Pago
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!mpResponse.ok) {
      throw new Error(`Mercado Pago API error: ${mpResponse.status}`);
    }

    const mpPayment = await mpResponse.json();
    const status = mpPayment.status; // pending, approved, rejected, etc.

    console.log(`PIX payment ${paymentId} status: ${status}`);

    // If approved, mark order as paid and create Shopify order
    if (status === "approved" && orderId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Try orders first
      const { data: existingOrder } = await supabase
        .from("orders")
        .select("is_paid")
        .eq("id", orderId)
        .single();

      if (existingOrder && !existingOrder.is_paid) {
        await supabase
          .from("orders")
          .update({
            is_paid: true,
            paid_at: new Date().toISOString(),
            stage: "paid",
          })
          .eq("id", orderId);

        console.log("Order marked as paid:", orderId);

        await notifyPaymentConfirmed({
          pedido_id: orderId,
          loja: 'centro',
          gateway: 'mercadopago',
          transaction_id: String(paymentId),
          source: 'mercadopago-check-payment',
        });

        const { data: fullOrder } = await supabase
          .from("orders")
          .select("*, customer:customers(*)")
          .eq("id", orderId)
          .maybeSingle();

        if (fullOrder) {
          await createShopifyOrder(fullOrder, fullOrder.customer);
        }
      } else if (!existingOrder) {
        // Fallback: try pos_sales
        const { data: sale } = await supabase
          .from("pos_sales")
          .select("*, store:pos_stores(name)")
          .eq("id", orderId)
          .single();

        if (sale && sale.status !== "paid" && sale.status !== "completed") {
          // Extract customer data from payment_details (saved by frontend before PIX generation)
          const pd = (sale.payment_details || {}) as Record<string, any>;
          const customerName = pd.customer_name || sale.customer_name || "";
          const customerPhone = (pd.customer_phone || sale.customer_phone || "").replace(/\D/g, "");
          const customerEmail = pd.customer_email || "";
          const customerCpf = (pd.customer_cpf || "").replace(/\D/g, "");

          // Upsert pos_customer if we have customer data
          let customerId: string | null = null;
          if (customerName || customerPhone) {
            // Try to find existing customer by CPF or phone
            if (customerCpf) {
              const { data: existing } = await supabase
                .from("pos_customers")
                .select("id")
                .eq("cpf", customerCpf)
                .maybeSingle();
              if (existing) customerId = existing.id;
            }
            if (!customerId && customerPhone) {
              const { data: existing } = await supabase
                .from("pos_customers")
                .select("id")
                .eq("whatsapp", customerPhone)
                .maybeSingle();
              if (existing) customerId = existing.id;
            }

            const customerPayload: Record<string, unknown> = {
              name: customerName,
              cpf: customerCpf || null,
              email: customerEmail || null,
              whatsapp: customerPhone || null,
              address: pd.customer_address || null,
              address_number: pd.customer_address_number || null,
              complement: pd.customer_complement || null,
              neighborhood: pd.customer_neighborhood || null,
              city: pd.customer_city || null,
              state: pd.customer_state || null,
              cep: (pd.customer_cep || "").replace(/\D/g, "") || null,
            };

            if (customerId) {
              await supabase.from("pos_customers").update(customerPayload).eq("id", customerId);
            } else {
              const { data: newCust } = await supabase
                .from("pos_customers")
                .insert(customerPayload)
                .select("id")
                .single();
              customerId = newCust?.id || null;
            }
          }

          // Update sale status
          await supabase
            .from("pos_sales")
            .update({
              status: "paid",
              paid_at: new Date().toISOString(),
              expedition_status: "pending",
              payment_gateway: "mercadopago",
              customer_id: customerId,
              notes: `💳 Pago via PIX Mercado Pago (${paymentId})`,
            })
            .eq("id", orderId);

          console.log("pos_sales marked as paid:", orderId, "customer_id:", customerId);

          // Log checkout attempt for PIX success
          await supabase.from("pos_checkout_attempts").insert({
            sale_id: orderId,
            store_id: sale.store_id,
            payment_method: "pix",
            status: "success",
            amount: sale.total ? Number(sale.total) : null,
            customer_name: customerName || null,
            customer_phone: customerPhone || null,
            customer_email: customerEmail || null,
            gateway: "mercadopago",
            transaction_id: String(paymentId),
          } as any).then(() => {});

          // Create Tiny order if we have items and store data
          try {
            const { data: items } = await supabase
              .from("pos_sale_items")
              .select("*")
              .eq("sale_id", orderId);

            if (items && items.length > 0) {
              const storeName = (sale.store as any)?.name || "Loja";
              await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/pos-tiny-create-sale`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  store_id: sale.store_id,
                  sale_id: orderId,
                  customer: {
                    name: customerName || "Cliente PIX",
                    cpf: customerCpf,
                    email: customerEmail,
                    whatsapp: customerPhone,
                    address: pd.customer_address || "",
                    addressNumber: pd.customer_address_number || "",
                    complement: pd.customer_complement || "",
                    neighborhood: pd.customer_neighborhood || "",
                    cep: (pd.customer_cep || "").replace(/\D/g, ""),
                    city: pd.customer_city || "",
                    state: pd.customer_state || "",
                  },
                  items: items.map((it: any) => ({
                    sku: it.sku || "",
                    name: it.product_name || "",
                    variant: it.variant_name || "",
                    quantity: it.quantity,
                    price: Number(it.unit_price),
                  })),
                  payment_method_name: "PIX Mercado Pago",
                  notes: `PIX Checkout Loja - ${storeName}`,
                }),
              });
              console.log("Tiny order creation triggered for pos_sale:", orderId);
            }
          } catch (tinyErr) {
            console.error("Tiny order creation failed:", tinyErr);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ status, paymentId }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error checking payment:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
