import { describe, expect, it } from "vitest";
import {
  nextPromotionCopyName,
  planPromotionLinks,
  promotionCopyPayload,
} from "@/lib/livePromotionImport";

const source = {
  name: "3 por 200",
  shopify_collection_handle: null,
  shopify_product_ids: ["gid://shopify/Product/1", "2"],
  tiers: [{ qty: 1, price: 99.99 }, { qty: 3, price: 199.99 }],
  free_shipping: true,
  blocks_cashback: true,
  is_active: true,
};

describe("importação de promoções progressivas", () => {
  it("copia faixas, produtos, frete, cashback e status para a live atual sem mudar a original", () => {
    const before = JSON.stringify(source);
    const copy = promotionCopyPayload(source, "live-nova");

    expect(copy).toEqual({
      event_id: "live-nova",
      name: "3 por 200",
      shopify_collection_handle: null,
      shopify_product_ids: ["1", "2"],
      tiers: [{ qty: 1, price: 99.99 }, { qty: 3, price: 199.99 }],
      free_shipping: true,
      blocks_cashback: true,
      is_active: true,
    });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("criar outra usa um nome livre e não substitui a promoção existente", () => {
    expect(nextPromotionCopyName("3 por 200", ["3 por 200"])).toBe("3 por 200 (cópia)");
    expect(nextPromotionCopyName("3 por 200", ["3 por 200", "3 por 200 (cópia)"])).toBe("3 por 200 (cópia 2)");
  });

  it("vincula catálogo e cross-sell e separa os produtos ausentes nesta live", () => {
    const plan = planPromotionLinks(
      "nova-promocao",
      ["1", "2", "3"],
      [{ id: "cat-1", shopify_product_id: "gid://shopify/Product/1", promotion_id: null }],
      [{ id: "xs-2", shopify_product_id: "2", promotion_id: "outra" }],
    );

    expect(plan.catalogIds).toEqual(["cat-1"]);
    expect(plan.crosssellIds).toEqual(["xs-2"]);
    expect(plan.linkedCount).toBe(2);
    expect(plan.missingProductIds).toEqual(["3"]);
  });

  it("ao substituir, desfaz somente os vínculos antigos que saíram da lista", () => {
    const plan = planPromotionLinks(
      "promocao-atual",
      ["1"],
      [
        { id: "mantem", shopify_product_id: "1", promotion_id: "promocao-atual" },
        { id: "remove", shopify_product_id: "2", promotion_id: "promocao-atual" },
        { id: "nao-toca", shopify_product_id: "3", promotion_id: "outra" },
      ],
      [],
    );

    expect(plan.catalogIds).toEqual([]);
    expect(plan.catalogOffIds).toEqual(["remove"]);
    expect(plan.crosssellOffIds).toEqual([]);
  });
});
