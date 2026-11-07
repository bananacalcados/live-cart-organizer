import { describe, expect, it } from "vitest";
import { codeIntentDirectConfirmBlocked } from "@/lib/liveCodeOrder";

describe("bloqueio da confirmação direta Por código", () => {
  it("bloqueia aviso contendo 'não disponível na Shopify'", () => {
    expect(codeIntentDirectConfirmBlocked([{ size: "37", warnings: ["código A097 não disponível na Shopify: color_missing"] }])).toBe(true);
  });

  it("bloqueia aviso contendo 'não está na Shopify'", () => {
    expect(codeIntentDirectConfirmBlocked([{ size: "37", warnings: ["tamanho 37 não está na Shopify"] }])).toBe(true);
  });

  it("bloqueia aviso contendo 'não existe nessa cor'", () => {
    expect(codeIntentDirectConfirmBlocked([{ size: "37", warnings: ["tamanho 37 não existe nessa cor"] }])).toBe(true);
  });

  it("bloqueia item com tamanho nulo", () => {
    expect(codeIntentDirectConfirmBlocked([{ size: null, warnings: [] }])).toBe(true);
  });

  it("não bloqueia outros avisos quando o tamanho está preenchido", () => {
    expect(codeIntentDirectConfirmBlocked([{ size: "37", warnings: ["sem estoque"] }])).toBe(false);
  });
});
