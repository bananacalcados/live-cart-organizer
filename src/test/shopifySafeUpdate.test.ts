import { describe, expect, it } from "vitest";
import { exactColor, planVariants, productData, resolveOptionInputs } from "../../supabase/functions/update-master-product-shopify/safe-update";

const product = {
  options: [
    { id: "cor", name: "Cor", linkedMetafield: { namespace: "shopify", key: "color-pattern" }, optionValues: [{ id: "preto", name: "Preto", linkedMetafieldValue: "meta-preto" }] },
    { id: "tam", name: "Tamanho", optionValues: [34, 35, 36, 37, 38, 39].map((size) => ({ id: `tam-${size}`, name: String(size) })) },
  ],
  variants: { nodes: [] as any[] },
};
const white = [34, 35, 36, 37, 38, 39].map((size) => ({ id: `local-${size}`, color: "Branco", size: String(size), sku: `ALO-B-${size}`, gtin: `123${size}` }));
describe("Shopify data updates", () => {
  it("never includes media even with empty local photos or replacement photos", () => {
    for (const images of [[], ["https://example.com/new.jpg"]]) {
      const data = productData({ name: "Alo", is_active: true, images });
      expect(Object.keys(data).sort()).toEqual(["descriptionHtml", "productType", "status", "title", "vendor"]);
      expect(data).not.toHaveProperty("images");
      expect(data).not.toHaveProperty("media");
    }
  });
  it("plans six white sizes with one linked color addition", () => {
    const plan = planVariants(white, product, [{ id: "meta-branco", displayName: "Branco" }]);
    expect(plan.create).toHaveLength(6);
    expect(plan.additions).toEqual([{ optionId: "cor", gid: "meta-branco" }]);
    const options = [{ name: "Cor", optionValues: [{ id: "branco", linkedMetafieldValue: "meta-branco" }] }, product.options[1]];
    expect(resolveOptionInputs(plan.create[0].input.optionValues, options)).toEqual([{ optionName: "Cor", id: "branco" }, { optionName: "Tamanho", id: "tam-34" }]);
  });
  it("rejects absent or ambiguous patterns, without a similar color fallback", () => {
    expect(() => exactColor([{ id: "off", displayName: "Off White" }], "Branco")).toThrow();
    expect(() => exactColor([{ id: "a", displayName: "Branco" }, { id: "b", displayName: "Branco" }], "Branco")).toThrow();
  });
  it("retry finds the six existing variants and creates zero duplicates", () => {
    const existing = white.map((v) => ({ id: `gid://shopify/ProductVariant/${v.size}`, barcode: v.gtin, inventoryItem: { sku: v.sku }, selectedOptions: [{ name: "Cor", value: "Branco" }, { name: "Tamanho", value: v.size }] }));
    const plan = planVariants(white, { ...product, variants: { nodes: existing } }, [{ id: "meta-branco", displayName: "Branco" }]);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(6);
    expect(plan.links).toHaveLength(6);
  });
  it("does not claim an existing combination belonging to another SKU and GTIN", () => {
    const existing = { id: "gid://shopify/ProductVariant/999", barcode: "other", inventoryItem: { sku: "other" }, selectedOptions: [{ name: "Cor", value: "Branco" }, { name: "Tamanho", value: "34" }] };
    expect(() => planVariants([white[0]], { ...product, variants: { nodes: [existing] } }, [{ id: "meta-branco", displayName: "Branco" }])).toThrow("outro código");
  });
  it("preserves legacy color names on explicitly linked variants", () => {
    const existing = { id: "gid://shopify/ProductVariant/12", selectedOptions: [{ name: "Cor", value: "Preto" }, { name: "Tamanho", value: "34" }] };
    const plan = planVariants([{ ...white[0], color: "Preto / Original", shopify_variant_id: "12" }], { ...product, variants: { nodes: [existing] } }, []);
    expect(plan.create).toHaveLength(0);
    expect(plan.update[0].id).toBe(existing.id);
    expect(plan.additions).toHaveLength(0);
  });
});