import { describe, expect, it } from "vitest";
import { buildPushPlan, matchCreatedVariant, resolvePushOptionInputs } from "../../supabase/functions/push-color-to-shopify/plan";

const sizeOption = {
  id: "tam",
  name: "Tamanho",
  optionValues: [34, 35, 36, 37, 38, 39].map((size) => ({ id: `tam-${size}`, name: String(size) })),
};
const colorOption = { id: "cor", name: "Cor", optionValues: [{ id: "preto", name: "Preto" }] };
const product = { options: [colorOption, sizeOption], variants: { nodes: [] as any[] } };
const perolado = [34, 35, 36, 37, 38, 39].map((size) => ({
  id: `local-${size}`,
  color: "Perolado",
  size: String(size),
  sku: `100289-PEROLADO-${size}`,
  gtin: `78900000000${size}`,
  shopify_variant_id: null,
}));

describe("envio de cor para a Shopify", () => {
  it("planeja os seis tamanhos do T235 sem mídia nem quantidade", () => {
    const plan = buildPushPlan(perolado, product, 359.99);
    expect(plan.create).toHaveLength(6);
    expect(plan.create[0].input).toEqual({
      barcode: "7890000000034",
      price: "359.99",
      inventoryItem: { sku: "100289-PEROLADO-34", tracked: true },
      optionValues: [{ optionName: "Cor", name: "Perolado" }, { optionName: "Tamanho", id: "tam-34" }],
    });
    expect(plan.create[0].input).not.toHaveProperty("media");
    expect(plan.create[0].input).not.toHaveProperty("mediaSrc");
    expect(plan.create[0].input).not.toHaveProperty("inventoryQuantities");
  });

  it("aceita produto somente com opção de cor", () => {
    const bag = { options: [colorOption], variants: { nodes: [] } };
    const plan = buildPushPlan([{ ...perolado[0], size: null }], bag, 299.9);
    expect(plan.create[0].input.optionValues).toEqual([{ optionName: "Cor", name: "Perolado" }]);
  });

  it("reaproveita por SKU sem criar duplicado", () => {
    const existing = {
      id: "gid://shopify/ProductVariant/123",
      barcode: "outro",
      inventoryItem: { sku: "100289-PEROLADO-34" },
      selectedOptions: [{ name: "Cor", value: "Perolado" }, { name: "Tamanho", value: "34" }],
    };
    const plan = buildPushPlan([perolado[0]], { ...product, variants: { nodes: [existing] } }, 359.99);
    expect(plan.create).toHaveLength(0);
    expect(plan.links).toEqual([{ variant_id: "local-34", shopify_variant_id: "123" }]);
  });

  it("não toma uma combinação que já pertence a outro SKU/GTIN", () => {
    const existing = {
      id: "gid://shopify/ProductVariant/999",
      barcode: "outro",
      inventoryItem: { sku: "OUTRO-SKU" },
      selectedOptions: [{ name: "Cor", value: "Perolado" }, { name: "Tamanho", value: "34" }],
    };
    expect(() => buildPushPlan([perolado[0]], { ...product, variants: { nodes: [existing] } }, 359.99)).toThrow("outro SKU/GTIN");
  });

  it("resolve cor taxonômica exata antes da criação", () => {
    const linkedProduct = {
      options: [{ ...colorOption, linkedMetafield: { namespace: "shopify", key: "color-pattern" }, optionValues: [] }, sizeOption],
      variants: { nodes: [] },
    };
    const plan = buildPushPlan([perolado[0]], linkedProduct, 359.99, [{ id: "meta-perolado", displayName: "Perolado" }]);
    expect(plan.additions).toEqual([{ optionId: "cor", gid: "meta-perolado" }]);
    const updatedOptions = [{ ...linkedProduct.options[0], optionValues: [{ id: "perolado", name: "Perolado", linkedMetafieldValue: "meta-perolado" }] }, sizeOption];
    expect(resolvePushOptionInputs(plan.create[0].input.optionValues, updatedOptions)).toEqual([
      { optionName: "Cor", id: "perolado" },
      { optionName: "Tamanho", id: "tam-34" },
    ]);
  });

  it("reconcilia o retorno por SKU, nunca pela posição", () => {
    const created = { id: "gid://shopify/ProductVariant/555", inventoryItem: { sku: perolado[1].sku }, barcode: "diferente" };
    const matched = matchCreatedVariant(created, [{ owner: perolado[0] }, { owner: perolado[1] }]);
    expect(matched.owner.id).toBe("local-35");
  });
});
