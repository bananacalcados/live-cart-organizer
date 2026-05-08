// Edge function: nfe-puxar-destinadas
// Consulta NF-e em que o CNPJ é destinatário (NFeDistribuicaoDFe via BrasilNFe)
// e popula public.nfe_received. Pode rodar manual (POST {company_id}) ou via cron (sem body = todas as empresas ativas).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRASILNFE_BASE = "https://api.brasilnfe.com.br/services";

const digits = (s: any) => String(s ?? "").replace(/\D/g, "");

function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, "i"));
  return m ? m[1] : null;
}

async function processCompany(supabase: any, company: any) {
  const token = company.brasilnfe_token;
  if (!token) return { company_id: company.id, skipped: "sem token" };

  // estado de NSU
  const { data: state } = await supabase
    .from("nfe_distribuicao_state")
    .select("ultimo_nsu")
    .eq("company_id", company.id)
    .maybeSingle();

  let ultimoNSU = state?.ultimo_nsu ?? "0";
  let inseridos = 0;
  let lastError: string | null = null;
  let loops = 0;

  while (loops < 20) {
    loops++;
    let resp: Response;
    try {
      resp = await fetch(`${BRASILNFE_BASE}/Fiscal/ConsultarDestinadas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          CNPJ: digits(company.cnpj),
          UltimoNSU: ultimoNSU,
          TipoAmbiente: company.ambiente_nfe === "producao" ? "1" : "2",
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      lastError = `network: ${(e as Error).message}`;
      break;
    }

    const text = await resp.text();
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

    if (!resp.ok) {
      lastError = `http ${resp.status}: ${text.slice(0, 200)}`;
      break;
    }

    const docs: any[] = payload.Documentos || payload.documentos || payload.docs || [];
    const maxNSU: string = payload.MaxNSU || payload.maxNSU || ultimoNSU;
    const novoUltimoNSU: string = payload.UltimoNSU || payload.ultimoNSU || maxNSU;

    for (const d of docs) {
      const chave: string = d.ChaveAcesso || d.chave || extractTag(d.XmlResumo || "", "chNFe") || "";
      if (!chave) continue;

      const xmlResumo: string = d.XmlResumo || d.xmlResumo || "";
      const numero = parseInt(d.Numero || extractTag(xmlResumo, "nNF") || "0", 10) || null;
      const serie = parseInt(d.Serie || extractTag(xmlResumo, "serie") || "0", 10) || null;
      const emitenteCnpj = digits(d.CNPJEmitente || extractTag(xmlResumo, "CNPJ") || "");
      const emitenteNome = d.NomeEmitente || extractTag(xmlResumo, "xNome") || null;
      const emitenteUf = d.UFEmitente || null;
      const valorTotal = parseFloat(d.ValorTotal || extractTag(xmlResumo, "vNF") || "0") || null;
      const dataEmissao = d.DataEmissao || extractTag(xmlResumo, "dhEmi") || null;

      const row = {
        company_id: company.id,
        chave_acesso: chave,
        numero,
        serie,
        modelo: 55,
        emitente_cnpj: emitenteCnpj,
        emitente_nome: emitenteNome,
        emitente_uf: emitenteUf,
        destinatario_cnpj: digits(company.cnpj),
        valor_total: valorTotal,
        data_emissao: dataEmissao,
        nsu: d.NSU || d.nsu || null,
        xml_resumo_content: xmlResumo || null,
        brasilnfe_response: d,
      };

      const { error } = await supabase
        .from("nfe_received")
        .upsert(row, { onConflict: "chave_acesso", ignoreDuplicates: false });
      if (!error) inseridos++;
    }

    ultimoNSU = novoUltimoNSU;
    await supabase.from("nfe_distribuicao_state").upsert({
      company_id: company.id,
      ultimo_nsu: ultimoNSU,
      max_nsu: maxNSU,
      last_sync_at: new Date().toISOString(),
      last_error: null,
    });

    // se MaxNSU == UltimoNSU, acabou
    if (!docs.length || ultimoNSU === maxNSU) break;
  }

  if (lastError) {
    await supabase.from("nfe_distribuicao_state").upsert({
      company_id: company.id,
      ultimo_nsu: ultimoNSU,
      last_error: lastError,
    });
  }

  return { company_id: company.id, inseridos, ultimoNSU, error: lastError };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let company_id: string | null = null;
    if (req.method === "POST") {
      try { ({ company_id } = await req.json()); } catch { /* cron sem body */ }
    }

    let q = supabase.from("companies").select("id, cnpj, ambiente_nfe, brasilnfe_token").eq("is_active", true);
    if (company_id) q = q.eq("id", company_id);
    const { data: companies, error } = await q;
    if (error) throw error;

    const results = [];
    for (const c of companies || []) {
      results.push(await processCompany(supabase, c));
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
