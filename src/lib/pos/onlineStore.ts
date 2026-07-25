// A loja "Site/Live" é 100% online: as vendas de lives/site não pertencem a
// nenhuma vendedora humana. Por isso nunca atribuímos atendente/vendedora a
// pedidos dessa loja (nem por link, nem pelo atendimento do WhatsApp).
const ONLINE_ONLY_STORE_PATTERNS = [
  /^site\s*\/\s*live$/i,
  /^site\s*e\s*live$/i,
  /^site\s*\+\s*live$/i,
  /^live\s*\/\s*site$/i,
];

export function isOnlineOnlyStore(name?: string | null): boolean {
  const n = (name || "").trim();
  if (!n) return false;
  return ONLINE_ONLY_STORE_PATTERNS.some((re) => re.test(n));
}
