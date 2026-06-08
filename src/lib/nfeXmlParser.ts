/**
 * Parser de NF-e (modelo 55, layout 4.00) para extrair dados
 * de fornecedor, itens, totais e duplicatas (parcelas).
 */

export interface NfeItem {
  line_number?: number;
  supplier_product_code?: string;
  description: string;
  ncm?: string;
  cfop?: string;
  unit?: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  ean?: string;
  parsed_color?: string;
  parsed_size?: string;
  raw?: any;
}

export interface NfeInstallment {
  installment_number: number;
  due_date: string; // YYYY-MM-DD
  amount: number;
}

export interface ParsedNfe {
  nfe_key?: string;
  invoice_number?: string;
  invoice_series?: string;
  emission_date?: string;
  supplier_name?: string;
  supplier_cnpj?: string;
  supplier_ie?: string;
  supplier_address?: any;
  total_value: number;
  total_products: number;
  total_taxes: number;
  total_freight: number;
  total_discount: number;
  payment_method?: string;
  items: NfeItem[];
  installments: NfeInstallment[];
}

function pickText(node: Element | null | undefined, tag: string): string | undefined {
  if (!node) return undefined;
  const el = node.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() || undefined;
}

function pickNumber(node: Element | null | undefined, tag: string): number {
  const v = pickText(node, tag);
  if (!v) return 0;
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

/** Tenta extrair cor e tamanho do nome do produto (ex: "TÊNIS NIKE PRETO 39"). */
function extractColorSize(desc: string): { color?: string; size?: string } {
  if (!desc) return {};
  const sizeMatch = desc.match(/\b(2[5-9]|3\d|4[0-6])\b/);
  const size = sizeMatch ? sizeMatch[1] : undefined;

  const colorWords = [
    "preto", "branco", "azul", "vermelho", "verde", "amarelo", "rosa",
    "cinza", "marrom", "bege", "roxo", "lilas", "lilás", "laranja",
    "nude", "off", "marinho", "vinho", "caramelo", "dourado", "prata",
  ];
  const lower = desc.toLowerCase();
  const found = colorWords.find((c) => lower.includes(c));
  return { size, color: found ? found.toUpperCase() : undefined };
}

export function parseNfeXml(xmlString: string): ParsedNfe {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");

  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error("XML inválido: " + parserError.textContent);
  }

  const infNFe = doc.getElementsByTagName("infNFe")[0];
  if (!infNFe) {
    throw new Error("XML não contém infNFe (não é uma NF-e válida).");
  }

  const ide = infNFe.getElementsByTagName("ide")[0];
  const emit = infNFe.getElementsByTagName("emit")[0];
  const total = infNFe.getElementsByTagName("total")[0];
  const icmsTot = total?.getElementsByTagName("ICMSTot")[0];
  const cobr = infNFe.getElementsByTagName("cobr")[0];
  const enderEmit = emit?.getElementsByTagName("enderEmit")[0];

  const nfeKey = (infNFe.getAttribute("Id") || "").replace(/^NFe/, "");

  // Itens
  const dets = Array.from(infNFe.getElementsByTagName("det"));
  const items: NfeItem[] = dets.map((det, idx) => {
    const prod = det.getElementsByTagName("prod")[0];
    const description = pickText(prod, "xProd") || "";
    const cs = extractColorSize(description);
    const nItem = parseInt(det.getAttribute("nItem") || "", 10);
    return {
      line_number: Number.isFinite(nItem) && nItem > 0 ? nItem : idx + 1,
      supplier_product_code: pickText(prod, "cProd"),
      description,
      ncm: pickText(prod, "NCM"),
      cfop: pickText(prod, "CFOP"),
      unit: pickText(prod, "uCom") || "UN",
      quantity: pickNumber(prod, "qCom"),
      unit_cost: pickNumber(prod, "vUnCom"),
      total_cost: pickNumber(prod, "vProd"),
      ean: pickText(prod, "cEAN") !== "SEM GTIN" ? pickText(prod, "cEAN") : undefined,
      parsed_color: cs.color,
      parsed_size: cs.size,
    };
  });

  // Parcelas (duplicatas)
  const dups = cobr ? Array.from(cobr.getElementsByTagName("dup")) : [];
  const installments: NfeInstallment[] = dups.map((dup, idx) => ({
    installment_number: idx + 1,
    due_date: pickText(dup, "dVenc") || new Date().toISOString().slice(0, 10),
    amount: pickNumber(dup, "vDup"),
  }));

  // Forma de pagamento
  const pag = infNFe.getElementsByTagName("pag")[0];
  const tPag = pag ? pickText(pag, "tPag") : undefined;
  const paymentMap: Record<string, string> = {
    "01": "Dinheiro", "02": "Cheque", "03": "Cartão de Crédito",
    "04": "Cartão de Débito", "05": "Crédito Loja", "10": "Vale Alimentação",
    "11": "Vale Refeição", "12": "Vale Presente", "13": "Vale Combustível",
    "15": "Boleto Bancário", "16": "Depósito Bancário", "17": "PIX",
    "18": "Transferência Bancária", "19": "Programa de Fidelidade",
    "90": "Sem Pagamento", "99": "Outros",
  };

  // Endereço emitente
  const supplier_address = enderEmit
    ? {
        logradouro: pickText(enderEmit, "xLgr"),
        numero: pickText(enderEmit, "nro"),
        complemento: pickText(enderEmit, "xCpl"),
        bairro: pickText(enderEmit, "xBairro"),
        municipio: pickText(enderEmit, "xMun"),
        uf: pickText(enderEmit, "UF"),
        cep: pickText(enderEmit, "CEP"),
      }
    : undefined;

  return {
    nfe_key: nfeKey || undefined,
    invoice_number: pickText(ide, "nNF"),
    invoice_series: pickText(ide, "serie"),
    emission_date: pickText(ide, "dhEmi") || pickText(ide, "dEmi"),
    supplier_name: pickText(emit, "xNome"),
    supplier_cnpj: pickText(emit, "CNPJ") || pickText(emit, "CPF"),
    supplier_ie: pickText(emit, "IE"),
    supplier_address,
    total_value: pickNumber(icmsTot, "vNF"),
    total_products: pickNumber(icmsTot, "vProd"),
    total_taxes: pickNumber(icmsTot, "vTotTrib") || pickNumber(icmsTot, "vICMS"),
    total_freight: pickNumber(icmsTot, "vFrete"),
    total_discount: pickNumber(icmsTot, "vDesc"),
    payment_method: tPag ? paymentMap[tPag] || tPag : undefined,
    items,
    installments,
  };
}
