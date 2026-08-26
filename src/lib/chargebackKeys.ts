// Chave de identidade de telefone usada pelos chargebacks (espelha
// public.automation_phone_key no banco): DDD + últimos 8 dígitos.
export function chargebackPhoneKey(raw?: string | null): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return d.slice(0, 2) + d.slice(-8);
  return d.length >= 8 ? d.slice(-8) : null;
}

export function phoneSuffix8(raw?: string | null): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : null;
}

export function cpfDigits(raw?: string | null): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length === 11 ? d : null;
}
