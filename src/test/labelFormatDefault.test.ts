import { describe, it, expect, beforeEach } from "vitest";
import { loadLabelFormat, loadLabelSheet } from "@/components/inventory/ProductLabelPrintDialog";

const FORMAT_KEY = "label-format-v1";

describe("formato padrão de etiqueta", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sem nada salvo usa o Carta de 30", () => {
    expect(loadLabelFormat()).toBe("letter30");
    expect(loadLabelSheet().id).toBe("letter30");
  });

  it("quem já escolheu mantém a escolha", () => {
    localStorage.setItem(FORMAT_KEY, "a4");
    expect(loadLabelFormat()).toBe("a4");
    expect(loadLabelSheet().id).toBe("a4");
    localStorage.setItem(FORMAT_KEY, "old");
    expect(loadLabelFormat()).toBe("old");
    expect(loadLabelSheet().id).toBe("a4");
  });
});
