import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { decideDevolucao, mesmaDevolucaoConferida, podeReutilizarNotaDeOutraTroca } from "../../supabase/functions/_shared/devolucao-guard";
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

  const retorno = [{ direcao: "devolvido", estado_estoque: "retornado_vendavel", sku: "100392-MARROM-36", barcode: "789", quantidade: 1 }];
  const outraTd = { id: "td-antiga", devolucao_doc_id: "nf-3247", status: "concluida", pedido_original_id: "venda", trocas_devolucoes_itens: retorno };
  const reutilizacao = { trocaAtualId: "td-nova", pedidoOriginalId: "venda", documentoId: "nf-3247", itensAtuais: retorno, outra: outraTd };

  it("devolução nova reutiliza a NF de troca encerrada com exatamente o mesmo retorno", () => {
    expect(mesmaDevolucaoConferida(retorno, [...retorno].reverse())).toBe(true);
    expect(podeReutilizarNotaDeOutraTroca(reutilizacao)).toBe(true);
    expect(decideDevolucao({ valorNovo: 259.99, valorOriginal: 259.99, existentes: [{ ...rev, id: "nf-3247", valor_total: 259.99, reusable: true }] }).action).toBe("reuse");
  });
  it("não reutiliza NF para item, quantidade, venda ou TD aberta diferente", () => {
    expect(podeReutilizarNotaDeOutraTroca({ ...reutilizacao, itensAtuais: [{ ...retorno[0], sku: "OUTRO-37" }] })).toBe(false);
    expect(podeReutilizarNotaDeOutraTroca({ ...reutilizacao, itensAtuais: [{ ...retorno[0], quantidade: 2 }] })).toBe(false);
    expect(podeReutilizarNotaDeOutraTroca({ ...reutilizacao, pedidoOriginalId: "outra-venda" })).toBe(false);
    expect(podeReutilizarNotaDeOutraTroca({ ...reutilizacao, outra: { ...outraTd, status: "aguardando_retorno" } })).toBe(false);
  });
  it("sem SKU e código de barras não presume que duas devoluções são iguais", () => {
    const semIdentidade = [{ ...retorno[0], sku: null, barcode: null }];
    expect(mesmaDevolucaoConferida(semIdentidade, semIdentidade)).toBe(false);
  });
});
