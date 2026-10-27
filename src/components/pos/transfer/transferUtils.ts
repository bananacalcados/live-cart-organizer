// Lojas reais que podem transferir entre si (ativas e fora de simulação).
export const REAL_STORES = [
  { id: "4ade7b44-5043-4ab1-a124-7a6ab5468e29", name: "Loja Centro" },
  { id: "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2", name: "Loja Perola" },
  { id: "2bd2c08d-321c-47ee-98a9-e27e936818ab", name: "Site/Live" },
] as const;

export interface TransferLine {
  pos_product_id: string;
  name: string;
  size: string | null;
  color: string | null;
  sku: string;
  barcode: string;
  image_url: string | null;
  quantity: number;
  origin_stock: number;
  dest_stock: number;
}

export interface TransferItemResult {
  pos_product_id_origem: string;
  pos_product_id_destino: string;
  barcode: string; sku: string; name: string; size: string | null; color: string | null;
  quantity: number; origem_antes: number; origem_depois: number; destino_antes: number; destino_depois: number;
}

export interface TransferResult {
  id: string; numero: number; label: string;
  from_store_id: string; to_store_id: string;
  created_at: string; created_by_name: string | null; total_items: number;
  items: TransferItemResult[];
}

export const draftKey = (storeId: string) => `pos-transfer-draft:${storeId}`;
export const destKey = (storeId: string) => `pos-transfer-dest:${storeId}`;
export const transferLabel = (numero: number) => `T-${String(numero).padStart(6, "0")}`;

export function linesTotals(lines: TransferLine[]) {
  return {
    count: lines.length,
    pairs: lines.reduce((s, l) => s + l.quantity, 0),
    hasError: lines.some((l) => l.quantity < 1 || l.quantity > l.origin_stock),
  };
}

export function buildReceiptText(t: TransferResult, storeName: (id: string) => string) {
  const head = `Transferência ${transferLabel(t.numero)} — ${new Date(t.created_at).toLocaleString("pt-BR")}\n${storeName(t.from_store_id)} → ${storeName(t.to_store_id)} · por ${t.created_by_name || "-"}`;
  const body = t.items.map((i) => `${i.quantity}× ${i.name} tam ${i.size || "-"} (${i.barcode || i.sku}) | ${storeName(t.from_store_id)} ${i.origem_antes}→${i.origem_depois} | ${storeName(t.to_store_id)} ${i.destino_antes}→${i.destino_depois}`).join("\n");
  return `${head}\n${body}\nTotal: ${t.total_items} pares`;
}
