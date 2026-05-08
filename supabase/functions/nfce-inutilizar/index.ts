// Edge: nfce-inutilizar
// Inutiliza faixa de numeração de NFC-e/NF-e na SEFAZ via BrasilNFe.
// Body: { company_id, modelo, serie, numero_inicial, numero_final, justificativa, ambiente? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRASILNFE_BASE = "https://api.brasilnfe.com.br/services";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { company_id, modelo, serie, numero_inicial, numero_final, justificativa, ambiente: amb } = body;
    if (!company_id || !modelo || serie == null || !numero_inicial || !numero_final) {
      throw new Error("company_id, modelo, serie, numero_inicial e numero_final são obrigatórios");
    }
    const just = String(justificativa || "").trim();
    if (just.length < 15 || just.length > 255) {
      throw new Error("Justificativa deve ter entre 15 e 255 caracteres");
    }
    if (Number(numero_final) < Number(numero_inicial)) {
      throw new Error("numero_final deve ser >= numero_inicial");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: company } = await supabase.from("companies").select("*").eq("id", company_id).single();
    if (!company) throw new Error("Empresa não encontrada");
    if (!company.brasilnfe_token) throw new Error("Empresa sem token BrasilNFe");

    const ambiente = amb || company.ambiente_nfe || "homologacao";
    const tipoAmbiente = ambiente === "producao" ? 1 : 2;
    const ano = new Date().getFullYear();

    const endpoint = Number(modelo) === 65 ? "/nfce/inutilizar" : "/nfe/inutilizar";

    const payload = {
      TipoAmbiente: String(tipoAmbiente),
      Cnpj: (company.cnpj || "").replace(/\D/g, ""),
      Ano: ano,
      Modelo: Number(modelo),
      Serie: Number(serie),
      NumeroInicial: Number(numero_inicial),
      NumeroFinal: Number(numero_final),
      Justificativa: just,
    };

    // Cria registro em pending
    const { data: row, error: insErr } = await supabase.from("fiscal_inutilizations").insert({
      company_id, modelo, serie,
      numero_inicial, numero_final, ano, ambiente,
      justificativa: just,
      status: "pending",
      brasilnfe_request: payload,
    }).select().single();
    if (insErr) throw new Error(`Erro ao registrar: ${insErr.message}`);

    const resp = await fetch(`${BRASILNFE_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${company.brasilnfe_token}`,
      },
      body: JSON.stringify(payload),
    });
    const respBody = await resp.json().catch(() => ({}));

    const ok = resp.ok && (respBody?.Sucesso === true || respBody?.CodigoStatus === 102);

    await supabase.from("fiscal_inutilizations").update({
      status: ok ? "approved" : "rejected",
      protocolo: respBody?.Protocolo || respBody?.NumeroProtocolo || null,
      xml_content: respBody?.Xml || null,
      rejection_message: ok ? null : (respBody?.Mensagem || respBody?.Erro || JSON.stringify(respBody).slice(0, 500)),
      brasilnfe_response: respBody,
    }).eq("id", row.id);

    return new Response(JSON.stringify({ ok, id: row.id, response: respBody }), {
      status: ok ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("nfce-inutilizar error:", e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
