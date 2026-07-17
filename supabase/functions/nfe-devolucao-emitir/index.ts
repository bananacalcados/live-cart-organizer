// Edge function: nfe-devolucao-emitir
// Fase 5 — NF-e de DEVOLUÇÃO (entrada) da Etapa 2 de Trocas/Devoluções.
//
// Emite NF-e modelo 55, Finalidade 4 (devolução de mercadoria), operação de ENTRADA,
// referenciando a chave da nota original (refNFe / NFReferencia) — vale para original
// modelo 55 (NF-e) ou 65 (NFC-e). Espelha os impostos/valores da nota original.
//
// Body: { troca_devolucao_id: uuid, ambiente?: 'homologacao'|'producao', cfop_override?: string }
//
// REGRAS FISCAIS (confirmar com contador):
//   • Só os itens efetivamente devolvidos e CONFERIDOS entram na nota.
//   • Valores idênticos aos da nota original (unit_price do item original) × qtd devolvida.
//   • Impostos espelham o snapshot fiscal do item original (CST/CSOSN/alíquotas).
//   • CFOP sugerido: 1.202 (entrada, mesma UF) / 2.202 (entrada, outra UF).
//   • Cliente identificado (CPF) → cliente como contraparte.
//     Venda sem identificação → a própria loja como destinatária (CNPJ do emitente).
//
// INTEGRIDADE TRANSACIONAL: esta função SÓ emite a devolução e grava o documento.
// NÃO cancela o pedido original nem movimenta estoque — essa orquestração fica em
// finalizeExchange.ts, que só avança quando a devolução é AUTORIZADA. Se o SEFAZ
// rejeitar, o evento permanece reprocessável (devolucao_doc_id aponta o doc rejeitado).
//
// ============================================================================
// 🔒 GOLDEN PAYLOAD — segue a estrutura validada (ver mem://features/fiscal/nfe-payload-golden-template)
//   Diferenças da devolução: Finalidade=4, NFReferencia=[chaveOriginal], CFOP 1202/2202.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRASILNFE_BASE = "https://api.brasilnfe.com.br/services";

const digits = (s: any) => String(s ?? "").replace(/\D/g, "");
const round2 = (n: number) => Math.round(n * 100) / 100;
const sanitize = (s: string) => String(s ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Za-z0-9 ]/g, " ")
  .replace(/\s+/g, " ").trim();

const UF_MAP: Record<string, string> = {
  "ACRE":"AC","ALAGOAS":"AL","AMAPA":"AP","AMAZONAS":"AM","BAHIA":"BA","CEARA":"CE",
  "DISTRITO FEDERAL":"DF","ESPIRITO SANTO":"ES","GOIAS":"GO","MARANHAO":"MA",
  "MATO GROSSO":"MT","MATO GROSSO DO SUL":"MS","MINAS GERAIS":"MG","PARA":"PA",
  "PARAIBA":"PB","PARANA":"PR","PERNAMBUCO":"PE","PIAUI":"PI","RIO DE JANEIRO":"RJ",
  "RIO GRANDE DO NORTE":"RN","RIO GRANDE DO SUL":"RS","RONDONIA":"RO","RORAIMA":"RR",
  "SANTA CATARINA":"SC","SAO PAULO":"SP","SERGIPE":"SE","TOCANTINS":"TO",
};
function ufFromAny(p: any): string | null {
  if (!p) return null;
  const up = String(p).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (up.length === 2) return up;
  return UF_MAP[up] || null;
}
function splitStreetNumber(addr1: string | null | undefined): { logradouro: string; numero: string } {
  const s = String(addr1 ?? "").trim();
  if (!s) return { logradouro: "", numero: "S/N" };
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

// CST de PIS/COFINS: converte o código da nota de SAÍDA (grupo 01–09) para um
// código válido em nota de ENTRADA (grupo 50–99). Sem isso a SEFAZ rejeita a
// devolução com "CST do PIS/COFINS inválido para nota fiscal de entrada".
//   • 01/02 com alíquota > 0 (tributado, gera crédito) → 50 (mantém base/alíquota)
//   • demais (isenta, alíquota zero, monofásico, sem crédito, Simples) → 98
//     "Outras Operações de Entrada" com alíquota e base zeradas.
function cstEntradaPisCofins(
  cstSaida: any,
  aliq: number,
  vBase: number,
): { cst: string; aliq: number; base: number } {
  const c = String(cstSaida ?? "").replace(/\D/g, "").padStart(2, "0");
  if ((c === "01" || c === "02") && aliq > 0) {
    return { cst: "50", aliq, base: vBase };
  }
  return { cst: "98", aliq: 0, base: 0 };
}

function buildRenderableDanfeUrl(url: string | null | undefined) {
  if (!url || !/\.html(?:$|[?#])/i.test(url)) return url || null;
  const endpoint = new URL("/functions/v1/fiscal-render-document", Deno.env.get("SUPABASE_URL")!);
  endpoint.searchParams.set("url", url);
  return endpoint.toString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { troca_devolucao_id, ambiente: forcedAmb, cfop_override } = await req.json();
    if (!troca_devolucao_id) throw new Error("troca_devolucao_id obrigatório");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Carrega o evento de troca/devolução + itens
    const { data: evt, error: evtErr } = await supabase
      .from("trocas_devolucoes")
      .select("*, trocas_devolucoes_itens(*)")
      .eq("id", troca_devolucao_id).single();
    if (evtErr || !evt) throw new Error(`Evento não encontrado: ${evtErr?.message}`);

    // 1b. Idempotência: se já existe devolução AUTORIZADA, não reemite.
    if ((evt as any).devolucao_doc_id) {
      const { data: prevDoc } = await supabase
        .from("fiscal_documents").select("*").eq("id", (evt as any).devolucao_doc_id).maybeSingle();
      if (prevDoc && (prevDoc as any).status === "authorized") {
        return new Response(JSON.stringify({
          ok: true, already: true, status: "authorized",
          document_id: (prevDoc as any).id, chave_acesso: (prevDoc as any).chave_acesso,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
      if (prevDoc && (prevDoc as any).status === "pending_sefaz") {
        return new Response(JSON.stringify({
          ok: false, contingencia: true, status: "pending_sefaz",
          document_id: (prevDoc as any).id,
          message: "Devolução já está em fila de contingência (SEFAZ indisponível).",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 });
      }
      // status rejected/pending/error → segue e reemite (cria novo documento).
    }

    // 2. Venda original + itens (snapshot fiscal) + loja/empresa
    const pedidoOriginalId = (evt as any).pedido_original_id;
    if (!pedidoOriginalId) throw new Error("Evento sem pedido original vinculado");

    const { data: sale, error: sErr } = await supabase
      .from("pos_sales")
      .select("*, pos_sale_items(*), pos_customers(*)")
      .eq("id", pedidoOriginalId).single();
    if (sErr || !sale) throw new Error(`Venda original não encontrada: ${sErr?.message}`);
    const origItems = (sale as any).pos_sale_items || [];

    // 3. Chave da nota original (refNFe). Prioriza a gravada no evento; senão busca
    //    o documento fiscal AUTORIZADO da venda original (modelo 55 ou 65).
    let chaveOriginal: string | null = (evt as any).chave_acesso_original || null;
    let modeloOriginal: number | null = null;
    if (!chaveOriginal) {
      const { data: origDoc } = await supabase
        .from("fiscal_documents")
        .select("chave_acesso, modelo")
        .eq("pos_sale_id", pedidoOriginalId)
        .eq("status", "authorized")
        .not("chave_acesso", "is", null)
        .in("modelo", [55, 65])
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (origDoc) { chaveOriginal = (origDoc as any).chave_acesso; modeloOriginal = (origDoc as any).modelo; }
    }
    if (chaveOriginal) chaveOriginal = digits(chaveOriginal);

    // Venda física sem NF → ramo sem estorno fiscal: não emite devolução, apenas sinaliza.
    if (!chaveOriginal || chaveOriginal.length !== 44) {
      return new Response(JSON.stringify({
        ok: false, skip: true, reason: "sem_nota_original",
        message: "Venda original sem NF-e/NFC-e autorizada — devolução sem estorno fiscal.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    // 4. Empresa (via loja da venda original)
    const { data: store } = await supabase
      .from("pos_stores").select("*, company_id").eq("id", (sale as any).store_id).single();
    const companyId = (store as any)?.company_id;
    if (!companyId) throw new Error("Loja sem company_id vinculado");
    const { data: company } = await supabase.from("companies").select("*").eq("id", companyId).single();
    if (!company) throw new Error("Empresa não encontrada");
    if (!company.brasilnfe_token) throw new Error("Empresa sem token BrasilNFe");

    const ambiente = forcedAmb || company.ambiente_nfe || "homologacao";
    const tipoAmbiente = ambiente === "producao" ? "1" : "2";
    const ufOrigem: string = (company.uf || company.address_state || "MG").toUpperCase();

    // 5. Itens devolvidos CONFERIDOS (estado_estoque preenchido = conferência concluída)
    const devolvidos = (((evt as any).trocas_devolucoes_itens) || [])
      .filter((i: any) => i.direcao === "devolvido"
        && (i.estado_estoque === "retornado_vendavel" || i.estado_estoque === "retornado_avaria"))
      .filter((i: any) => Number(i.quantidade || 0) > 0);
    if (!devolvidos.length) throw new Error("Nenhum item devolvido conferido para emitir a devolução");

    // Índices dos itens originais para casar SKU/barcode e espelhar snapshot fiscal + preço
    const bySku = new Map<string, any>();
    const byBarcode = new Map<string, any>();
    for (const oi of origItems) {
      if (oi.sku) bySku.set(String(oi.sku), oi);
      if (oi.barcode) byBarcode.set(String(oi.barcode), oi);
    }

    // Desconto proporcional da venda original (mesma fórmula da emissão original) para
    // que a base de cálculo dos impostos da devolução seja idêntica à da venda.
    const descontoVenda = round2(Number((sale as any).discount || 0));
    const somaBruta = origItems.reduce(
      (acc: number, it: any) => acc + Number(it.unit_price) * Number(it.quantity), 0);
    const ratioDesc = descontoVenda > 0 && somaBruta > 0 ? descontoVenda / somaBruta : 0;

    // CFOP de devolução (entrada): 1.202 mesma UF, 2.202 outra UF (confirmar com contador)
    const ufCliente = String((sale as any).shipping_state || (sale as any).customer_state || ufOrigem).toUpperCase();
    const cfopDevolucao = cfop_override
      ? String(cfop_override)
      : (ufCliente === ufOrigem ? "1202" : "2202");

    const produtos: any[] = [];
    let totalProd = 0;
    let totalDesc = 0;

    for (const [idx, di] of devolvidos.entries()) {
      const oi = (di.sku && bySku.get(String(di.sku)))
        || (di.barcode && byBarcode.get(String(di.barcode)))
        || null;

      // Preço idêntico ao da nota original; se não achar o item original, usa o valor gravado no evento.
      const unitPrice = round2(Number(oi?.unit_price ?? di.valor_unitario ?? 0));
      const qtd = Number(di.quantidade);
      const vTotal = round2(unitPrice * qtd);
      const vDesc = ratioDesc > 0 ? round2(vTotal * ratioDesc) : 0;
      const vBase = round2(vTotal - vDesc);
      totalProd += vTotal;
      totalDesc += vDesc;

      // Espelha snapshot fiscal do item original (garante estorno idêntico)
      const ncm = digits(oi?.ncm_snapshot) || "64039990";
      const csosn = String(oi?.csosn_icms || "").trim();
      const cst = String(oi?.cst_icms || "").trim();
      const codSitIcms = csosn || cst || "102";
      const aliqIcms = Number(oi?.aliq_icms || 0);
      const unidade = (oi?.unidade_comercial && String(oi.unidade_comercial).trim()) || "PAR";
      const origemMerc = oi?.origem_mercadoria != null ? Number(oi.origem_mercadoria) : 0;
      const cest = oi?.cest_snapshot || undefined;

      const nome = di.produto_nome || oi?.product_name || `ITEM ${idx + 1}`;
      const nmRaw = sanitize(nome).slice(0, 60).trim() || `ITEM${idx + 1}`;
      const nmProduto = /^\d{8}$|^\d{12,14}$/.test(nmRaw) ? `P${nmRaw}`.slice(0, 60) : nmRaw;
      const skuClean = String(di.sku || oi?.sku || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 30);
      const cdProduto = skuClean || `ITEM${idx + 1}`;

      produtos.push({
        NmProduto: nmProduto,
        CodProdutoServico: cdProduto,
        Descricao: nmProduto,
        NCM: ncm,
        CFOP: Number(cfopDevolucao),
        Unidade: unidade,
        UnidadeComercial: unidade,
        UnidadeMedida: unidade,
        UnidadeTributavel: unidade,
        QuantidadeTributavel: qtd,
        ValorUnitarioTributavel: unitPrice,
        Quantidade: qtd,
        ValorUnitario: unitPrice,
        ValorTotal: vTotal,
        ...(vDesc > 0 ? { ValorDesconto: vDesc } : {}),
        Origem: origemMerc,
        CEST: cest,
        Imposto: {
          ICMS: {
            CodSituacaoTributaria: codSitIcms,
            AliquotaICMS: aliqIcms,
            BaseCalculo: vBase,
            ValorIcms: round2(vBase * aliqIcms / 100),
          },
          PIS:    (() => { const m = cstEntradaPisCofins(oi?.cst_pis,    Number(oi?.aliq_pis || 0),    vBase); return { CodSituacaoTributaria: m.cst, Aliquota: m.aliq, BaseCalculo: m.base }; })(),
          COFINS: (() => { const m = cstEntradaPisCofins(oi?.cst_cofins, Number(oi?.aliq_cofins || 0), vBase); return { CodSituacaoTributaria: m.cst, Aliquota: m.aliq, BaseCalculo: m.base }; })(),
        },
      });
    }

    const totalLiquido = round2(totalProd - totalDesc);

    // 6. Cliente: identificado (CPF) → contraparte com endereço; sem CPF ou sem endereço válido → a própria loja.
    //    Endereço é MONTADO automaticamente do cadastro vivo (pos_customers) + snapshot do pedido
    //    (customer_state/city/cep + shipping_address). Se faltar UF/CEP, cai no fallback loja
    //    para não travar a devolução por dado de cadastro incompleto (a NF continua idônea:
    //    devolução para o próprio estoque via CNPJ do emitente).
    const cpfDest = digits((sale as any).customer_cpf || (sale as any).pos_customers?.cpf);
    const hasCpf = cpfDest.length === 11;
    const ieEmitente = digits(company.ie);

    const pc: any = (sale as any).pos_customers || {};
    const sa: any = (sale as any).shipping_address || {};
    const pick = (...vals: any[]) => {
      for (const v of vals) {
        const s = v == null ? "" : String(v).trim();
        if (s) return s;
      }
      return "";
    };
    const ufDest = ufFromAny(pick(pc.state, (sale as any).customer_state, sa.province, sa.state));
    const cepDest = digits(pick(pc.cep, (sale as any).customer_cep, sa.zip, sa.cep));
    const cityDest = pick(pc.city, (sale as any).customer_city, sa.city);
    const enderecoRaw = pick(
      [pick(pc.address), pick(pc.address_number)].filter(Boolean).join(", "),
      sa.address1,
      [sa.address, sa.number].filter(Boolean).join(", "),
    );
    const bairroDest = pick(pc.neighborhood, sa.neighborhood, sa.address2, "Centro");
    const split = splitStreetNumber(enderecoRaw);
    const numeroDest = pick(pc.address_number, sa.number, split.numero, "S/N");
    const logradouroDest = split.logradouro || pick(pc.address, sa.address) || "S/N";

    const clienteComEndereco = hasCpf && !!ufDest && cepDest.length === 8;
    const ibgeDest = clienteComEndereco && cityDest ? await lookupIbge(cityDest, ufDest!) : null;
    const clienteIdentificado = clienteComEndereco;

    const cliente: any = clienteComEndereco
      ? {
          CpfCnpj: cpfDest,
          NmCliente: sanitize((sale as any).customer_name || pc.name || "CONSUMIDOR").slice(0, 60),
          IndicadorIe: 9,
          Endereco: {
            Cep: cepDest,
            Logradouro: sanitize(logradouroDest).slice(0, 60) || "S/N",
            Numero: sanitize(numeroDest).slice(0, 10) || "S/N",
            Bairro: sanitize(bairroDest).slice(0, 60) || "Centro",
            ...(ibgeDest ? { CodMunicipio: ibgeDest } : {}),
            Municipio: sanitize(cityDest).slice(0, 60),
            Uf: ufDest,
            CodPais: 1058,
            Pais: "BRASIL",
          },
          Contato: {
            ...((sale as any).customer_phone ? { Telefone: digits((sale as any).customer_phone) } : {}),
            ...((sale as any).customer_email || pc.email ? { Email: (sale as any).customer_email || pc.email } : {}),
          },
        }
      : {
          // Sem CPF OU sem endereço válido → loja é a destinatária (devolução para o próprio estoque).
          CpfCnpj: digits(company.cnpj),
          NmCliente: sanitize(company.razao_social || company.nome_fantasia || "LOJA").slice(0, 60),
          ...(ieEmitente ? { Ie: ieEmitente } : {}),
          IndicadorIe: ieEmitente ? 1 : 9,
          Endereco: {
            Cep: digits(company.address_cep),
            Logradouro: sanitize(company.address_street || "S/N").slice(0, 60) || "S/N",
            Numero: sanitize(company.address_number || "S/N").slice(0, 10) || "S/N",
            Bairro: sanitize(company.address_neighborhood || "Centro").slice(0, 60) || "Centro",
            ...(company.address_city_ibge ? { CodMunicipio: String(company.address_city_ibge) } : {}),
            Municipio: sanitize(company.address_city || "").slice(0, 60),
            Uf: (company.address_state || ufOrigem).toUpperCase(),
            CodPais: 1058,
            Pais: "BRASIL",
          },
        };


    // 7. Cria o documento fiscal (entrada) pendente e vincula ao evento AGORA
    const { data: doc, error: dErr } = await supabase.from("fiscal_documents").insert({
      company_id: companyId,
      pos_sale_id: pedidoOriginalId,
      modelo: 55, serie: 1, numero: null,
      ambiente, status: "pending",
      finalidade: 4,
      tipo_operacao: "entrada",
      ref_chave_acesso: chaveOriginal,
      troca_devolucao_id: troca_devolucao_id,
      valor_total: totalLiquido,
      cpf_destinatario: clienteIdentificado ? cpfDest : digits(company.cnpj),
      nome_destinatario: cliente.NmCliente,
    }).select().single();
    if (dErr) throw new Error(`Insert fiscal_documents: ${dErr.message}`);

    await supabase.from("trocas_devolucoes")
      .update({ devolucao_doc_id: doc.id, fase2_erro: null })
      .eq("id", troca_devolucao_id);

    // 8. Payload BrasilNFe (devolução)
    const payload: any = {
      TipoAmbiente: tipoAmbiente,
      ModeloDocumento: 55,
      NaturezaOperacao: "Devolucao de Mercadoria",
      Finalidade: 4,
      NFReferencia: [chaveOriginal],
      ConsumidorFinal: true,
      IndicadorPresenca: clienteIdentificado ? 1 : 9,
      IdentificadorInterno: `DEV-${troca_devolucao_id}`,
      Emitente: {
        CpfCnpj: digits(company.cnpj),
        ...(ieEmitente ? { Ie: ieEmitente } : {}),
        ...(company.ie_isento ? { IeIsento: true } : {}),
        ...(company.im ? { Im: digits(company.im) } : {}),
      },
      Cliente: cliente,
      Produtos: produtos,
      Pagamentos: [{
        IndicadorPagamento: 0,
        FormaPagamento: "90", // Sem pagamento (devolução — não há circulação financeira nova)
        Descricao: "Devolucao de mercadoria",
        VlPago: 0,
      }],
    };

    await supabase.from("fiscal_documents").update({ brasilnfe_request: payload }).eq("id", doc.id);

    // 9. Envia à BrasilNFe (com contingência SEFAZ offline → pending_sefaz)
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

    // Decodifica XML/DANFE base64 quando autorizado
    let xmlContent: string | null = null;
    let danfeUrl: string | null = respJson?.DanfeUrl || respJson?.danfe_url || null;
    if (ok) {
      try {
        if (respJson?.Base64Xml) {
          const xmlBytes = Uint8Array.from(atob(respJson.Base64Xml), c => c.charCodeAt(0));
          xmlContent = new TextDecoder("utf-8").decode(xmlBytes);
        }
        if (respJson?.Base64File && chave) {
          const fileBytes = Uint8Array.from(atob(respJson.Base64File), c => c.charCodeAt(0));
          const isPdf = fileBytes[0] === 0x25 && fileBytes[1] === 0x50 && fileBytes[2] === 0x44 && fileBytes[3] === 0x46;
          const ext = isPdf ? "pdf" : "html";
          const ctype = isPdf ? "application/pdf" : "text/html; charset=utf-8";
          const path = `danfe/${chave}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("fiscal-documents").upload(path, fileBytes, { contentType: ctype, upsert: true });
          if (!upErr) {
            if (isPdf) {
              const { data: signed } = await supabase.storage
                .from("fiscal-documents").createSignedUrl(path, 315360000);
              danfeUrl = signed?.signedUrl || danfeUrl;
            } else {
              const { data: pub } = supabase.storage.from("fiscal-documents").getPublicUrl(path);
              danfeUrl = buildRenderableDanfeUrl(pub?.publicUrl || danfeUrl);
            }
          }
        }
      } catch (e) {
        console.error("[nfe-devolucao-emitir] base64 decode/upload error", e);
      }
    }

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
      xml_content: xmlContent,
      danfe_url: buildRenderableDanfeUrl(danfeUrl),
      rejection_code: ok ? null : (codSefaz ? String(codSefaz) : (httpStatus ? String(httpStatus) : "NETWORK")),
      rejection_message: ok ? null : (errorMsg || respText.slice(0, 500) || "Erro desconhecido"),
      brasilnfe_response: respJson || { networkError, httpStatus },
      contingencia_motivo: sefazOffline ? `[${codSefaz || httpStatus || "NET"}] ${(errorMsg || networkError || "SEFAZ indisponível").slice(0, 300)}` : null,
      next_retry_at: nextRetry,
      retry_count: 0,
    }).eq("id", doc.id);

    // Atualiza o evento: grava a chave da devolução quando autorizada; senão registra erro.
    await supabase.from("trocas_devolucoes").update({
      chave_devolucao: ok ? chave : null,
      fase2_erro: ok ? null : (sefazOffline
        ? "Devolução em contingência (SEFAZ indisponível)"
        : `Devolução rejeitada: ${(errorMsg || "erro desconhecido").slice(0, 200)}`),
    }).eq("id", troca_devolucao_id);

    const httpResp = ok ? 200 : (sefazOffline ? 202 : 422);
    return new Response(JSON.stringify({
      ok, contingencia: sefazOffline, status: finalStatus,
      document_id: doc.id, numero: numeroRet, serie: serieRet,
      chave_acesso: chave, chave_referenciada: chaveOriginal, cfop: cfopDevolucao,
      error: ok ? null : errorMsg,
      message: sefazOffline
        ? "SEFAZ indisponível — devolução em fila de contingência, será reemitida automaticamente"
        : null,
      response: respJson,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: httpResp });

  } catch (err: any) {
    console.error("[nfe-devolucao-emitir]", err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
