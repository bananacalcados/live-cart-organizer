import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { decideDevolucao } from "../../supabase/functions/_shared/devolucao-guard";
import { findOverlappingExchange } from "@/lib/pos/newExchange";

const rev = { id: "nf-rev", status: "authorized", valor_total: 359.99, numero: 101, chave_acesso: "x", reusable: true };

describe("trava de NF-e de devolução", () => {
  it("reversa com NF + conferência de mesmo valor: reaproveita, não emite", () => {
    expect(decideDevolucao({ valorNovo: 359.99, valorOriginal: 359.99, existentes: [rev] })).toMatchObject({ action: "reuse", doc: { id: "nf-rev" } });
  });
  it("NF existente com valor diferente: bloqueia", () => {
    const d = decideDevolucao({ valorNovo: 200, valorOriginal: 359.99, existentes: [rev] });
    expect(d).toMatchObject({ action: "block", reason: "divergente" });
  });
  it("duas devoluções somando mais que a original: bloqueia", () => {
    const outra = { ...rev, reusable: false };
    expect(decideDevolucao({ valorNovo: 359.99, valorOriginal: 359.99, existentes: [outra] })).toMatchObject({ action: "block", reason: "excede" });
    expect(decideDevolucao({ valorNovo: 100, valorOriginal: 100, existentes: [{ ...outra, valor_total: 100 }] })).toMatchObject({ reason: "excede" });
  });
  it("devolução parcial dentro do valor original: emite", () => {
    expect(decideDevolucao({ valorNovo: 150, valorOriginal: 359.99, existentes: [{ ...rev, valor_total: 200, reusable: false }] }).action).toBe("emit");
  });
  it("segunda troca aberta com o mesmo item bloqueia; item diferente passa", () => {
    const abertas = [{ id: "t1", codigo_devolucao: "TD-2026-000050", trocas_devolucoes_itens: [{ direcao: "devolvido", sku: "A1", barcode: "789" }] }];
    expect(findOverlappingExchange(abertas, [{ sku: "A1" }])).toBe("TD-2026-000050");
    expect(findOverlappingExchange(abertas, [{ sku: "B2", barcode: "111" }])).toBeNull();
  });
});
