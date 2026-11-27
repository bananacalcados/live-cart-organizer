import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const rpc = vi.fn();
const toastOk = vi.fn();
const toastErr = vi.fn();
const exchange = {
  id: "td-1",
  codigo_devolucao: "TD-TESTE",
  tipo: "troca",
  status: "recebido_conferencia",
  pedido_novo_id: "replacement-1",
  voucher_id: null,
  gateway_refund_id: null,
  created_at: "2026-11-27T12:00:00Z",
  diferenca_venda_id: "difference-1",
  trocas_devolucoes_itens: [
    { direcao: "devolvido", sku: "OLD", produto_nome: "Produto antigo", quantidade: 1, valor_unitario: 100 },
    { direcao: "reposicao", sku: "NEW", produto_nome: "Produto novo", quantidade: 1, valor_unitario: 140 },
  ],
};
const differenceSale = { id: "difference-1", status: "online_pending", total: 40, store_id: "store-1", payment_gateway: "store-checkout" };

function from(table: string) {
  if (table === "trocas_devolucoes") {
    return {
      select: () => ({
        eq: () => ({
          in: () => ({
            in: () => ({ order: () => ({ limit: async () => ({ data: [exchange], error: null }) }) }),
          }),
        }),
      }),
    };
  }
  if (table === "correios_reverse_shipments") {
    return {
      select: () => ({
        eq: () => ({
          not: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
        }),
      }),
    };
  }
  if (table === "pos_sales") {
    return {
      select: (columns: string) => columns.includes("payment_gateway")
        ? { in: async () => ({ data: [differenceSale], error: null }) }
        : { eq: () => ({ maybeSingle: async () => ({ data: { store_id: "store-1", stock_source_store_id: "store-1", customer_cep: "35000000" }, error: null }) }) },
    };
  }
  throw new Error(`Tabela não simulada: ${table}`);
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => from(table),
    rpc: (...args: any[]) => rpc(...args),
  },
}));
vi.mock("sonner", () => ({ toast: { success: (m: string) => toastOk(m), error: (m: string) => toastErr(m) } }));
vi.mock("@/hooks/useExchangeRegistry", () => ({ invalidateExchangeRegistry: vi.fn() }));
vi.mock("../POSTinyProductPicker", () => ({ POSTinyProductPicker: () => null }));
vi.mock("../ConvertExchangeToReturnDialog", () => ({ ConvertExchangeToReturnDialog: () => null }));
vi.mock("../ConvertReturnToExchangeDialog", () => ({ ConvertReturnToExchangeDialog: () => null }));

import { ExchangeInProgressCard } from "../ExchangeInProgressCard";

describe("Confirmar diferença recebida por fora", () => {
  beforeEach(() => {
    cleanup();
    rpc.mockReset();
    toastOk.mockReset();
    toastErr.mockReset();
  });

  it("abre a confirmação e chama a regra do servidor sem enviar valor", async () => {
    rpc.mockResolvedValue({ data: { ok: true, total: 40 }, error: null });
    const onChanged = vi.fn();
    render(<ExchangeInProgressCard saleId="sale-1" onChanged={onChanged} />);

    await screen.findByText(/Link aguardando pagamento/);
    const openButton = screen.getByRole("button", { name: /Marcar pago por fora/ });
    fireEvent.click(openButton);
    fireEvent.change(screen.getByPlaceholderText("CNPJ, CPF, e-mail ou outra chave"), { target: { value: "pix-da-loja" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirmar pagamento/ }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("exchange_mark_difference_paid", {
      p_troca_id: "td-1",
      p_method: "PIX",
      p_pix_key: "pix-da-loja",
      p_installments: 1,
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_total");
    expect(toastOk).toHaveBeenCalledWith("Diferença de R$ 40.00 marcada como paga por fora.");
  });

  it("mantém a janela aberta e não recarrega quando o servidor recusa", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "O valor da troca mudou" } });
    const onChanged = vi.fn();
    render(<ExchangeInProgressCard saleId="sale-1" onChanged={onChanged} />);

    await screen.findByText(/Link aguardando pagamento/);
    fireEvent.click(screen.getByRole("button", { name: /Marcar pago por fora/ }));
    fireEvent.change(screen.getByPlaceholderText("CNPJ, CPF, e-mail ou outra chave"), { target: { value: "pix-da-loja" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirmar pagamento/ }));

    await waitFor(() => expect(toastErr).toHaveBeenCalledWith("O valor da troca mudou"));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Confirmar pagamento/ })).toBeTruthy();
  });
});
