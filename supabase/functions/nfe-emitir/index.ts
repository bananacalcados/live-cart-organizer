// Edge function: nfe-emitir
// Emite NF-e modelo 55 (venda online) via BrasilNFe, com endereço completo do cliente
// e fluxo de contingência idêntico ao nfce-emitir (SEFAZ offline → pending_sefaz).
//
// Body: { order_id?: uuid (expedition_orders.id) | beta_order_id?: uuid (expedition_beta_orders.id) | sale_id?: uuid (pos_sales.id), company_id?: uuid, ambiente?: 'homologacao'|'producao' }
// Suporta três fluxos:
//   A) order_id      (expedition_orders) — fluxo histórico
//   B) beta_order_id (expedition_beta_orders) — fluxo Expedição Beta
//   C) sale_id       (pos_sales sale_type='online') — venda PDV online; busca company_id em pos_stores.
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

function buildRenderableDanfeUrl(url: string | null | undefined) {
  if (!url || !/\.html(?:$|[?#])/i.test(url)) return url || null;
  const endpoint = new URL("/functions/v1/fiscal-render-document", Deno.env.get("SUPABASE_URL")!);
  endpoint.searchParams.set("url", url);
  return endpoint.toString();
}

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

// Fallback Tiny: pedidos Beta sincronizados (ou vindos do checkout-transparente) podem ter
// shipping_address/CPF vazios. Busca os dados direto no Tiny ERP usando o tiny_order_id e
// normaliza no mesmo formato do shipping_address da Expedição Beta.
const TINY_V2_BASE = "https://api.tiny.com.br/api2";
async function tinyGetOrderData(
  tinyOrderId: string,
): Promise<{ shipping_address: any | null; cpf: string | null } | null> {
  const token = Deno.env.get("TINY_ERP_TOKEN");
  if (!token || !tinyOrderId) return null;
  try {
    const reqBody = new URLSearchParams({ token, formato: "json", id: String(tinyOrderId) });
    const resp = await fetch(`${TINY_V2_BASE}/pedido.obter.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: reqBody.toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const pedido = json?.retorno?.pedido;
    if (!pedido) return null;
    const ent = pedido.endereco_entrega || {};
    const cli = pedido.cliente || {};
    const pick = (a: any, b: any) => (a && String(a).trim() ? a : (b ?? ""));
    const cep = pick(ent.cep, cli.cep);
    const endereco = pick(ent.endereco, cli.endereco);
    const cpf = (cli.cpf_cnpj && String(cli.cpf_cnpj).trim()) ? cli.cpf_cnpj : null;
    let shipping_address: any = null;
    if (cep || endereco) {
      shipping_address = {
        address1: endereco || "",
        address2: pick(ent.complemento, cli.complemento),
        city: pick(ent.cidade, cli.cidade),
        province: pick(ent.uf, cli.uf),
        zip: cep || "",
        country: "Brazil",
        name: pick(cli.nome, cli.fantasia),
        number: pick(ent.numero, cli.numero),
        neighborhood: pick(ent.bairro, cli.bairro),
        phone: pick(cli.fone, cli.celular),
      };
    }
    return { shipping_address, cpf };
  } catch (_e) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { order_id, beta_order_id, sale_id, company_id: forcedCompany, ambiente: forcedAmb } = body;
    if (!order_id && !beta_order_id && !sale_id) throw new Error("order_id, beta_order_id ou sale_id obrigatório");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Carrega pedido (expedition_orders) ou venda PDV (pos_sales) e normaliza
    type NormItem = { product_name: string; sku: string | null; barcode: string | null; quantity: number; unit_price: number };
    type NormOrder = {
      customer_cpf: string | null; customer_name: string | null;
      customer_phone: string | null; customer_email: string | null;
      shipping_address: any; total_shipping: number;
      discount: number;
      items: NormItem[];
      source: "order" | "sale"; source_id: string;
      store_company_id: string | null;
    };

    let order: NormOrder;
    // Para pedidos Beta sem endereço/CPF, habilita fallback on-demand no Tiny ERP.
    let betaTinyOrderId: string | null = null;
    let betaOrderRowId: string | null = null;

    if (sale_id) {
      const { data: sale, error: sErr } = await supabase
        .from("pos_sales")
        .select("id, store_id, customer_id, customer_name, customer_phone, shipping_address, discount, pos_sale_items(product_name, sku, barcode, quantity, unit_price)")
        .eq("id", sale_id).single();
      if (sErr || !sale) throw new Error(`Venda PDV não encontrada: ${sErr?.message}`);

      // Cliente: vem de pos_customers se houver customer_id, senão usa shipping_address
      let cpf: string | null = null;
      let email: string | null = null;
      let custRec: any = null;
      if ((sale as any).customer_id) {
        const { data: c } = await supabase
          .from("pos_customers")
          .select("cpf, email, address, address_number, complement, neighborhood, city, state, cep, name, whatsapp")
          .eq("id", (sale as any).customer_id).maybeSingle();
        if (c) { cpf = (c as any).cpf || null; email = (c as any).email || null; custRec = c; }
      }

      // Normaliza shipping_address (pode vir tanto do PDV {address, number, ...} quanto do checkout {address1, province, zip})
      // FONTE DA VERDADE: quando há customer_id, o cadastro vivo em pos_customers tem prioridade
      // sobre o snapshot da venda (que pode estar parcial/desatualizado — ex.: logradouro "L",
      // bairro "C"). O snapshot só preenche campos que o cadastro não tiver.
      const sa = ((sale as any).shipping_address || {}) as any;
      const pickAddr = (live: any, snap: any) => {
        const l = live != null ? String(live).trim() : "";
        return l ? l : snap;
      };
      const liveAddress1 = custRec
        ? [pickAddr(custRec.address, sa.address), pickAddr(custRec.address_number, sa.number)].filter(Boolean).join(", ")
        : null;
      const shipping_address = {
        zip: pickAddr(custRec?.cep, sa.zip || sa.cep),
        province: pickAddr(custRec?.state, sa.province || sa.state),
        city: pickAddr(custRec?.city, sa.city),
        address1: (liveAddress1 || sa.address1 || [sa.address, sa.number].filter(Boolean).join(", ")),
        address2: pickAddr(custRec?.neighborhood, sa.address2 || sa.neighborhood || sa.complement),
        number: pickAddr(custRec?.address_number, sa.number),
        neighborhood: pickAddr(custRec?.neighborhood, sa.neighborhood),
      };

      // company do store
      let storeCompanyId: string | null = null;
      if ((sale as any).store_id) {
        const { data: st } = await supabase.from("pos_stores").select("company_id").eq("id", (sale as any).store_id).maybeSingle();
        storeCompanyId = (st as any)?.company_id || null;
      }

      order = {
        customer_cpf: cpf,
        customer_name: (sale as any).customer_name || null,
        customer_phone: (sale as any).customer_phone || null,
        customer_email: email,
        shipping_address,
        total_shipping: 0,
        discount: round2(Number((sale as any).discount || 0)),
        items: ((sale as any).pos_sale_items || []).map((it: any) => ({
          product_name: it.product_name, sku: it.sku || null, barcode: it.barcode || null,
          quantity: Number(it.quantity), unit_price: Number(it.unit_price),
        })),
        source: "sale", source_id: (sale as any).id,
        store_company_id: storeCompanyId,
      };
    } else if (beta_order_id) {
      const { data: o, error: oErr } = await supabase
        .from("expedition_beta_orders")
        .select("*, expedition_beta_order_items(*)")
        .eq("id", beta_order_id).single();
      if (oErr || !o) throw new Error(`Pedido (Beta) não encontrado: ${oErr?.message}`);
      betaOrderRowId = (o as any).id;
      betaTinyOrderId = (o as any).tiny_order_id || null;
      order = {
        customer_cpf: (o as any).customer_cpf || null,
        customer_name: (o as any).customer_name || null,
        customer_phone: (o as any).customer_phone || null,
        customer_email: (o as any).customer_email || null,
        shipping_address: (o as any).shipping_address || {},
        total_shipping: Number((o as any).total_shipping || 0),
        discount: round2(Number((o as any).total_discount || 0)),
        items: ((o as any).expedition_beta_order_items || []).map((it: any) => ({
          product_name: it.product_name, sku: it.sku || null, barcode: it.barcode || null,
          quantity: Number(it.quantity), unit_price: Number(it.unit_price),
        })),
        source: "order", source_id: (o as any).id,
        store_company_id: null,
      };
    } else {
      const { data: o, error: oErr } = await supabase
        .from("expedition_orders")
        .select("*, expedition_order_items(*)")
        .eq("id", order_id).single();
      if (oErr || !o) throw new Error(`Pedido não encontrado: ${oErr?.message}`);
      order = {
        customer_cpf: (o as any).customer_cpf || null,
        customer_name: (o as any).customer_name || null,
        customer_phone: (o as any).customer_phone || null,
        customer_email: (o as any).customer_email || null,
        shipping_address: (o as any).shipping_address || {},
        total_shipping: Number((o as any).total_shipping || 0),
        discount: round2(Number((o as any).discount_total || (o as any).discount || 0)),
        items: ((o as any).expedition_order_items || []).map((it: any) => ({
          product_name: it.product_name, sku: it.sku || null, barcode: it.barcode || null,
          quantity: Number(it.quantity), unit_price: Number(it.unit_price),
        })),
        source: "order", source_id: (o as any).id,
        store_company_id: null,
      };
    }

    const items = order.items;
    if (!items.length) throw new Error("Pedido sem itens");

    // Fallback Tiny: completa endereço/CPF ausentes em pedidos Beta (sync sem endereco_entrega
    // ou pedidos do checkout-transparente). Busca on-demand no Tiny e persiste de volta para
    // reaproveitar em reemissão e geração de etiqueta.
    if (betaTinyOrderId) {
      const sa0 = (order.shipping_address || {}) as any;
      const needAddr = digits(sa0.zip ?? sa0.cep).length !== 8;
      const needCpf = digits(order.customer_cpf).length !== 11;
      if (needAddr || needCpf) {
        const td = await tinyGetOrderData(betaTinyOrderId);
        if (td) {
          if (needCpf && td.cpf) order.customer_cpf = td.cpf;
          if (needAddr && td.shipping_address) {
            const merged: any = { ...td.shipping_address };
            for (const k of Object.keys(sa0)) {
              const v = sa0[k];
              if (v !== null && v !== undefined && String(v).trim() !== "") merged[k] = v;
            }
            order.shipping_address = merged;
          }
          if (betaOrderRowId) {
            await supabase.from("expedition_beta_orders").update({
              shipping_address: order.shipping_address,
              customer_cpf: order.customer_cpf,
            }).eq("id", betaOrderRowId);
          }
        }
      }
    }

    const cpfDest = digits(order.customer_cpf);
    if (!cpfDest || cpfDest.length !== 11) throw new Error("Pedido sem CPF válido do destinatário");

    const ship = (order.shipping_address || {}) as any;
    const ufDestino = ufFromProvince(ship.province) || "MG";
    const cepDest = digits(ship.zip ?? ship.cep);
    if (!cepDest || cepDest.length !== 8) throw new Error("Pedido sem CEP válido (shipping_address.zip/cep)");
    const cidadeDest = sanitize(ship.city || "").toUpperCase();
    if (!cidadeDest) throw new Error("Pedido sem cidade no endereço");

    const split = splitStreetNumber(ship.address1);
    const logradouro = split.logradouro;
    // Prioriza o campo dedicado `number` (PDV/checkout/Tiny guardam separado do logradouro)
    const numero = (ship.number && String(ship.number).trim()) ? String(ship.number).trim() : split.numero;
    const bairro = sanitize(ship.address2 || ship.neighborhood || "Centro").slice(0, 60) || "Centro";

    // 2. Empresa (prioridade: forcedCompany > pos_stores.company_id > PILOT)
    const companyId = forcedCompany || order.store_company_id || PILOT_COMPANY_ID;
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
    let totalDesc = 0;

    // Distribui o desconto da venda proporcionalmente entre os itens (reduz base de cálculo dos
    // impostos para que o tributo incida sobre o valor efetivamente cobrado, não o de tabela).
    const descontoVenda = round2(Number(order.discount || 0));
    const somaBruta = items.reduce((acc, it) => acc + Number(it.unit_price) * Number(it.quantity), 0);
    const ratioDesc = descontoVenda > 0 && somaBruta > 0 ? descontoVenda / somaBruta : 0;

    
    for (const [idx, it] of items.entries()) {
      let prodFiscal: any = null;
      const lookupKey = it.sku || it.barcode;

      // Reúne TODAS as chaves possíveis do item (SKU/barcode do pedido + GTIN/SKU
      // do cadastro PDV), porque o item da Live pode trazer o SKU interno do Tiny
      // (ex: 15407071) enquanto o cadastro fiscal está ligado pelo GTIN (7890...).
      const candidateKeys = new Set<string>();
      if (it.sku) candidateKeys.add(String(it.sku));
      if (it.barcode) candidateKeys.add(String(it.barcode));
      let posParentSku: string | null = null;

      if (lookupKey) {
        const { data: posRows } = await supabase
          .from("pos_products")
          .select("parent_sku, sku, barcode")
          .or(`sku.eq.${lookupKey},barcode.eq.${lookupKey}`)
          .limit(10);
        for (const pr of ((posRows as any[]) || [])) {
          if (pr.parent_sku && !posParentSku) posParentSku = pr.parent_sku;
          if (pr.sku) candidateKeys.add(String(pr.sku));
          if (pr.barcode) candidateKeys.add(String(pr.barcode));
        }
      }

      // 1ª prioridade: product_master_data (cadastro central por parent_sku)
      if (posParentSku) {
        const { data: master } = await supabase
          .from("product_master_data")
          .select("ncm, origem, cest, unidade, needs_review")
          .eq("parent_sku", posParentSku)
          .maybeSingle();
        if (master && !(master as any).needs_review && (master as any).ncm) prodFiscal = master;
      }

      // 2ª prioridade (legado): product_variants -> products_master, testando todas as chaves
      if (!prodFiscal) {
        for (const k of candidateKeys) {
          const { data: variant } = await supabase
            .from("product_variants")
            .select("master_id, products_master:master_id(ncm, origem, cest, unidade)")
            .or(`sku.eq.${k},gtin.eq.${k}`)
            .maybeSingle();
          const pf = (variant as any)?.products_master;
          if (pf?.ncm) { prodFiscal = pf; break; }
        }
      }

      const ncmRaw: string | null = prodFiscal?.ncm || null;
      let ncmDigits = ncmRaw ? ncmRaw.replace(/\D/g, "") : "";
      // Correção de NCMs comuns inválidos (existem 8 dígitos mas NÃO existem na
      // tabela da Receita → SEFAZ rejeita com "NCM inexistente", cód. 778).
      const NCM_FIX: Record<string, string> = {
        "64039900": "64039990", // calçado couro "outros" — .00 não existe, válido é .90
        "64029900": "64029990",
        "23901635": "64039990", // claramente errado (cap. 23) → fallback calçado
      };
      if (NCM_FIX[ncmDigits]) ncmDigits = NCM_FIX[ncmDigits];
      // Fallback calçados de couro (64039990) — não trava a emissão quando o produto
      // não tem cadastro fiscal vinculável (mesma regra de segurança da NFC-e).
      const ncm = (ncmDigits.length === 8 ? ncmDigits : "") || "64039990";

      const { data: rule, error: rErr } = await supabase.rpc("resolve_fiscal_rule", {
        p_ncm: ncm, p_uf_origem: ufOrigem, p_uf_destino: ufDestino, p_tipo_operacao: "venda",
      });
      if (rErr || !rule) throw new Error(`Regra fiscal não encontrada para NCM ${ncm}: ${rErr?.message}`);
      const r: any = rule;

      const vTotal = round2(Number(it.unit_price) * Number(it.quantity));
      const vDesc = ratioDesc > 0 ? round2(vTotal * ratioDesc) : 0;
      const vBase = round2(vTotal - vDesc);
      totalProd += vTotal;
      totalDesc += vDesc;

      const origemFinal = prodFiscal?.origem != null ? Number(prodFiscal.origem) : Number(r.origem_mercadoria ?? 0);
      const nameUpper = sanitize(it.product_name || "").toUpperCase();
      const isAccessory = /\b(BOLSA|CARTEIRA|CINTO|MOCHILA|PULSEIRA|COLAR|BRINCO|RELOGIO|OCULOS|CHAVEIRO|LENCO|MEIA|NECESSAIRE|POCHETE)\b/.test(nameUpper);
      const unidadeFinal = (prodFiscal?.unidade && String(prodFiscal.unidade).trim()) || (isAccessory ? "UN" : "PAR");

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
        ...(vDesc > 0 ? { ValorDesconto: vDesc } : {}),
        Origem: origemFinal,
        CEST: prodFiscal?.cest || undefined,
        Imposto: {
          ICMS: {
            CodSituacaoTributaria: String(r.csosn_icms || r.cst_icms || "102"),
            AliquotaICMS: Number(r.aliq_icms || 0),
            BaseCalculo: vBase,
            ValorIcms: round2(vBase * Number(r.aliq_icms || 0) / 100),
          },
          PIS:    { CodSituacaoTributaria: String(r.cst_pis || "07"),    Aliquota: Number(r.aliq_pis || 0),    BaseCalculo: vBase },
          COFINS: { CodSituacaoTributaria: String(r.cst_cofins || "07"), Aliquota: Number(r.aliq_cofins || 0), BaseCalculo: vBase },
          IPI:    { CodSituacaoTributaria: "53", CodEnquadramento: "999", Aliquota: 0 },
        },
      });
    }

    // (NCM agora tem fallback 64039990 por item — não há mais bloqueio por NCM ausente.)


    // 5. Frete — RATEADO POR ITEM (ValorFrete em cada Produto).
    // ⚠️ A API BrasilNFe NÃO possui campo ValorFrete em nível de nota: o frete só
    // entra no total da nota (vNF da SEFAZ) quando é informado dentro de cada produto.
    // Sem ratear, o pagamento (que inclui frete) fica MAIOR que o total da nota →
    // rejeição "Ausência de troco quando o valor dos pagamentos for maior que o total".
    const vFrete = round2(Number(order.total_shipping || 0));
    if (vFrete > 0 && produtos.length > 0) {
      const baseSoma = produtos.reduce((acc, p) => acc + Number(p.ValorTotal || 0), 0);
      let distribuido = 0;
      produtos.forEach((p, i) => {
        let parcela: number;
        if (i === produtos.length - 1) {
          parcela = round2(vFrete - distribuido); // sobra no último item para fechar exato
        } else {
          parcela = baseSoma > 0 ? round2(vFrete * (Number(p.ValorTotal || 0) / baseSoma)) : 0;
          distribuido = round2(distribuido + parcela);
        }
        if (parcela > 0) p.ValorFrete = parcela;
      });
    }
    const valorTotalNota = round2(totalProd - totalDesc + vFrete);

    // 6. Cria registro pendente
    const { data: doc, error: dErr } = await supabase.from("fiscal_documents").insert({
      company_id: companyId,
      order_id: order.source === "order" ? order.source_id : null,
      pos_sale_id: order.source === "sale" ? order.source_id : null,
      modelo: 55, serie: 1,
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
      IdentificadorInterno: order.source === "sale" ? `NFE-POS-${order.source_id}` : `NFE-${order.source_id}`,
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
        Endereco: {
          Cep: cepDest,
          Logradouro: sanitize(logradouro).slice(0, 60) || "S/N",
          Numero: sanitize(numero).slice(0, 10) || "S/N",
          Bairro: bairro,
          ...(ibgeDest ? { CodMunicipio: ibgeDest } : {}),
          Municipio: sanitize(ship.city || "").slice(0, 60),
          Uf: ufDestino,
          CodPais: 1058,
          Pais: "BRASIL",
        },
        Contato: {
          ...(order.customer_phone ? { Telefone: digits(order.customer_phone) } : {}),
          ...(order.customer_email ? { Email: order.customer_email } : {}),
        },
      },
      Produtos: produtos,
      // Frete vai RATEADO dentro de cada Produto (ValorFrete por item) — ver bloco de rateio acima.
      // Não existe ValorFrete em nível de nota na API BrasilNFe.
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

    // BrasilNFe retorna XML e PDF como base64 — decodificar e persistir
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
          // Detecta PDF (%PDF) vs HTML (BrasilNFe devolve DANFCe NFC-e em HTML)
          const isPdf = fileBytes[0] === 0x25 && fileBytes[1] === 0x50 && fileBytes[2] === 0x44 && fileBytes[3] === 0x46;
          const ext = isPdf ? "pdf" : "html";
          const ctype = isPdf ? "application/pdf" : "text/html; charset=utf-8";
          const path = `danfe/${chave}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("fiscal-documents")
            .upload(path, fileBytes, { contentType: ctype, upsert: true });
          if (!upErr) {
            if (isPdf) {
              // Private bucket: customer-shareable long-lived signed URL (10 years)
              const { data: signed } = await supabase.storage
                .from("fiscal-documents").createSignedUrl(path, 315360000);
              danfeUrl = signed?.signedUrl || danfeUrl;
            } else {
              // HTML DANFE renders via fiscal-render-document (service-role download)
              const { data: pub } = supabase.storage.from("fiscal-documents").getPublicUrl(path);
              danfeUrl = buildRenderableDanfeUrl(pub?.publicUrl || danfeUrl);
            }
          }
        }
      } catch (e) {
        console.error("[nfe-emitir] base64 decode/upload error", e);
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
