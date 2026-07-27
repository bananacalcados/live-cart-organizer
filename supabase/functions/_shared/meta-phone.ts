/**
 * Normalização de telefone BR para a Meta CAPI (E.164 sem "+").
 *
 * Regras (padrão do projeto):
 *  - só dígitos
 *  - injeta DDI 55 quando ausente
 *  - injeta o 9º dígito em celulares antigos (55 + DDD + 8 dígitos começando com 6-9)
 *  - retorna "" quando o número não é utilizável (sem DDD, curto demais, etc.)
 *
 * A Meta hasheia o valor exatamente como enviado: "31988887777" e "5531988887777"
 * geram hashes diferentes e NÃO casam. Por isso o formato precisa ser único.
 */
export function normalizeMetaPhone(raw: string | null | undefined): string {
  let d = String(raw ?? "").replace(/[^0-9]/g, "");
  if (!d) return "";

  // Remove zeros/DDI duplicados no início (ex.: "005531...", "5555 31...")
  d = d.replace(/^0+/, "");
  while (d.length > 13 && d.startsWith("55")) d = d.slice(2);

  // Sem DDI: 10 (fixo) ou 11 (celular) dígitos -> prefixa 55
  if (d.length === 10 || d.length === 11) d = "55" + d;

  if (!d.startsWith("55")) {
    // Número internacional já em E.164 — mantém como veio se tiver tamanho plausível
    return d.length >= 11 && d.length <= 15 ? d : "";
  }

  const rest = d.slice(2); // DDD + número
  if (rest.length < 10 || rest.length > 11) return "";

  const ddd = rest.slice(0, 2);
  let num = rest.slice(2);

  // Celular antigo (8 dígitos iniciando em 6-9) -> injeta o 9
  if (num.length === 8 && /^[6-9]/.test(num)) num = "9" + num;

  if (num.length !== 8 && num.length !== 9) return "";
  if (!/^[1-9][0-9]$/.test(ddd)) return "";

  return "55" + ddd + num;
}

/** true quando o telefone é utilizável para casamento na Meta. */
export function isMetaPhoneUsable(raw: string | null | undefined): boolean {
  return normalizeMetaPhone(raw).length >= 12;
}
