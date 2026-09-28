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
  const m = raw.match(/^(.*?[A-Za-zÀ-ú.])[,\s]+(?:n[ºo°.]?\s*)?(\d+[A-Za-z]?|s\/?n)\b[,\s\-–]*(.*)$/i);
  if (m) {
    street = m[1].replace(/[,\s]+$/, "").trim();
    number = m[2];
    extra = (m[3] || "").trim();
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
