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
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const { orderId, payer } = await req.json();

    if (!orderId) {
      throw new Error("orderId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");

    if (!accessToken) {
      throw new Error("MERCADOPAGO_ACCESS_TOKEN is not configured");
    }

    // Fetch order — try CRM orders first, then pos_sales
    let products: Array<{ price: number; quantity: number; title: string }> = [];
    let discountType: string | null = null;
    let discountValue: number | null = null;
    let customer: Record<string, unknown> | null = null;
    let shippingAmount = 0;

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, customer:customers(*)")
      .eq("id", orderId)
      .maybeSingle();

    if (order) {
      products = order.products as Array<{ price: number; quantity: number; title: string }>;
      discountType = order.discount_type;
      discountValue = order.discount_value;
      customer = order.customer as Record<string, unknown> | null;
      shippingAmount = order.free_shipping ? 0 : Number(order.shipping_cost || 0);
    } else {
      // Fallback: try pos_sales
      const { data: sale, error: saleError } = await supabase
        .from("pos_sales")
        .select("*")
        .eq("id", orderId)
        .maybeSingle();

      if (saleError || !sale) {
        throw new Error(`Order not found in orders or pos_sales: ${orderError?.message || saleError?.message || "not found"}`);
      }

      // Fetch sale items
      const { data: items } = await supabase
        .from("pos_sale_items")
        .select("*")
        .eq("sale_id", sale.id);

      products = (items || []).map((it: any) => ({
        title: it.product_name + (it.variant_name ? ` - ${it.variant_name}` : ""),
        price: Number(it.unit_price),
        quantity: it.quantity,
      }));

      discountType = sale.discount ? "fixed" : null;
      discountValue = sale.discount ? Number(sale.discount) : null;
      
      // Extract shipping from payment_details
      const pd = sale.payment_details as Record<string, unknown> | null;
      if (pd && typeof pd === "object" && pd.shipping_amount) {
        shippingAmount = Number(pd.shipping_amount) || 0;
      }
      
      console.log(`Using pos_sales fallback for PIX, sale ${orderId}, ${products.length} items, shipping: ${shippingAmount}`);
    }

    // Calculate total with discount + shipping
    const subtotal = products.reduce((sum: number, p) => sum + p.price * p.quantity, 0);

    let discountAmount = 0;
    if (discountType && discountValue) {
      discountAmount = discountType === "percentage"
        ? subtotal * (discountValue / 100)
        : discountValue;
    }
    const totalAmount = Math.round(Math.max(0, subtotal - discountAmount + shippingAmount) * 100) / 100;

    // Use payer data from request, or fallback to customer data
    const payerEmail = payer?.email || 
      ((customer?.whatsapp as string) 
        ? `${(customer.whatsapp as string).replace(/\D/g, "")}@pix.mercadopago.com`
        : "customer@email.com");

    const payerFirstName = payer?.firstName || (customer?.instagram_handle as string) || "Cliente";
    const payerLastName = payer?.lastName || "";
    const payerCpf = payer?.cpf?.replace(/\D/g, "") || undefined;

    // Validate CPF: must be exactly 11 digits and not all same digit
    const isValidCpf = (cpf: string): boolean => {
      if (cpf.length !== 11) return false;
      if (/^(\d)\1{10}$/.test(cpf)) return false; // all same digits
      // Validate check digits
      let sum = 0;
      for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
      let check = 11 - (sum % 11);
      if (check >= 10) check = 0;
      if (check !== parseInt(cpf[9])) return false;
      sum = 0;
      for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
      check = 11 - (sum % 11);
      if (check >= 10) check = 0;
      if (check !== parseInt(cpf[10])) return false;
      return true;
    };

    // Build payer object
    const payerObj: Record<string, unknown> = {
      email: payerEmail,
      first_name: payerFirstName,
      last_name: payerLastName,
    };

    // Only add CPF if valid
    if (payerCpf && isValidCpf(payerCpf)) {
      payerObj.identification = {
        type: "CPF",
        number: payerCpf,
      };
    } else if (payerCpf) {
      console.log("Invalid CPF provided, skipping identification:", payerCpf);
    }

    // Add address if provided
    if (payer?.address) {
      payerObj.address = {
        zip_code: payer.address.zipCode?.replace(/\D/g, "") || undefined,
        street_name: payer.address.street || undefined,
        street_number: payer.address.number || undefined,
        neighborhood: payer.address.neighborhood || undefined,
        city: payer.address.city || undefined,
        federal_unit: payer.address.state || undefined,
      };
    }

    // Create PIX payment via Mercado Pago API
    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Idempotency-Key": `pix-${orderId}-${Date.now()}`,
      },
      body: JSON.stringify({
        transaction_amount: totalAmount,
        description: `Pedido #${orderId.substring(0, 8)}`,
        payment_method_id: "pix",
        payer: payerObj,
        notification_url: `${supabaseUrl}/functions/v1/payment-webhook?gateway=mercadopago`,
      }),
    });

    if (!mpResponse.ok) {
      const errorText = await mpResponse.text();
      console.error("Mercado Pago error:", mpResponse.status, errorText);
      throw new Error(`Mercado Pago error: ${mpResponse.status} - ${errorText}`);
    }

    const mpPayment = await mpResponse.json();
    console.log("Mercado Pago PIX created:", mpPayment.id, "status:", mpPayment.status);

    const pixData = mpPayment.point_of_interaction?.transaction_data;

    // Save mercadopago_payment_id to orders or pos_sales
    const mpId = String(mpPayment.id);
    const { data: orderCheck } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
    if (orderCheck) {
      await supabase.from("orders").update({ mercadopago_payment_id: mpId }).eq("id", orderId);
      console.log(`[mercadopago] Vinculado mercadopago_payment_id=${mpId} ao pedido ${orderId}`);
    } else {
      await supabase.from("pos_sales").update({ mercadopago_payment_id: mpId } as any).eq("id", orderId);
      console.log(`[mercadopago] Vinculado mercadopago_payment_id=${mpId} ao pedido ${orderId}`);
    }

    return new Response(
      JSON.stringify({
        paymentId: mpPayment.id,
        status: mpPayment.status,
        qrCode: pixData?.qr_code || null,
        qrCodeBase64: pixData?.qr_code_base64 || null,
        ticketUrl: pixData?.ticket_url || null,
        expirationDate: mpPayment.date_of_expiration || null,
        amount: totalAmount.toFixed(2),
      }),
      {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error creating PIX payment:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      }
    );
  }
});
