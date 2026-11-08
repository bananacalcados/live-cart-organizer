// Availability is configured by staff, never derived from physical inventory.
export function enabledCatalogVariants<T extends { enabled?: boolean }>(variants: T[] | null | undefined): T[] {
  return Array.isArray(variants) ? variants.filter((variant) => variant.enabled === true) : [];
}