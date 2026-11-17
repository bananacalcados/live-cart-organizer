import { supabase } from "@/integrations/supabase/client";

export interface InventoryStockCountItem {
  id: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  counted_quantity: number;
}

export interface ResolvedStockCode {
  variant_id: string;
  code: string;
  variant_sku: string | null;
  variant_gtin: string | null;
  color: string | null;
  size: string | null;
  master_name: string | null;
  pos_product_id: string | null;
  tiny_id: number | null;
  product_name: string | null;
  product_variant: string | null;
  product_sku: string | null;
  product_barcode: string | null;
  stock: number | null;
}

const NEW_STOCK_CODE_PATTERN = /^[A-Za-z]{1,3}\d{1,5}-[A-Za-z0-9.]+$/;

export function isNewStockLabelCode(code: string): boolean {
  return NEW_STOCK_CODE_PATTERN.test(code.trim());
}

export function findCountedItemByScannedCode<T extends Pick<InventoryStockCountItem, "barcode" | "sku">>(
  items: T[],
  code: string,
): T | undefined {
  return items.find((item) => item.barcode === code || item.sku === code);
}

export function findCountedItemForResolvedCode<T extends Pick<InventoryStockCountItem, "product_id" | "barcode" | "sku">>(
  items: T[],
  resolved: ResolvedStockCode,
): T | undefined {
  const productId = resolved.tiny_id == null ? null : String(resolved.tiny_id);
  const productCodes = [resolved.product_barcode, resolved.product_sku].filter(Boolean);
  return items.find((item) =>
    (productId !== null && item.product_id === productId) ||
    productCodes.some((code) => item.barcode === code || item.sku === code)
  );
}

export async function resolveStockLabelCode(code: string, storeId: string): Promise<ResolvedStockCode | null> {
  if (!isNewStockLabelCode(code)) return null;
  const { data, error } = await (supabase.rpc as any)("resolve_stock_code", {
    p_code: code,
    p_store_id: storeId,
  });
  if (error) throw error;
  if (Array.isArray(data)) return (data[0] as ResolvedStockCode | undefined) ?? null;
  return (data as ResolvedStockCode | null) ?? null;
}

export function stockCodeCloneLookup(resolved: ResolvedStockCode | null, originalCode: string): string {
  return resolved?.variant_gtin || resolved?.variant_sku || originalCode;
}

export async function incrementInventoryCountItem<T extends Pick<InventoryStockCountItem, "id" | "counted_quantity">>(
  item: T,
  quantity: number,
): Promise<{ quantity: number; error: any }> {
  const newQuantity = item.counted_quantity + quantity;
  const { error } = await supabase
    .from("inventory_count_items")
    .update({ counted_quantity: newQuantity })
    .eq("id", item.id);
  return { quantity: newQuantity, error };
}

export async function addResolvedStockCodeToCount(
  countId: string,
  items: InventoryStockCountItem[],
  resolved: ResolvedStockCode,
  quantity: number,
): Promise<{ productName: string; quantity: number; inserted: boolean; error: any }> {
  const baseName = resolved.product_name || resolved.master_name || resolved.code;
  const productName = baseName + (resolved.product_variant ? ` - ${resolved.product_variant}` : "");
  const existing = findCountedItemForResolvedCode(items, resolved);

  if (existing) {
    const result = await incrementInventoryCountItem(existing, quantity);
    return { productName, quantity: result.quantity, inserted: false, error: result.error };
  }

  const { error } = await supabase.from("inventory_count_items").insert({
    count_id: countId,
    product_id: String(resolved.tiny_id ?? resolved.pos_product_id),
    product_name: productName,
    sku: resolved.product_sku,
    barcode: resolved.product_barcode,
    counted_quantity: quantity,
  });
  return { productName, quantity, inserted: true, error };
}
