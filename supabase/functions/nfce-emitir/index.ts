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
      // Busca dados fiscais via products_master (importação Tiny) usando GTIN/SKU
      let prodFiscal: any = null;
      if (it.sku) {
        const { data: variant } = await supabase
          .from("product_variants")
          .select("master_id, products_master:master_id(ncm, origem, cest, unidade)")
          .eq("sku", it.sku).maybeSingle();
        prodFiscal = (variant as any)?.products_master || null;
      }
      const ncmRaw: string | null = prodFiscal?.ncm || it.ncm_snapshot || null;
      const ncm = ncmRaw ? ncmRaw.replace(/\D/g, "") : null;
      if (!ncm) throw new Error(`Produto ${it.product_name} (SKU ${it.sku}) sem NCM em products_master. Rode a Importação Fiscal Tiny.`);

      const { data: rule, error: rErr } = await supabase.rpc("resolve_fiscal_rule", {
        p_ncm: ncm, p_uf_origem: ufOrigem, p_uf_destino: ufDestino, p_tipo_operacao: "venda",
      });
      if (rErr || !rule) throw new Error(`Regra fiscal não encontrada para NCM ${ncm}: ${rErr?.message}`);

      const r: any = rule;
      const vTotal = round2(Number(it.unit_price) * Number(it.quantity));
      totalProd += vTotal;

      // Origem prioriza o cadastro do produto (Tiny) — pode haver importados (origem 1/2)
      const origemFinal = prodFiscal?.origem != null ? Number(prodFiscal.origem) : Number(r.origem_mercadoria ?? 0);
      // Unidade: calçados = PAR; acessórios (bolsa/carteira/cinto/mochila/pulseira/colar/brinco/relogio/oculos/chaveiro/lenco) = UN
      const nameUpper = String(it.product_name || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
      const isAccessory = /\b(BOLSA|CARTEIRA|CINTO|MOCHILA|PULSEIRA|COLAR|BRINCO|RELOGIO|OCULOS|CHAVEIRO|LENCO|MEIA|NECESSAIRE|POCHETE)\b/.test(nameUpper);
      const unidadeFinal = isAccessory ? "UN" : "PAR";
      const cestFinal = prodFiscal?.cest || null;

      // grava snapshot
      await supabase.from("pos_sale_items").update({
        ncm_snapshot: ncm,
        cfop_snapshot: r.cfop,
        cst_icms: r.cst_icms,
        csosn_icms: r.csosn_icms,
        aliq_icms: r.aliq_icms,
        cst_pis: r.cst_pis, aliq_pis: r.aliq_pis,
        cst_cofins: r.cst_cofins, aliq_cofins: r.aliq_cofins,
        origem_mercadoria: origemFinal,
        cest_snapshot: cestFinal,
        unidade_comercial: unidadeFinal,
      }).eq("id", it.id);

      const sanitize = (s: string) => s
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9 ]/g, " ")
        .replace(/\s+/g, " ").trim();
      const nmRaw = sanitize(it.product_name || `ITEM ${idx + 1}`).slice(0, 60).trim() || `ITEM${idx + 1}`;
      const nmProduto = /^\d{8}$|^\d{12,14}$/.test(nmRaw) ? `P${nmRaw}`.slice(0, 60) : nmRaw;
      // Código curto e limpo (cProd) — SKU sanitizado ou ITEM<n>
      const skuClean = String(it.sku || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 30);
      const cdProduto = skuClean || `ITEM${idx + 1}`;
      const desc = sanitize(String(it.product_name || "")).slice(0, 120);
      produtos.push({
        NmProduto: nmProduto,
        CodProdutoServico: cdProduto,
        Descricao: desc,

        NCM: ncm,
        CFOP: Number(r.cfop),
        Unidade: unidadeFinal,
        UnidadeComercial: unidadeFinal,
        UnidadeMedida: unidadeFinal,
        UnidadeTributavel: unidadeFinal,
        QuantidadeTributavel: Number(it.quantity),
        ValorUnitarioTributavel: round2(Number(it.unit_price)),
        Quantidade: Number(it.quantity),
        ValorUnitario: round2(Number(it.unit_price)),
        ValorTotal: vTotal,
        Origem: origemFinal,
        CEST: cestFinal || undefined,
        Imposto: {
          ICMS: {
            CodSituacaoTributaria: String(r.csosn_icms || r.cst_icms || "102"),
            AliquotaICMS: Number(r.aliq_icms || 0),
            BaseCalculo: vTotal,
            ValorIcms: round2(vTotal * Number(r.aliq_icms || 0) / 100),
          },
          PIS: {
            CodSituacaoTributaria: String(r.cst_pis || "07"),
            Aliquota: Number(r.aliq_pis || 0),
            BaseCalculo: vTotal,
          },
          COFINS: {
            CodSituacaoTributaria: String(r.cst_cofins || "07"),
            Aliquota: Number(r.aliq_cofins || 0),
            BaseCalculo: vTotal,
          },
        },
      });
    }

    // 4. Cria registro pendente (número/série virão da resposta — o painel BrasilNFe controla a numeração)
    const { data: doc, error: dErr } = await supabase.from("fiscal_documents").insert({
      company_id: companyId, pos_sale_id: sale_id, modelo: 65, serie: 1,
      numero: null, ambiente, status: "pending",
      valor_total: totalProd, cpf_destinatario: cpfDest,
      nome_destinatario: sale.customer_name || (sale.pos_customers as any)?.name || "CONSUMIDOR",
    }).select().single();
    if (dErr) throw new Error(`Insert fiscal_documents: ${dErr.message}`);

    // Mapeia método de pagamento -> FormaPagamento (tabela 38 da SEFAZ, como string)
    const pmRaw = (sale.payment_method || "").toLowerCase();
    const formaPagamento =
      pmRaw.includes("pix") ? "17" :
      pmRaw.includes("crédito") || pmRaw.includes("credito") ? "03" :
      pmRaw.includes("débito") || pmRaw.includes("debito") ? "04" :
      pmRaw.includes("dinheiro") || pmRaw.includes("espécie") || pmRaw.includes("especie") ? "01" :
      pmRaw.includes("boleto") ? "15" :
      "99";
    const descricaoPagamento =
      formaPagamento === "17" ? "PIX" :
      formaPagamento === "03" ? "Cartão de Crédito" :
      formaPagamento === "04" ? "Cartão de Débito" :
      formaPagamento === "01" ? "Dinheiro" :
      formaPagamento === "15" ? "Boleto" :
      "Outros";

    // 5. Monta payload BrasilNFe (formato oficial da API)
    const payload = {
      TipoAmbiente: tipoAmbiente,
      ModeloDocumento: 65,
      NaturezaOperacao: "Venda ao Consumidor",
      Finalidade: 1,
      ConsumidorFinal: true,
      IndicadorPresenca: 1,
      Cliente: {
        CpfCnpj: cpfDest,
        NmCliente: sale.customer_name || (sale.pos_customers as any)?.name || "CONSUMIDOR",
        IndicadorIe: 9,
      },
      Produtos: produtos,
      Pagamentos: [{
        IndicadorPagamento: 0,
        FormaPagamento: formaPagamento,
        Descricao: descricaoPagamento,
        VlPago: round2(totalProd),
      }],
    };

    await supabase.from("fiscal_documents").update({ brasilnfe_request: payload }).eq("id", doc.id);

    // 6. Chama BrasilNFe
    const resp = await fetch(`${BRASILNFE_BASE}/Fiscal/EnviarNotaFiscal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Token": company.brasilnfe_token },
      body: JSON.stringify(payload),
    });
    const respText = await resp.text();
    let respJson: any = null;
    try { respJson = JSON.parse(respText); } catch { respJson = { raw: respText }; }

    const ret = respJson?.ReturnNF || {};
    const ok = !!ret.Ok && !!ret.ChaveNF;
    const chave = ret.ChaveNF || null;
    const numeroRet = ret.Numero ? Number(ret.Numero) : null;
    const serieRet = ret.Serie ? Number(ret.Serie) : 1;
    const protocolo = ret.Protocolo || respJson?.Protocolo || null;
    const errorMsg = respJson?.Error || ret.DsStatusRespostaSefaz || null;

    await supabase.from("fiscal_documents").update({
      status: ok ? "authorized" : "rejected",
      chave_acesso: chave, protocolo,
      numero: numeroRet, serie: serieRet,
      data_autorizacao: ok ? new Date().toISOString() : null,
      xml_url: respJson?.XmlUrl || respJson?.xml_url || null,
      danfe_url: respJson?.DanfeUrl || respJson?.danfe_url || null,
      qrcode_url: respJson?.QrCodeUrl || respJson?.qrcode_url || null,
      rejection_code: ok ? null : (ret.CodStatusRespostaSefaz ? String(ret.CodStatusRespostaSefaz) : String(resp.status)),
      rejection_message: ok ? null : (errorMsg || respText.slice(0, 500)),
      brasilnfe_response: respJson,
    }).eq("id", doc.id);

    return new Response(JSON.stringify({
      ok, document_id: doc.id, numero: numeroRet,
      chave_acesso: chave, protocolo, error: ok ? null : errorMsg, response: respJson,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: ok ? 200 : 422 });

  } catch (err: any) {
    console.error("[nfce-emitir]", err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
