import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    // Fetch order with customer data
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, customer:customers(*)")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      throw new Error(`Order not found: ${orderError?.message || "not found"}`);
    }

    // Calculate total with discount
    const products = order.products as Array<{ price: number; quantity: number; title: string }>;
    const subtotal = products.reduce((sum: number, p) => sum + p.price * p.quantity, 0);

    let discountAmount = 0;
    if (order.discount_type && order.discount_value) {
      discountAmount = order.discount_type === "percentage"
        ? subtotal * (order.discount_value / 100)
        : order.discount_value;
    }
    const totalAmount = Math.round(Math.max(0, subtotal - discountAmount) * 100) / 100;

    // Use payer data from request, or fallback to customer data
    const customer = order.customer as Record<string, unknown> | null;
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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error creating PIX payment:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
