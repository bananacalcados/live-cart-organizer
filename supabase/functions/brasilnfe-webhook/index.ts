// Edge function: brasilnfe-webhook
// Recebe callbacks da BrasilNFe com mudanças de status de notas fiscais.
// PÚBLICA (verify_jwt = false). Identifica a nota por IdentificadorInterno (POS-<sale_id>) ou ChaveNF.
//
// Eventos esperados (BrasilNFe envia tipos variados, tratamos genericamente):
// - autorização, rejeição, cancelamento, denegação, inutilização
//
// URL pra colar no painel BrasilNFe:
//   https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/brasilnfe-webhook
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, service: "brasilnfe-webhook" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let payload: any = null;
  try {
    const raw = await req.text();

    // Validação HMAC-SHA256 do body
    const secret = Deno.env.get("BRASILNFE_WEBHOOK_SECRET");
    if (secret) {
      const sigHeader =
        req.headers.get("x-signature") ||
        req.headers.get("x-hub-signature-256") ||
        req.headers.get("x-brasilnfe-signature") ||
        req.headers.get("x-webhook-signature") ||
        req.headers.get("signature") ||
        "";
      const provided = sigHeader.replace(/^sha256=/i, "").trim().toLowerCase();

      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
      const expected = Array.from(new Uint8Array(sigBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (!provided || provided !== expected) {
        console.warn("[brasilnfe-webhook] Invalid signature", { provided, expectedPrefix: expected.slice(0, 8), headers: Object.fromEntries(req.headers) });
        await supabase.from("fiscal_webhook_events").insert({
          provider: "brasilnfe",
          event_type: "invalid_signature",
          payload: { raw: raw.slice(0, 2000), headers: Object.fromEntries(req.headers) },
          error_message: "Assinatura HMAC inválida",
          processed: true,
          processed_at: new Date().toISOString(),
        });
        return new Response(JSON.stringify({ ok: false, error: "invalid signature" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        });
      }
    }

    try { payload = JSON.parse(raw); } catch { payload = { raw }; }

    // Extrai campos comuns (BrasilNFe pode usar diferentes formatos)
    const ret = payload?.ReturnNF || payload || {};
    const chave =
      ret.ChaveNF || payload.ChaveNF || payload.chave_acesso || payload.chave || null;
    const ident =
      payload.IdentificadorInterno || ret.IdentificadorInterno || payload.identificador_interno || null;
    const eventType =
      payload.EventType || payload.event_type || payload.Evento || ret.DsStatusRespostaSefaz || "status_update";

    // Log do evento
    const { data: evt } = await supabase
      .from("fiscal_webhook_events")
      .insert({
        provider: "brasilnfe",
        event_type: String(eventType).slice(0, 200),
        chave_acesso: chave,
        identificador_interno: ident,
        payload,
      })
      .select()
      .single();

    // Localiza fiscal_document
    let doc: any = null;
    if (chave) {
      const { data } = await supabase
        .from("fiscal_documents")
        .select("*")
        .eq("chave_acesso", chave)
        .maybeSingle();
      doc = data;
    }
    if (!doc && ident && ident.startsWith("POS-")) {
      const saleId = ident.slice(4);
      const { data } = await supabase
        .from("fiscal_documents")
        .select("*")
        .eq("pos_sale_id", saleId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      doc = data;
    }

    if (!doc) {
      await supabase
        .from("fiscal_webhook_events")
        .update({ processed: true, processed_at: new Date().toISOString(), error_message: "Documento não encontrado" })
        .eq("id", evt.id);
      return new Response(JSON.stringify({ ok: true, matched: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determina novo status
    const ok = ret.Ok === true || ret.Ok === "true" || payload.status === "authorized";
    const cancelled =
      String(eventType).toLowerCase().includes("cancel") ||
      payload.status === "cancelled";
    const codStatus = ret.CodStatusRespostaSefaz ? Number(ret.CodStatusRespostaSefaz) : null;

    let newStatus = doc.status;
    const updates: Record<string, any> = {
      brasilnfe_response: payload,
      events: [...((doc.events as any[]) || []), { at: new Date().toISOString(), type: eventType, payload }],
    };

    if (cancelled) {
      newStatus = "cancelled";
      updates.cancelled_at = new Date().toISOString();
      updates.cancellation_protocol = ret.Protocolo || payload.Protocolo || null;
    } else if (ok || codStatus === 100) {
      newStatus = "authorized";
      updates.data_autorizacao = new Date().toISOString();
      updates.protocolo = ret.Protocolo || payload.Protocolo || doc.protocolo;
      updates.chave_acesso = chave || doc.chave_acesso;
    } else if (codStatus && codStatus !== 100) {
      newStatus = "rejected";
      updates.rejection_code = String(codStatus);
      updates.rejection_message = ret.DsStatusRespostaSefaz || null;
    }

    if (payload.XmlUrl || payload.xml_url) updates.xml_url = payload.XmlUrl || payload.xml_url;
    if (payload.DanfeUrl || payload.danfe_url) updates.danfe_url = payload.DanfeUrl || payload.danfe_url;
    if (payload.QrCodeUrl || payload.qrcode_url) updates.qrcode_url = payload.QrCodeUrl || payload.qrcode_url;

    updates.status = newStatus;

    await supabase.from("fiscal_documents").update(updates).eq("id", doc.id);
    await supabase
      .from("fiscal_webhook_events")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        fiscal_document_id: doc.id,
      })
      .eq("id", evt.id);

    return new Response(JSON.stringify({ ok: true, document_id: doc.id, new_status: newStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[brasilnfe-webhook]", err);
    // Loga o erro também
    try {
      await supabase.from("fiscal_webhook_events").insert({
        provider: "brasilnfe",
        event_type: "error",
        payload: payload || {},
        error_message: err.message,
      });
    } catch {}
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200, // 200 pra BrasilNFe não ficar reenviando
    });
  }
});
