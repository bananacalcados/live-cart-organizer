// Leitura do endereço da Shopify (tema BR):
// - address1 = "Rua X, 123, Casa" / "Rua 58 230 Ap 1603" → rua, número e resto (complemento)
// - address2 = BAIRRO (não é complemento)
// - company  = CPF (quando só tem dígitos) — nunca é bairro
const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export function parseShopifyAddress(addr: any, noteNumber?: string | null, noteComplement?: string | null, noteNeighborhood?: string | null) {
  const raw = String(addr?.address1 || "").trim();
  let street: string | null = raw || null;
  let number: string | null = null;
  let extra = "";
  const NUM = /^(?:n[ºo°.]?\s*)?(\d+[A-Za-z]?|s\/?n)$/i;
  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2 && NUM.test(parts[1])) {
    street = parts[0];
    number = parts[1].match(NUM)![1];
    extra = parts.slice(2).join(", ");
  } else {
    // Sem vírgula: "Rua 58 230 Ap 1603" → rua "Rua 58", nº 230. Um número colado
    // em uma única palavra ("Caminho 4", "Rua 58") é nome da rua, não número.
    const toks = raw.split(/\s+/);
    for (let k = 1; k < toks.length; k++) {
      const t = toks[k].replace(/[,;]$/, "");
      if (!NUM.test(t)) continue;
      if (k === 1) continue;
      street = toks.slice(0, k).join(" ").replace(/[,\s]+$/, "");
      number = t.match(NUM)![1];
      extra = toks.slice(k + 1).join(" ").replace(/^[-–,\s]+/, "");
      break;
    }
  }
  const address2 = String(addr?.address2 || "").trim();
  const company = String(addr?.company || "").trim();
  const companyIsDoc = company && /^[\d.\-\/\s]+$/.test(company) && onlyDigits(company).length >= 11;
  const neighborhood = (noteNeighborhood || "").trim() || address2 || (!companyIsDoc && company ? company : "") || null;
  const complement = [extra, (noteComplement || "").trim()].filter(Boolean).join(" - ") || null;
  return {
    street,
    number: number || (noteNumber || "").trim() || null,
    complement,
    neighborhood,
    cpfFromCompany: companyIsDoc && onlyDigits(company).length === 11 ? onlyDigits(company) : null,
  };
}
