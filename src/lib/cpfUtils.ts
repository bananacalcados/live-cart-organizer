// Validação de CPF (dígitos verificadores) — usada antes de emitir NF-e,
// pois a SEFAZ rejeita com "Rejeição 237: CPF do destinatário inválido".
export function onlyDigitsCpf(v?: string | null): string {
  return String(v ?? "").replace(/\D/g, "");
}

export function isValidCpf(value?: string | null): boolean {
  const cpf = onlyDigitsCpf(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function formatCpf(value?: string | null): string {
  const cpf = onlyDigitsCpf(value).slice(0, 11);
  return cpf
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}
