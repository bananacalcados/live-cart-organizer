// Máscaras visuais para facilitar a leitura dos dados do cliente.
export const digitsOnly = (v?: string | null) => String(v ?? "").replace(/\D/g, "");

/** 150.231.397-94 */
export function maskCpf(value?: string | null): string {
  const d = digitsOnly(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** 35.051-520 */
export function maskCep(value?: string | null): string {
  const d = digitsOnly(value).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}-${d.slice(5)}`;
}

/**
 * (33) 9.9195-5003 — aceita número com ou sem DDI 55.
 * Mantém o DDI visível quando for número internacional.
 */
export function maskPhoneBR(value?: string | null): string {
  let d = digitsOnly(value);
  let prefix = "";
  if (d.startsWith("55") && d.length > 11) {
    prefix = "+55 ";
    d = d.slice(2);
  }
  d = d.slice(0, 11);
  if (d.length <= 2) return prefix + d;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `${prefix}(${ddd}) ${rest}`;
  if (rest.length <= 8) return `${prefix}(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `${prefix}(${ddd}) ${rest.slice(0, 1)}.${rest.slice(1, 5)}-${rest.slice(5)}`;
}
