// Edge function: nfce-emitir
// Monta payload NFC-e (modelo 65), chama BrasilNFe e persiste em fiscal_documents.
// Body: { sale_id: uuid, ambiente?: 'homologacao'|'producao' }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRASILNFE_BASE = "https://api.brasilnfe.com.br/services";

function digits(s: string | null | undefined) { return (s || "").replace(/\D/g, ""); }
function round2(n: number) { return Math.round(n * 100) / 100; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { sale_id, ambiente: forcedAmb } = await req.json();
    if (!sale_id) throw new Error("sale_id obrigatório");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Carrega venda + itens + loja + cliente
    const { data: sale, error: saleErr } = await supabase
      .from("pos_sales")
      .select("*, pos_sale_items(*), pos_customers(*)")
      .eq("id", sale_id).single();
    if (saleErr || !sale) throw new Error(`Venda não encontrada: ${saleErr?.message}`);

    if (sale.status === "cancelled") throw new Error("Venda cancelada");
    const items = sale.pos_sale_items || [];
    if (!items.length) throw new Error("Venda sem itens");

    // 2. Resolve company a partir da store
    const { data: store } = await supabase.from("pos_stores").select("*, company_id").eq("id", sale.store_id).single();
    const companyId = (store as any)?.company_id;
    if (!companyId) throw new Error("Loja sem company_id vinculado (Fase 1A)");

    const { data: company } = await supabase.from("companies").select("*").eq("id", companyId).single();
    if (!company) throw new Error("Empresa não encontrada");
    if (!company.brasilnfe_token) throw new Error("Empresa sem token BrasilNFe (Fase 1C)");

    const ambiente = forcedAmb || company.ambiente_nfe || "homologacao";
    const tipoAmbiente = ambiente === "producao" ? 1 : 2;

    // 3. Monta itens com snapshot fiscal (resolve_fiscal_rule)
    const ufOrigem: string = company.uf || "MG";
    const cpfDest = digits(sale.customer_cpf || (sale.pos_customers as any)?.cpf);
    if (!cpfDest || cpfDest.length !== 11) throw new Error("NFC-e exige CPF válido do destinatário");

    const ufDestino = (sale.shipping_state || ufOrigem).toUpperCase();
    const produtos: any[] = [];
    let totalProd = 0;

    for (const [idx, it] of items.entries()) {
      // pega NCM do produto
      const { data: prod } = await supabase
        .from("pos_products").select("ncm, origem, cest, unidade").eq("id", it.tiny_product_id).maybeSingle();
      const ncm = (prod as any)?.ncm || it.ncm_snapshot;
      if (!ncm) throw new Error(`Produto ${it.product_name} sem NCM`);

      const { data: rule, error: rErr } = await supabase.rpc("resolve_fiscal_rule", {
        p_ncm: ncm, p_uf_origem: ufOrigem, p_uf_destino: ufDestino, p_tipo_operacao: "venda",
      });
      if (rErr || !rule) throw new Error(`Regra fiscal não encontrada para NCM ${ncm}: ${rErr?.message}`);

      const r: any = rule;
      const vTotal = round2(Number(it.unit_price) * Number(it.quantity));
      totalProd += vTotal;

      // grava snapshot
      await supabase.from("pos_sale_items").update({
        ncm_snapshot: ncm,
        cfop_snapshot: r.cfop,
        cst_icms: r.cst_icms,
        csosn_icms: r.csosn_icms,
        aliq_icms: r.aliq_icms,
        cst_pis: r.cst_pis, aliq_pis: r.aliq_pis,
        cst_cofins: r.cst_cofins, aliq_cofins: r.aliq_cofins,
        origem_mercadoria: r.origem_mercadoria,
        cest_snapshot: (prod as any)?.cest || null,
        unidade_comercial: (prod as any)?.unidade || "PC",
      }).eq("id", it.id);

      produtos.push({
        Codigo: it.sku || it.id,
        Descricao: it.product_name,
        NCM: ncm,
        CFOP: r.cfop,
        Unidade: (prod as any)?.unidade || "PC",
        Quantidade: it.quantity,
        ValorUnitario: round2(Number(it.unit_price)),
        ValorTotal: vTotal,
        Origem: r.origem_mercadoria,
        ICMS: { CSOSN: r.csosn_icms, CST: r.cst_icms, Aliquota: r.aliq_icms },
        PIS: { CST: r.cst_pis, Aliquota: r.aliq_pis },
        COFINS: { CST: r.cst_cofins, Aliquota: r.aliq_cofins },
      });
    }

    // 4. Reserva próximo número
    const { data: numData, error: nErr } = await supabase.rpc("get_next_fiscal_number", {
      p_company_id: companyId, p_modelo: 65, p_serie: 1, p_ambiente: ambiente,
    });
    if (nErr) throw new Error(`Numeração: ${nErr.message}`);
    const nfNumero = numData?.[0]?.next_number;
    if (!nfNumero) throw new Error("Não foi possível reservar numeração");

    // 5. Cria registro pendente
    const { data: doc, error: dErr } = await supabase.from("fiscal_documents").insert({
      company_id: companyId, pos_sale_id: sale_id, modelo: 65, serie: 1,
      numero: nfNumero, ambiente, status: "pending",
      valor_total: totalProd, cpf_destinatario: cpfDest,
      nome_destinatario: sale.customer_name || (sale.pos_customers as any)?.name || "CONSUMIDOR",
    }).select().single();
    if (dErr) throw new Error(`Insert fiscal_documents: ${dErr.message}`);

    // 6. Monta payload BrasilNFe
    const payload = {
      TipoAmbiente: tipoAmbiente,
      NotaFiscal: {
        Modelo: 65, Serie: 1, Numero: nfNumero,
        NaturezaOperacao: "Venda",
        DataEmissao: new Date().toISOString(),
        Emitente: { CNPJ: digits(company.cnpj), UF: ufOrigem },
        Destinatario: {
          CPF: cpfDest,
          Nome: sale.customer_name || (sale.pos_customers as any)?.name || "CONSUMIDOR",
        },
        Produtos: produtos,
        Pagamentos: [{ Forma: sale.payment_method || "01", Valor: totalProd }],
        ValorTotal: totalProd,
      },
    };

    await supabase.from("fiscal_documents").update({ brasilnfe_request: payload }).eq("id", doc.id);

    // 7. Chama BrasilNFe
    const resp = await fetch(`${BRASILNFE_BASE}/Fiscal/EnviarNotaFiscal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Token": company.brasilnfe_token },
      body: JSON.stringify(payload),
    });
    const respText = await resp.text();
    let respJson: any = null;
    try { respJson = JSON.parse(respText); } catch { respJson = { raw: respText }; }

    const ok = resp.ok && (respJson?.Status === "Autorizada" || respJson?.ChaveAcesso || respJson?.chave_acesso);
    const chave = respJson?.ChaveAcesso || respJson?.chave_acesso || null;
    const protocolo = respJson?.Protocolo || respJson?.protocolo || null;

    await supabase.from("fiscal_documents").update({
      status: ok ? "authorized" : "rejected",
      chave_acesso: chave, protocolo,
      data_autorizacao: ok ? new Date().toISOString() : null,
      xml_url: respJson?.XmlUrl || respJson?.xml_url || null,
      danfe_url: respJson?.DanfeUrl || respJson?.danfe_url || null,
      qrcode_url: respJson?.QrCodeUrl || respJson?.qrcode_url || null,
      rejection_code: ok ? null : (respJson?.CodigoErro || String(resp.status)),
      rejection_message: ok ? null : (respJson?.Mensagem || respText.slice(0, 500)),
      brasilnfe_response: respJson,
    }).eq("id", doc.id);

    return new Response(JSON.stringify({
      ok, document_id: doc.id, numero: nfNumero,
      chave_acesso: chave, protocolo, response: respJson,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: ok ? 200 : 422 });

  } catch (err: any) {
    console.error("[nfce-emitir]", err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
