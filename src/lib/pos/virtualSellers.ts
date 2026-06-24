// Vendedores "virtuais" são canais de atribuição (não pessoas reais):
// "Live Shopping", "Loja", "Loja física", etc. Eles existem para vincular
// vendas de live/loja física, mas NÃO devem ser tratados como vendedoras no
// sistema de tarefas/lembretes/disparos (não têm WhatsApp pessoal e não
// recebem cobranças de tarefa).
const VIRTUAL_SELLER_PATTERNS = [
  /^live\s*shopping$/i,
  /^vendedor[a]?\s*live$/i,
  /^live$/i,
  /^loja$/i,
  /^loja\s*f[ií]sica$/i,
  /^loja\s*online$/i,
];

export function isVirtualSeller(name?: string | null): boolean {
  const n = (name || "").trim();
  if (!n) return false;
  return VIRTUAL_SELLER_PATTERNS.some((re) => re.test(n));
}
