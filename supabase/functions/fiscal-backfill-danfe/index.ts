// Backfill DANFE/XML for already-authorized fiscal_documents whose
// brasilnfe_response was stored but danfe_url / xml_content were not.
// Body: { document_id?: uuid, pos_sale_id?: uuid }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { document_id, pos_sale_id } = await req.json().catch(() => ({}));
    if (!document_id && !pos_sale_id) throw new Error("document_id ou pos_sale_id obrigatório");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let q = supabase
      .from("fiscal_documents")
      .select("id, chave_acesso, brasilnfe_response, status")
      .in("status", ["authorized", "autorizada", "autorizado"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (document_id) q = q.eq("id", document_id);
    else q = q.eq("pos_sale_id", pos_sale_id);

    const { data: doc, error } = await q.maybeSingle();
    if (error) throw error;
    if (!doc) throw new Error("Documento autorizado não encontrado");

    const resp: any = doc.brasilnfe_response || {};
    const updates: Record<string, any> = {};

    if (resp.Base64Xml) {
      try {
        const xmlBytes = Uint8Array.from(atob(resp.Base64Xml), c => c.charCodeAt(0));
        updates.xml_content = new TextDecoder("utf-8").decode(xmlBytes);
      } catch (e) { console.error("xml decode", e); }
    }

    if (resp.Base64File && doc.chave_acesso) {
      try {
        const pdfBytes = Uint8Array.from(atob(resp.Base64File), c => c.charCodeAt(0));
        const path = `danfe/${doc.chave_acesso}.pdf`;
        const { error: upErr } = await supabase.storage
          .from("fiscal-documents")
          .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
        if (!upErr) {
          const { data: pub } = supabase.storage.from("fiscal-documents").getPublicUrl(path);
          updates.danfe_url = pub?.publicUrl || null;
        } else {
          console.error("upload", upErr);
        }
      } catch (e) { console.error("pdf decode", e); }
    }

    if (Object.keys(updates).length) {
      await supabase.from("fiscal_documents").update(updates).eq("id", doc.id);
    }

    return new Response(JSON.stringify({ ok: true, document_id: doc.id, ...updates }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[fiscal-backfill-danfe]", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
