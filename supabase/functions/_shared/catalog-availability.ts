// Availability is configured by staff, never derived from physical inventory.
export function enabledCatalogVariants<T extends { enabled?: boolean }>(variants: T[] | null | undefined): T[] {
  return Array.isArray(variants) ? variants.filter((variant) => variant.enabled === true) : [];
}

export function inventoryCheckedItems<T extends { catalog_product_id?: string | null }>(items: T[]): T[] {
  return items.filter((item) => !item.catalog_product_id);
}