import { describe, expect, it } from "vitest";
import { enabledCatalogVariants, inventoryCheckedItems } from "../../supabase/functions/_shared/catalog-availability";

describe("disponibilidade manual do catálogo", () => {
  it("pagamento não consulta estoque do catálogo e preserva outros itens do pedido", () => {
    const catalog = { catalog_product_id: "bolsa", sku: "sem-estoque" };
    const regular = { catalog_product_id: null, sku: "pedido-manual" };
    expect(inventoryCheckedItems([catalog, regular])).toEqual([regular]);
  });
  it("bolsa habilitada continua vendável com estoque zero", () => {
    const bag = { variant_id: "bolsa", enabled: true, stock: 0, availableForSale: false };
    expect(enabledCatalogVariants([bag])).toEqual([bag]);
  });
  it("Spezial 40 aparece sem estoque e 34 desligado não aparece", () => {
    const variants = [
      { variant_id: "34", enabled: false, stock: 10 },
      { variant_id: "40", enabled: true, stock: 0 },
    ];
    expect(enabledCatalogVariants(variants).map((v) => v.variant_id)).toEqual(["40"]);
  });
  it("seleção de checkout recusa variante desligada e aceita habilitada sem estoque", () => {
    const variants = enabledCatalogVariants([
      { variant_id: "34", enabled: false, stock: 20 },
      { variant_id: "40", enabled: true, stock: -1 },
    ]);
    expect(variants.find((v) => v.variant_id === "34")).toBeUndefined();
    expect(variants.find((v) => v.variant_id === "40")?.variant_id).toBe("40");
  });
});