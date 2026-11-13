import { describe, expect, it } from "vitest";
import {
  buildStockLabelItems,
  fillableLabelQuantity,
  isExpiredLabelCount,
  previewStockAfter,
} from "@/lib/labels/stockLabelBatch";

describe("lote de etiquetas com estoque", () => {
  it("distingue campo vazio de zero digitado no balanço das células preenchidas", () => {
    expect(buildStockLabelItems(["vazia", "zero", "doze"], { vazia: "", zero: "0", doze: "12" }, "balance", "selected"))
      .toEqual([{ variant_id: "zero", qty: 0 }, { variant_id: "doze", qty: 12 }]);
  });

  it("transforma em zero somente as células vazias do balanço do produto inteiro", () => {
    expect(buildStockLabelItems(["vazia", "preenchida"], { vazia: "", preenchida: "3" }, "balance", "product"))
      .toEqual([{ variant_id: "vazia", qty: 0 }, { variant_id: "preenchida", qty: 3 }]);
    expect(buildStockLabelItems(["vazia"], { vazia: "" }, "add", "selected")).toEqual([]);
  });

  it("mostra a prévia do balanço descontando os vendidos que aguardam envio", () => {
    expect(previewStockAfter("balance", 8, 2, 10)).toBe(8);
    expect(previewStockAfter("add", 8, 2, 3)).toBe(11);
    expect(fillableLabelQuantity(8, 2)).toBe(10);
    expect(fillableLabelQuantity(-3, 1)).toBe(0);
  });

  it("reconhece a contagem expirada para atualizar o saldo sem aplicar o lote", () => {
    expect(isExpiredLabelCount("Contagem expirada: abra a etiqueta novamente")).toBe(true);
    expect(isExpiredLabelCount("outro erro")).toBe(false);
  });
});
