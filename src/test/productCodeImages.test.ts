import { describe, expect, it } from "vitest";
import { buildCodeImageMap, normalizeImageColor } from "@/lib/productCodeImages";

const rows = [
  { shopify_product_id: "p1", option_color: "Branco Off", image_url: "https://img/branco-off.jpg" },
  { shopify_product_id: "p1", option_color: "Preto", image_url: "https://img/preto.jpg" },
  { shopify_product_id: "p2", option_color: "Dourado", image_url: "https://img/dourado.jpg" },
  { shopify_product_id: "p3", option_color: "Rosa", image_url: "   " },
  { shopify_product_id: "p4", option_color: "Vinho", image_url: null },
];

describe("buildCodeImageMap", () => {
  it("usa a foto da cor quando a cor bate", () => {
    const map = buildCodeImageMap(
      [{ code: "T128", color: "Preto", shopify_product_id: "p1" }],
      rows,
    );
    expect(map.get("T128")).toBe("https://img/preto.jpg");
  });

  it("tolera acento, caixa e hífen na cor", () => {
    const map = buildCodeImageMap(
      [{ code: "T127", color: "BRANCO-OFF ", shopify_product_id: "p1" }],
      rows,
    );
    expect(map.get("T127")).toBe("https://img/branco-off.jpg");
  });

  it("cai para a foto do produto quando a cor não existe no espelho", () => {
    const map = buildCodeImageMap(
      [{ code: "T130", color: "Cru", shopify_product_id: "p2" }],
      rows,
    );
    expect(map.get("T130")).toBe("https://img/dourado.jpg");
  });

  it("não devolve foto sem produto Shopify, sem linha ou com URL vazia", () => {
    const map = buildCodeImageMap(
      [
        { code: "T200", color: "Preto", shopify_product_id: null },
        { code: "T201", color: "Preto", shopify_product_id: "p9" },
        { code: "T202", color: "Rosa", shopify_product_id: "p3" },
        { code: "T203", color: "Vinho", shopify_product_id: "p4" },
      ],
      rows,
    );
    expect(map.size).toBe(0);
  });

  it("normaliza cor tirando acentos, espaços e hífens", () => {
    expect(normalizeImageColor("  Pérola  ")).toBe("perola");
    expect(normalizeImageColor("Branco Off")).toBe(normalizeImageColor("branco-off"));
    expect(normalizeImageColor(null)).toBe("");
  });
});
