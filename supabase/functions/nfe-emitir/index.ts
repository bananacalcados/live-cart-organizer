// Edge function: nfe-emitir
// Emite NF-e modelo 55 (venda online) via BrasilNFe, com endereço completo do cliente
// e fluxo de contingência idêntico ao nfce-emitir (SEFAZ offline → pending_sefaz).
//
// Body: { order_id: uuid (expedition_orders.id), company_id?: uuid, ambiente?: 'homologacao'|'producao' }
//
// ============================================================================
// 🔒 GOLDEN PAYLOAD — segue estrutura validada (ver mem://features/fiscal/nfe-payload-golden-template)
// Diferenças vs NFC-e:
//   • ModeloDocumento: 55
//   • NaturezaOperacao: "Venda de Mercadoria"
//   • IndicadorPresenca: 9 (operação não presencial, outros)
//   • Cliente.Endereco obrigatório (Logradouro, Numero, Bairro, NmMunicipio, Uf, Cep, NmPais, CdPais=1058)
//   • ModalidadeFrete: 0 (CIF — por conta do emitente)
//   • IdentificadorInterno: NFE-<order_id>
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRASILNFE_BASE = "https://api.brasilnfe.com.br/services";
const PILOT_COMPANY_ID = "febc4662-a126-493e-ada1-4729122760ed"; // VAREJO DE CALCADOS (homologação)

const UF_MAP: Record<string, string> = {
  "ACRE":"AC","ALAGOAS":"AL","AMAPA":"AP","AMAZONAS":"AM","BAHIA":"BA","CEARA":"CE",
  "DISTRITO FEDERAL":"DF","ESPIRITO SANTO":"ES","GOIAS":"GO","MARANHAO":"MA",
  "MATO GROSSO":"MT","MATO GROSSO DO SUL":"MS","MINAS GERAIS":"MG","PARA":"PA",
  "PARAIBA":"PB","PARANA":"PR","PERNAMBUCO":"PE","PIAUI":"PI","RIO DE JANEIRO":"RJ",
  "RIO GRANDE DO NORTE":"RN","RIO GRANDE DO SUL":"RS","RONDONIA":"RO","RORAIMA":"RR",
  "SANTA CATARINA":"SC","SAO PAULO":"SP","SERGIPE":"SE","TOCANTINS":"TO",
};

const digits = (s: any) => String(s ?? "").replace(/\D/g, "");
const round2 = (n: number) => Math.round(n * 100) / 100;
const sanitize = (s: string) => String(s ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Za-z0-9 ]/g, " ")
  .replace(/\s+/g, " ").trim();

function ufFromProvince(p: string | null | undefined): string | null {
  if (!p) return null;
  const up = p.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (up.length === 2) return up;
  return UF_MAP[up] || null;
}

function splitStreetNumber(addr1: string | null | undefined): { logradouro: string; numero: string } {
  const s = String(addr1 ?? "").trim();
  if (!s) return { logradouro: "", numero: "S/N" };
  // Tenta capturar o último número como Numero
  const m = s.match(/^(.*?)[,\s]+(\d{1,6}[A-Za-z]?)\s*$/);
  if (m) return { logradouro: m[1].trim().replace(/,$/, ""), numero: m[2] };
  return { logradouro: s, numero: "S/N" };
}

async function lookupIbge(city: string, uf: string): Promise<string | null> {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/ibge/municipios/v1/${uf}?providers=dados-abertos-br`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const arr = await r.json();
    const target = sanitize(city).toUpperCase();
    const hit = arr.find((m: any) => sanitize(m.nome).toUpperCase() === target);
    return hit?.codigo_ibge || null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { order_id, company_id: forcedCompany, ambiente: forcedAmb } = await req.json();
    if (!order_id) throw new Error("order_id obrigatório");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Carrega pedido + itens
    const { data: order, error: oErr } = await supabase
      .from("expedition_orders")
      .select("*, expedition_order_items(*)")
      .eq("id", order_id).single();
    if (oErr || !order) throw new Error(`Pedido não encontrado: ${oErr?.message}`);

    const items = order.expedition_order_items || [];
    if (!items.length) throw new Error("Pedido sem itens");

    const cpfDest = digits(order.customer_cpf);
    if (!cpfDest || cpfDest.length !== 11) throw new Error("Pedido sem CPF válido do destinatário");

    const ship = (order.shipping_address || {}) as any;
    const ufDestino = ufFromProvince(ship.province) || "MG";
    const cepDest = digits(ship.zip);
    if (!cepDest || cepDest.length !== 8) throw new Error("Pedido sem CEP válido (shipping_address.zip)");
    const cidadeDest = sanitize(ship.city || "").toUpperCase();
    if (!cidadeDest) throw new Error("Pedido sem cidade no endereço");

    const { logradouro, numero } = splitStreetNumber(ship.address1);
    const bairro = sanitize(ship.address2 || "Centro").slice(0, 60) || "Centro";

    // 2. Empresa
    const companyId = forcedCompany || PILOT_COMPANY_ID;
    const { data: company } = await supabase.from("companies").select("*").eq("id", companyId).single();
    if (!company) throw new Error("Empresa não encontrada");
    if (!company.brasilnfe_token) throw new Error("Empresa sem token BrasilNFe");

    const ambiente = forcedAmb || company.ambiente_nfe || "homologacao";
    const tipoAmbiente = ambiente === "producao" ? "1" : "2";
    const ufOrigem: string = company.address_state || "MG";

    // 3. IBGE do município de destino
    const ibgeDest = await lookupIbge(ship.city || "", ufDestino);

    // 4. Monta produtos com snapshot fiscal
    const produtos: any[] = [];
    let totalProd = 0;

    for (const [idx, it] of items.entries()) {
      let prodFiscal: any = null;
      const lookupKey = it.sku || it.barcode;
      if (lookupKey) {
        const { data: variant } = await supabase
          .from("product_variants")
          .select("master_id, products_master:master_id(ncm, origem, cest, unidade)")
          .or(`sku.eq.${lookupKey},gtin.eq.${lookupKey}`)
          .maybeSingle();
        prodFiscal = (variant as any)?.products_master || null;
      }
      const ncmRaw: string | null = prodFiscal?.ncm || null;
      const ncm = ncmRaw ? ncmRaw.replace(/\D/g, "") : null;
      if (!ncm) throw new Error(`Produto ${it.product_name} (SKU ${it.sku}) sem NCM. Rode a Importação Fiscal Tiny.`);

      const { data: rule, error: rErr } = await supabase.rpc("resolve_fiscal_rule", {
        p_ncm: ncm, p_uf_origem: ufOrigem, p_uf_destino: ufDestino, p_tipo_operacao: "venda",
      });
      if (rErr || !rule) throw new Error(`Regra fiscal não encontrada para NCM ${ncm}: ${rErr?.message}`);
      const r: any = rule;

      const vTotal = round2(Number(it.unit_price) * Number(it.quantity));
      totalProd += vTotal;

      const origemFinal = prodFiscal?.origem != null ? Number(prodFiscal.origem) : Number(r.origem_mercadoria ?? 0);
      const nameUpper = sanitize(it.product_name || "").toUpperCase();
      const isAccessory = /\b(BOLSA|CARTEIRA|CINTO|MOCHILA|PULSEIRA|COLAR|BRINCO|RELOGIO|OCULOS|CHAVEIRO|LENCO|MEIA|NECESSAIRE|POCHETE)\b/.test(nameUpper);
      const unidadeFinal = isAccessory ? "UN" : "PAR";

      const nmRaw = sanitize(it.product_name || `ITEM ${idx + 1}`).slice(0, 60).trim() || `ITEM${idx + 1}`;
      const nmProduto = /^\d{8}$|^\d{12,14}$/.test(nmRaw) ? `P${nmRaw}`.slice(0, 60) : nmRaw;
      const skuClean = String(it.sku || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 30);
      const cdProduto = skuClean || `ITEM${idx + 1}`;

      produtos.push({
        NmProduto: nmProduto,
        CodProdutoServico: cdProduto,
        Descricao: nmProduto,
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
        CEST: prodFiscal?.cest || undefined,
        Imposto: {
          ICMS: {
            CodSituacaoTributaria: String(r.csosn_icms || r.cst_icms || "102"),
            AliquotaICMS: Number(r.aliq_icms || 0),
            BaseCalculo: vTotal,
            ValorIcms: round2(vTotal * Number(r.aliq_icms || 0) / 100),
          },
          PIS:    { CodSituacaoTributaria: String(r.cst_pis || "07"),    Aliquota: Number(r.aliq_pis || 0),    BaseCalculo: vTotal },
          COFINS: { CodSituacaoTributaria: String(r.cst_cofins || "07"), Aliquota: Number(r.aliq_cofins || 0), BaseCalculo: vTotal },
          IPI:    { CodSituacaoTributaria: "53", Aliquota: 0, BaseCalculo: 0, ValorIpi: 0 },
        },
      });
    }

    // 5. Frete (a ser somado ao total da nota como vFrete; opcional)
    const vFrete = round2(Number(order.total_shipping || 0));
    const valorTotalNota = round2(totalProd + vFrete);

    // 6. Cria registro pendente
    const { data: doc, error: dErr } = await supabase.from("fiscal_documents").insert({
      company_id: companyId, order_id, modelo: 55, serie: 1,
      numero: null, ambiente, status: "pending",
      valor_total: valorTotalNota, cpf_destinatario: cpfDest,
      nome_destinatario: order.customer_name || "CONSUMIDOR",
    }).select().single();
    if (dErr) throw new Error(`Insert fiscal_documents: ${dErr.message}`);

    // 7. Pagamento
    const formaPagamento = "99"; // Outros (NF-e online — pagamento já capturado externamente)
    const ieEmitente = digits(company.ie);

    const payload: any = {
      TipoAmbiente: tipoAmbiente,
      ModeloDocumento: 55,
      NaturezaOperacao: "Venda de Mercadoria",
      Finalidade: 1,
      ConsumidorFinal: true,
      IndicadorPresenca: 9,
      ModalidadeFrete: 0, // CIF — por conta do emitente
      IdentificadorInterno: `NFE-${order_id}`,
      Emitente: {
        CpfCnpj: digits(company.cnpj),
        ...(ieEmitente ? { Ie: ieEmitente } : {}),
        ...(company.ie_isento ? { IeIsento: true } : {}),
        ...(company.im ? { Im: digits(company.im) } : {}),
      },
      Cliente: {
        CpfCnpj: cpfDest,
        NmCliente: sanitize(order.customer_name || "CONSUMIDOR").slice(0, 60),
        IndicadorIe: 9,
        ...(order.customer_email ? { Email: order.customer_email } : {}),
        ...(order.customer_phone ? { Telefone: digits(order.customer_phone) } : {}),
        Endereco: {
          Logradouro: sanitize(logradouro).slice(0, 60) || "S/N",
          Numero: sanitize(numero).slice(0, 10) || "S/N",
          Bairro: bairro,
          NmMunicipio: sanitize(ship.city || "").slice(0, 60),
          ...(ibgeDest ? { CdMunicipioIbge: ibgeDest } : {}),
          Uf: ufDestino,
          Cep: cepDest,
          NmPais: "BRASIL",
          CdPais: "1058",
        },
      },
      Produtos: produtos,
      ...(vFrete > 0 ? { ValorFrete: vFrete } : {}),
      Pagamentos: [{
        IndicadorPagamento: 0,
        FormaPagamento: formaPagamento,
        Descricao: "Pago no checkout online",
        VlPago: valorTotalNota,
      }],
    };

    await supabase.from("fiscal_documents").update({ brasilnfe_request: payload }).eq("id", doc.id);

    // 8. Chama BrasilNFe (com tratamento de SEFAZ offline → contingência)
    let resp: Response | null = null;
    let respText = "";
    let networkError: string | null = null;
    try {
      resp = await fetch(`${BRASILNFE_BASE}/Fiscal/EnviarNotaFiscal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Token": company.brasilnfe_token },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000),
      });
      respText = await resp.text();
    } catch (e: any) {
      networkError = e?.message || String(e);
    }

    let respJson: any = null;
    if (respText) { try { respJson = JSON.parse(respText); } catch { respJson = { raw: respText }; } }

    const ret = respJson?.ReturnNF || {};
    const ok = !!ret.Ok && !!ret.ChaveNF;
    const chave = ret.ChaveNF || null;
    const numeroRet = ret.Numero ? Number(ret.Numero) : null;
    const serieRet = ret.Serie ? Number(ret.Serie) : 1;
    const protocolo = ret.Protocolo || respJson?.Protocolo || null;
    const errorMsg = respJson?.Error || ret.DsStatusRespostaSefaz || networkError || null;
    const codSefaz = ret.CodStatusRespostaSefaz ? Number(ret.CodStatusRespostaSefaz) : null;

    const httpStatus = resp?.status ?? 0;
    const msgLow = String(errorMsg || "").toLowerCase();
    const sefazOffline =
      !ok && (
        networkError != null ||
        httpStatus >= 500 || httpStatus === 0 ||
        codSefaz === 108 || codSefaz === 109 || codSefaz === 999 ||
        (msgLow.includes("sefaz") && (msgLow.includes("fora") || msgLow.includes("indispon") || msgLow.includes("paralis") || msgLow.includes("offline"))) ||
        msgLow.includes("timeout") || msgLow.includes("aborted") || msgLow.includes("connection")
      );

    const finalStatus = ok ? "authorized" : (sefazOffline ? "pending_sefaz" : "rejected");
    const nextRetry = sefazOffline ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;

    await supabase.from("fiscal_documents").update({
      status: finalStatus,
      chave_acesso: chave, protocolo,
      numero: numeroRet, serie: serieRet,
      data_autorizacao: ok ? new Date().toISOString() : null,
      xml_url: respJson?.XmlUrl || respJson?.xml_url || null,
      danfe_url: respJson?.DanfeUrl || respJson?.danfe_url || null,
      qrcode_url: respJson?.QrCodeUrl || respJson?.qrcode_url || null,
      rejection_code: ok ? null : (codSefaz ? String(codSefaz) : (httpStatus ? String(httpStatus) : "NETWORK")),
      rejection_message: ok ? null : (errorMsg || respText.slice(0, 500) || "Erro desconhecido"),
      brasilnfe_response: respJson || { networkError, httpStatus },
      contingencia_motivo: sefazOffline ? `[${codSefaz || httpStatus || "NET"}] ${(errorMsg || networkError || "SEFAZ indisponível").slice(0, 300)}` : null,
      next_retry_at: nextRetry,
      retry_count: 0,
    }).eq("id", doc.id);

    const httpResp = ok ? 200 : (sefazOffline ? 202 : 422);
    return new Response(JSON.stringify({
      ok, contingencia: sefazOffline, document_id: doc.id, numero: numeroRet,
      chave_acesso: chave, protocolo, error: ok ? null : errorMsg,
      message: sefazOffline ? "SEFAZ indisponível — nota em fila de contingência, será reemitida automaticamente" : null,
      response: respJson,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: httpResp });

  } catch (err: any) {
    console.error("[nfe-emitir]", err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
