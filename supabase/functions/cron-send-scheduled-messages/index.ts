import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch pending messages that are due
    const { data: pending, error: fetchError } = await supabase
      .from("scheduled_messages")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(50);

    if (fetchError) throw fetchError;
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing ${pending.length} scheduled messages`);
    let sentCount = 0;

    for (const msg of pending) {
      try {
        // Lock: set status to 'sending' to prevent duplicates
        const { error: lockErr } = await supabase
          .from("scheduled_messages")
          .update({ status: "sending" })
          .eq("id", msg.id)
          .eq("status", "pending");

        if (lockErr) {
          console.warn(`Lock failed for ${msg.id}:`, lockErr);
          continue;
        }

        // Resolve credentials
        let instanceId: string | undefined;
        let token: string | undefined;
        let clientToken: string | undefined;
        let provider = "zapi";

        if (msg.whatsapp_number_id) {
          const { data: numData } = await supabase
            .from("whatsapp_numbers")
            .select("zapi_instance_id, zapi_token, zapi_client_token, provider")
            .eq("id", msg.whatsapp_number_id)
            .single();

          if (numData?.provider === "meta") {
            provider = "meta";
          } else if (numData?.zapi_instance_id && numData?.zapi_token && numData?.zapi_client_token) {
            instanceId = numData.zapi_instance_id;
            token = numData.zapi_token;
            clientToken = numData.zapi_client_token;
          }
        }

        let sendSuccess = false;

        if (provider === "meta") {
          // Send via Meta WhatsApp API
          const res = await supabase.functions.invoke("meta-whatsapp-send", {
            body: { phone: msg.phone, message: msg.message, whatsapp_number_id: msg.whatsapp_number_id },
          });
          sendSuccess = !res.error;
          if (res.error) console.error(`Meta send failed for ${msg.id}:`, res.error);
        } else {
          // Fallback to env vars
          if (!instanceId || !token || !clientToken) {
            instanceId = Deno.env.get("ZAPI_INSTANCE_ID");
            token = Deno.env.get("ZAPI_TOKEN");
            clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN");
          }

          if (!instanceId || !token || !clientToken) {
            throw new Error("Z-API credentials not configured");
          }

          let formattedPhone = msg.phone.replace(/\D/g, "");
          if (!formattedPhone.startsWith("55")) formattedPhone = "55" + formattedPhone;

          const zapiUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;
          const response = await fetch(zapiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Client-Token": clientToken },
            body: JSON.stringify({ phone: formattedPhone, message: msg.message }),
          });

          sendSuccess = response.ok;
          if (!response.ok) {
            const errData = await response.text();
            console.error(`Z-API send failed for ${msg.id}:`, errData);
          } else {
            await response.text();
          }
        }

        if (sendSuccess) {
          // Save to whatsapp_messages so it appears in chat history
          await supabase.from("whatsapp_messages").insert({
            phone: msg.phone,
            message: msg.message,
            direction: "outgoing",
            status: "sent",
            whatsapp_number_id: msg.whatsapp_number_id,
          });

          await supabase
            .from("scheduled_messages")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", msg.id);

          sentCount++;
        } else {
          await supabase
            .from("scheduled_messages")
            .update({ status: "failed", error_message: "Send failed" })
            .eq("id", msg.id);
        }
      } catch (err) {
        console.error(`Error processing scheduled message ${msg.id}:`, err);
        await supabase
          .from("scheduled_messages")
          .update({ status: "failed", error_message: String(err) })
          .eq("id", msg.id);
      }
    }

    console.log(`Sent ${sentCount}/${pending.length} scheduled messages`);
    return new Response(JSON.stringify({ sent: sentCount, total: pending.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Cron scheduled messages error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
