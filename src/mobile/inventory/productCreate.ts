import { isValidColor, isValidSize } from "@/lib/variantValidation";
import { normalizeVariantOverride } from "@/lib/variantPriceOverride";

/** Mesmos padrões do formulário "Novo produto" do computador (ProductMasterForm). */
export const DESKTOP_DEFAULTS = { ncm: "64039900", cest: "", weight: "0.8", height: "12", width: "32", length: "22", origem: "0", unidade: "UN" };

export const SIZE_GRIDS: { label: string; sizes: string[] }[] = [
  { label: "33–39", sizes: ["33", "34", "35", "36", "37", "38", "39"] },
  { label: "34–39", sizes: ["34", "35", "36", "37", "38", "39"] },
  { label: "34–40", sizes: ["34", "35", "36", "37", "38", "39", "40"] },
  { label: "35–40", sizes: ["35", "36", "37", "38", "39", "40"] },
  { label: "PP–GG", sizes: ["PP", "P", "M", "G", "GG"] },
  { label: "Único", sizes: ["ÚNICO"] },
];
/** Tamanhos oferecidos para marcar um a um (o usuário também pode digitar outro). */
export const SIZE_CHOICES = ["33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "PP", "P", "M", "G", "GG", "ÚNICO"];

export interface VariantDraft {
  color: string; size: string; qty: string;
  cost?: string; sale?: string; weight?: string; sku?: string; gtin?: string;
}
export interface MasterDraft {
  name: string; description: string; brand: string; category: string; categoryId: string; gender: string;
  ncm: string; cest: string; costPrice: string; salePrice: string; weight: string; height: string; width: string; length: string;
}
export const emptyMaster = (): MasterDraft => ({
  name: "", description: "", brand: "", category: "", categoryId: "", gender: "",
  ncm: DESKTOP_DEFAULTS.ncm, cest: DESKTOP_DEFAULTS.cest, costPrice: "", salePrice: "",
  weight: DESKTOP_DEFAULTS.weight, height: DESKTOP_DEFAULTS.height, width: DESKTOP_DEFAULTS.width, length: DESKTOP_DEFAULTS.length,
});

export const comboKey = (color: string, size: string) =>
  `${color.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase()}|${size.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()}`;

/** Cruza cores × tamanhos; o que já existe no produto volta marcado como existente. */
export function buildCombos(colors: string[], sizes: string[], existing: { color: string | null; size: string | null }[] = []) {
  const have = new Set(existing.map((e) => comboKey(e.color || "", e.size || "")));
  const seen = new Set<string>();
  const out: { color: string; size: string; exists: boolean }[] = [];
  for (const c of colors) for (const s of sizes) {
    const k = comboKey(c, s);
    if (!c.trim() || !s.trim() || seen.has(k)) continue;
    seen.add(k);
    out.push({ color: c.trim(), size: s.trim(), exists: have.has(k) });
  }
  return out;
}

export const parseQty = (q: string | undefined) => { const n = Math.floor(Number((q || "").replace(",", "."))); return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 0; };
export const stepQty = (q: string | undefined, d: number) => { const n = parseQty(q) + d; return n <= 0 ? "" : String(n); };

/** Mesmas validações do computador (nome, loja, cor/tamanho). Devolve a primeira mensagem de erro. */
export function validateCreate(m: MasterDraft, storeId: string, variants: VariantDraft[]): string | null {
  if (!m.name.trim()) return "Informe o nome do produto.";
  if (!storeId) return "Escolha a loja que receberá o estoque inicial.";
  if (!variants.length) return "Adicione pelo menos uma variação.";
  for (const v of variants) {
    if (!v.color || !v.size) return "Todas as variações precisam de cor e tamanho.";
    if (!isValidSize(v.size)) return `Tamanho inválido: "${v.size}". Use números (39, 34/35) ou PP/P/M/G/GG.`;
    if (!isValidColor(v.color)) return `Cor inválida: "${v.color}". Cor não pode ser apenas números.`;
  }
  return null;
}

/** Avisos do que o PDV / nota marcam como "revisar" (mesma regra do envio ao PDV do computador). */
export function fiscalWarnings(m: MasterDraft): string[] {
  const w: string[] = [];
  if (m.ncm.replace(/\D/g, "").length !== 8) w.push("NCM precisa ter 8 dígitos");
  if (!(parseFloat(m.costPrice) > 0)) w.push("Custo ausente");
  if (!(parseFloat(m.salePrice) > 0)) w.push("Preço de venda ausente");
  return w;
}

/** Mesmo formato que o computador envia para create_product_with_variants. */
export function masterPayload(m: MasterDraft) {
  return {
    name: m.name.trim(), description: m.description, brand: m.brand.trim(), category: m.category, category_id: m.categoryId || "",
    ncm: m.ncm, cest: m.cest, cost_price: parseFloat(m.costPrice) || 0, sale_price: parseFloat(m.salePrice) || 0,
    weight_kg: m.weight, height_cm: m.height, width_cm: m.width, length_cm: m.length, images: [], is_active: true,
  };
}
export function variantsPayload(vs: VariantDraft[], parentCost: string, parentSale: string) {
  return vs.map((v) => ({
    color: v.color.trim(), size: v.size.trim(),
    cost_price_override: normalizeVariantOverride(v.cost, parseFloat(parentCost))?.toString(),
    sale_price_override: normalizeVariantOverride(v.sale, parseFloat(parentSale))?.toString(),
    weight_kg_override: v.weight?.trim() || undefined,
    sku: v.sku?.trim() || undefined, gtin: v.gtin?.trim() || undefined,
    initial_stock: parseQty(v.qty), is_active: true,
  }));
}

/** "NOME_DUPLICADO:<id>" vindo do servidor. */
export function duplicateIdFrom(message: string | undefined): string | null {
  const m = /NOME_DUPLICADO:([0-9a-f-]{36})/i.exec(message || "");
  return m ? m[1] : null;
}

export interface CreatedVariant { id: string; color: string; size: string; code: string; qty: number }
/** Uma etiqueta por par lançado. */
export function labelQuantities(vs: CreatedVariant[]) {
  return Object.fromEntries(vs.filter((v) => v.qty > 0).map((v) => [v.id, v.qty]));
}
export const totalPairs = (vs: CreatedVariant[]) => vs.reduce((a, v) => a + (v.qty > 0 ? v.qty : 0), 0);

/** Chave de equivalência de dicionário: sem acento, maiúscula, espaços; "34-35" = "34/35". */
export const dictKey = (v: string) =>
  (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "").replace(/[-\\]/g, "/");

/** Procura no dicionário um item equivalente ao texto digitado. */
export function findEquivalent(list: string[], typed: string): string | null {
  const k = dictKey(typed);
  if (!k) return null;
  return list.find((x) => dictKey(x) === k) ?? null;
}

/** Remove repetições de escrita (mantém a primeira). */
export function uniqueByKey(list: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const raw of list) { const x = (raw || "").trim(); const k = dictKey(x); if (!k || seen.has(k)) continue; seen.add(k); out.push(x); }
  return out;
}

const LETTER_ORDER = ["pp", "p", "m", "g", "gg", "xg", "xgg", "eg", "egg", "g1", "g2", "g3", "unico"];
/** Ordem natural: 33, 33/34, 34, 35, 35/36 … depois PP, P, M, G, GG, Único e demais. */
export function sortSizes(list: string[]): string[] {
  const rank = (s: string): [number, number, number, string] => {
    const k = dictKey(s);
    const m = /^(\d+(?:[.,]\d+)?)(?:\/(\d+(?:[.,]\d+)?))?$/.exec(k);
    if (m) return [0, parseFloat(m[1].replace(",", ".")), m[2] ? parseFloat(m[2].replace(",", ".")) : -1, k];
    const li = LETTER_ORDER.indexOf(k);
    return li >= 0 ? [1, li, 0, k] : [2, 0, 0, k];
  };
  return [...list].sort((a, b) => {
    const x = rank(a), y = rank(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
    return x[3].localeCompare(y[3]);
  });
}

/** Atalho de grade: marca só os tamanhos que existem no dicionário (com a escrita do dicionário). */
export function gridPreselect(dict: string[], grid: string[]): string[] {
  return grid.map((g) => findEquivalent(dict, g)).filter((x): x is string => !!x);
}
