/**
 * Gera um código EAN-13 com prefixo 789 (Brasil) e dígito verificador válido.
 * Usado para preview no client; o GTIN definitivo é gerado pelo banco.
 */
export function generateEan13(prefix = "789"): string {
  const random = Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, "0");
  const base = (prefix + random).slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(base[i], 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return base + check.toString();
}

/** Valida um EAN-13. */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(code[i], 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(code[12], 10);
}

/** Normaliza cor para slug curto usado em SKU (ex: "Preto Brilhante" → "PRTBRILHANTE"). */
export function normalizeColorForSku(color: string): string {
  return (color || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 10) || "UN";
}
