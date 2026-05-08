// Edge: nfce-poll-sefaz
// Cron a cada 10 min — consulta SEFAZ via BrasilNFe para notas pendentes/sent
// e atualiza o status. Rede de segurança caso o webhook não chegue.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRASILNFE_BASE = "https://api.brasilnfe.com.br/services";
const BATCH_LIMIT = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Notas pendentes há mais de 5 min, com chave preenchida
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: docs, error } = await supabase
      .from("fiscal_documents")
      .select("id, modelo, ambiente, chave_acesso, status, company_id, companies(brasilnfe_token, cnpj)")
      .in("status", ["pending", "pending_sefaz", "sent"])
      .not("chave_acesso", "is", null)
      .lt("updated_at", fiveMinAgo)
      .limit(BATCH_LIMIT);

    if (error) throw error;
    if (!docs?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let updated = 0, errors = 0;

    for (const doc of docs) {
      try {
        const company: any = doc.companies;
        if (!company?.brasilnfe_token) continue;

        const endpoint = doc.modelo === 65 ? "/nfce/consulta" : "/nfe/consulta";
        const tipoAmbiente = doc.ambiente === "producao" ? 1 : 2;

        const resp = await fetch(`${BRASILNFE_BASE}${endpoint}?chave=${doc.chave_acesso}&ambiente=${tipoAmbiente}`, {
          method: "GET",
          headers: { "Authorization": `Bearer ${company.brasilnfe_token}` },
        });
        const respBody = await resp.json().catch(() => ({}));

        const codigo = Number(respBody?.CodigoStatus || respBody?.cStat || 0);
        let newStatus: string | null = null;
        let extras: any = {};

        if (codigo === 100) { // Autorizada
          newStatus = "authorized";
          extras = {
            protocolo: respBody.Protocolo || respBody.NumeroProtocolo,
            data_autorizacao: respBody.DataAutorizacao || new Date().toISOString(),
            xml_url: respBody.XmlUrl || respBody.UrlXml,
            danfe_url: respBody.DanfeUrl || respBody.UrlDanfe,
          };
        } else if (codigo === 101 || codigo === 135) { // Cancelada
          newStatus = "cancelled";
        } else if (codigo === 110 || codigo === 301 || codigo === 302) { // Denegada
          newStatus = "denied";
          extras = { rejection_code: String(codigo), rejection_message: respBody.Mensagem || respBody.xMotivo };
        } else if (codigo >= 200 && codigo < 700) { // Rejeitada
          newStatus = "rejected";
          extras = { rejection_code: String(codigo), rejection_message: respBody.Mensagem || respBody.xMotivo };
        }
        // Outros: mantém pending_sefaz

        if (newStatus) {
          await supabase.from("fiscal_documents").update({
            status: newStatus,
            ...extras,
            brasilnfe_response: respBody,
          }).eq("id", doc.id);
          updated++;

          // Log em fiscal_webhook_events para auditoria
          await supabase.from("fiscal_webhook_events").insert({
            event_type: `poll-sefaz:${newStatus}`,
            chave_acesso: doc.chave_acesso,
            fiscal_document_id: doc.id,
            payload: respBody,
            processed: true,
          });
        } else {
          // bumpear updated_at para sair da janela imediata
          await supabase.from("fiscal_documents").update({
            updated_at: new Date().toISOString(),
          }).eq("id", doc.id);
        }
      } catch (e: any) {
        console.error(`poll error ${doc.id}:`, e.message);
        errors++;
      }
    }

    return new Response(JSON.stringify({ ok: true, scanned: docs.length, updated, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("nfce-poll-sefaz error:", e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
