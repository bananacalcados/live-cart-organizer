// Edge: nfce-cancelar
// Cancela NFC-e (modelo 65) ou NF-e (modelo 55) já autorizada na SEFAZ via BrasilNFe.
// Body: { fiscal_document_id: uuid, justificativa: string (15-255 chars) }
//
// Prazos legais SEFAZ:
//  - NFC-e (modelo 65): 30 minutos após autorização
//  - NF-e  (modelo 55): 24 horas após autorização
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRASILNFE_BASE = "https://api.brasilnfe.com.br/services";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { fiscal_document_id, justificativa } = await req.json();
    if (!fiscal_document_id) throw new Error("fiscal_document_id obrigatório");
    const just = String(justificativa || "").trim();
    if (just.length < 15 || just.length > 255) {
      throw new Error("Justificativa deve ter entre 15 e 255 caracteres (exigência SEFAZ)");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: doc, error: docErr } = await supabase
      .from("fiscal_documents")
      .select("*, companies(*)")
      .eq("id", fiscal_document_id)
      .single();
    if (docErr || !doc) throw new Error(`Documento fiscal não encontrado: ${docErr?.message}`);

    if (doc.status !== "authorized") {
      throw new Error(`Apenas notas autorizadas podem ser canceladas (status atual: ${doc.status})`);
    }
    if (!doc.chave_acesso) throw new Error("Documento sem chave de acesso");

    // Valida prazo legal
    const autorizadaEm = doc.data_autorizacao ? new Date(doc.data_autorizacao).getTime() : 0;
    const agora = Date.now();
    const minutosPassados = Math.floor((agora - autorizadaEm) / 60000);
    const limiteMin = doc.modelo === 65 ? 30 : 24 * 60;
    if (autorizadaEm && minutosPassados > limiteMin) {
      throw new Error(`Prazo de cancelamento expirado (${minutosPassados}min vs limite ${limiteMin}min). Modelo ${doc.modelo}.`);
    }

    const company: any = doc.companies;
    if (!company?.brasilnfe_token) throw new Error("Empresa sem token BrasilNFe");

    const tipoAmbiente = doc.ambiente === "producao" ? 1 : 2;
    const endpoint = doc.modelo === 65 ? "/nfce/cancelar" : "/nfe/cancelar";

    const payload = {
      TipoAmbiente: String(tipoAmbiente),
      ChaveAcesso: doc.chave_acesso,
      Justificativa: just,
      CnpjEmissor: (company.cnpj || "").replace(/\D/g, ""),
    };

    const resp = await fetch(`${BRASILNFE_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${company.brasilnfe_token}`,
      },
      body: JSON.stringify(payload),
    });
    const respBody = await resp.json().catch(() => ({}));

    const ok = resp.ok && (respBody?.Sucesso === true || respBody?.Status === "cancelado" || respBody?.CodigoStatus === 135 || respBody?.CodigoStatus === 101);

    if (ok) {
      await supabase.from("fiscal_documents").update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: just,
        cancellation_protocol: respBody?.Protocolo || respBody?.NumeroProtocolo || null,
        cancellation_xml: respBody?.Xml || respBody?.XmlEvento || null,
      }).eq("id", fiscal_document_id);

      return new Response(JSON.stringify({ ok: true, protocolo: respBody?.Protocolo, response: respBody }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Falha — registra mensagem mas não marca como cancelada
    return new Response(JSON.stringify({
      ok: false,
      error: respBody?.Mensagem || respBody?.Erro || "Falha no cancelamento",
      response: respBody,
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("nfce-cancelar error:", e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
