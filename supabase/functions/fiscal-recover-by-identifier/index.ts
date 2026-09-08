// deno-lint-ignore-file no-explicit-any
// Edge: fiscal-recover-by-identifier
// Quando a BrasilNFe responde "Já foi emitida uma nota fiscal com o identificador
// interno X", significa que a nota EXISTE lá, mas o nosso registro se perdeu
// (timeout na emissão, retry que apagou o doc, etc). Esta função consulta a
// BrasilNFe pelo IdentificadorInterno, baixa XML + DANFE e grava/atualiza o
// fiscal_documents como "authorized" — sem emitir nada novo.
//
// Body: { sale_id?: string, order_id?: string, identifier?: string, company_id?: string, modelo?: 55|65 }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { persistFiscalFiles } from "../_shared/fiscal-persist-files.ts";
import { isAuthorizedCron } from "../_shared/cron-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BRASILNFE_BASE = "https://api.brasilnfe.com.br/services";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Autorização: service role / cron secret (chamada interna) ou usuário logado.
  if (!(await isAuthorizedCron(req))) {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = jwt ? await supabase.auth.getUser(jwt) : { data: null as any };
    if (!data?.user) return json({ error: "unauthorized" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const saleId: string | null = body.sale_id || null;
    const orderId: string | null = body.order_id || null;
    const modeloFilter: number | null = body.modelo ? Number(body.modelo) : null;

    // Identificadores possíveis para a venda/pedido.
    const identifiers: string[] = [];
    if (body.identifier) identifiers.push(String(body.identifier));
    if (saleId) identifiers.push(`NFE-POS-${saleId}`, `POS-${saleId}`);
    if (orderId) identifiers.push(`NFE-${orderId}`, `ORDER-${orderId}`);
    if (!identifiers.length) return json({ error: "sale_id, order_id ou identifier obrigatório" }, 400);

    // Empresa: a do último doc rejeitado desta venda, ou a informada.
    let companyId: string | null = body.company_id || null;
    let ambiente = "producao";
    let refDocs: any[] = [];
    {
      let q = supabase.from("fiscal_documents")
        .select("id, company_id, ambiente, modelo, status, created_at, nome_destinatario, cpf_destinatario, valor_total")
        .order("created_at", { ascending: false });
      if (saleId) q = q.eq("pos_sale_id", saleId);
      else if (orderId) q = q.eq("order_id", orderId);
      else q = q.limit(0);
      const { data } = await q;
      refDocs = data || [];
      if (!companyId && refDocs[0]) companyId = refDocs[0].company_id;
      if (refDocs[0]?.ambiente) ambiente = refDocs[0].ambiente;
    }
    if (!companyId) return json({ error: "company_id não identificado" }, 400);

    const { data: company } = await supabase.from("companies")
      .select("id, brasilnfe_token, cnpj").eq("id", companyId).maybeSingle();
    if (!company?.brasilnfe_token) return json({ error: "Empresa sem token BrasilNFe" }, 400);

    // Janela de busca: da criação da venda (ou 120 dias) até agora.
    let dtInicio = new Date(Date.now() - 120 * 24 * 3600 * 1000);
    if (saleId) {
      const { data: sale } = await supabase.from("pos_sales").select("created_at").eq("id", saleId).maybeSingle();
      if (sale?.created_at) dtInicio = new Date(new Date(sale.created_at).getTime() - 24 * 3600 * 1000);
    }
    const tipoAmbiente = ambiente === "producao" ? 1 : 2;

    const found: any[] = [];
    for (const ident of identifiers) {
      const r = await fetch(`${BRASILNFE_BASE}/fiscal/ObterNotasFiscais`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Token": company.brasilnfe_token },
        body: JSON.stringify({
          TipoAmbiente: tipoAmbiente,
          TipoDocumentoFiscal: 1,
          DtInicio: dtInicio.toISOString(),
          DtFim: new Date(Date.now() + 3600 * 1000).toISOString(),
          IdentificadorInterno: ident,
        }),
        signal: AbortSignal.timeout(70000),
      }).catch((e) => { console.error("[fiscal-recover] ObterNotasFiscais", ident, e?.message); return null; });
      if (!r) continue;
      const d = await r.json().catch(() => ({}));
      const notas: any[] = Array.isArray(d?.Notas) ? d.Notas : [];
      for (const n of notas) {
        if (String(n.IdentificadorInterno || "") !== ident) continue;
        if (modeloFilter && Number(n.ModeloDocumento) !== modeloFilter) continue;
        found.push({ ...n, _ident: ident });
      }
      console.log(`[fiscal-recover] ${ident}: ${notas.length} nota(s) na BrasilNFe`, d?.Error || "");
    }

    if (!found.length) return json({ ok: false, recovered: 0, message: "Nenhuma nota encontrada na BrasilNFe com esse identificador." });

    const recovered: any[] = [];
    for (const n of found) {
      const chave = String(n.Chave || n.ChaveNF || "");
      if (!chave) continue;
      const modelo = Number(n.ModeloDocumento || (chave.slice(20, 22) === "65" ? 65 : 55));

      // Já temos este doc autorizado? então só garante que está tudo certo.
      const { data: existing } = await supabase.from("fiscal_documents")
        .select("id, status").eq("chave_acesso", chave).maybeSingle();

      // Baixa XML e PDF/HTML.
      const getFile = async (fileType: 1 | 2) => {
        try {
          const r = await fetch(`${BRASILNFE_BASE}/fiscal/ObterArquivoNotaFiscal`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Token": company.brasilnfe_token },
            body: JSON.stringify({ ChaveNF: chave, FileType: fileType, TipoDocumentoFiscal: 1 }),
            signal: AbortSignal.timeout(30000),
          });
          const txt = await r.text();
          if (!r.ok) return null;
          // Pode vir como string base64 pura (com aspas) ou objeto.
          try {
            const j = JSON.parse(txt);
            if (typeof j === "string") return j;
            return j?.Base64File || j?.Base64Xml || j?.Arquivo || j?.arquivo || null;
          } catch { return txt.replace(/^"|"$/g, ""); }
        } catch (e) { console.error("[fiscal-recover] file", fileType, e); return null; }
      };
      const [b64Xml, b64Pdf] = await Promise.all([getFile(1), getFile(2)]);
      const files = await persistFiscalFiles(supabase, { Base64Xml: b64Xml, Base64File: b64Pdf }, chave);

      // Status 1 = autorizada (conforme doc); qualquer outro mantemos "authorized" só se houver protocolo.
      const protocolo = n.NumeroProtocolo || n.Protocolo || null;
      const cancelled = Number(n.Status) === 2 || Number(n.Status) === 3;
      const status = cancelled ? "cancelled" : "authorized";

      const patch: Record<string, unknown> = {
        status,
        chave_acesso: chave,
        protocolo,
        numero: n.Numero ? Number(n.Numero) : null,
        serie: n.Serie ? Number(n.Serie) : 1,
        modelo,
        data_autorizacao: n.DtRecebimento || n.DtEmissao || new Date().toISOString(),
        rejection_code: null,
        rejection_message: null,
        contingencia_motivo: null,
        next_retry_at: null,
        brasilnfe_response: { recovered_from: "ObterNotasFiscais", nota: n },
        ...(files.xml_content ? { xml_content: files.xml_content } : {}),
        ...(files.danfe_url ? { danfe_url: files.danfe_url } : {}),
      };

      let docId: string;
      if (existing?.id) {
        await supabase.from("fiscal_documents").update(patch).eq("id", existing.id);
        docId = existing.id;
      } else {
        // Reaproveita o doc rejeitado mais recente do mesmo modelo (vira o autorizado).
        const target = refDocs.find((d) => Number(d.modelo) === modelo && d.status !== "authorized");
        if (target) {
          await supabase.from("fiscal_documents").update(patch).eq("id", target.id);
          docId = target.id;
        } else {
          const { data: ins, error } = await supabase.from("fiscal_documents").insert({
            company_id: companyId, pos_sale_id: saleId, order_id: orderId, ambiente,
            nome_destinatario: n.NomeDestinatario || refDocs[0]?.nome_destinatario || null,
            cpf_destinatario: refDocs[0]?.cpf_destinatario || null,
            valor_total: n.Valor ?? refDocs[0]?.valor_total ?? null,
            ...patch,
          }).select("id").single();
          if (error) throw error;
          docId = ins.id;
        }
      }

      // Limpa os outros docs rejeitados do mesmo modelo/venda (ruído na tela).
      const others = refDocs.filter((d) => Number(d.modelo) === modelo && d.id !== docId && d.status === "rejected");
      if (others.length) {
        await supabase.from("fiscal_documents").delete().in("id", others.map((d) => d.id));
      }

      recovered.push({ document_id: docId, modelo, numero: patch.numero, chave, status, danfe_url: files.danfe_url || null, has_xml: !!files.xml_content });
    }

    return json({ ok: recovered.length > 0, recovered: recovered.length, documents: recovered });
  } catch (e: any) {
    console.error("[fiscal-recover]", e);
    return json({ error: e?.message || "internal_error" }, 500);
  }
});
