// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SplitPaymentPanel } from "@/components/checkout/SplitPaymentPanel";

const { invoke, tokenize } = vi.hoisted(() => ({
  invoke: vi.fn(async ({ body }: { body: Record<string, unknown> }) => ({ data: body.action === "get" ? {
    enabled: true, parts: [
      { id: "paid-pix", seq: 1, method: "pix", amount: 200, charge_amount: 190, discount_amount: 10, installments: 1, status: "approved" },
      { id: "pending-card", seq: 2, method: "credit", amount: 259.99, charge_amount: 259.99, discount_amount: 0, installments: 6, status: "pending" },
    ],
  } : { success: true }, error: null })),
  tokenize: vi.fn(async () => ({ mpCardToken: "fake-token", mpPaymentMethodId: "visa" })),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (_name: string, args: { body: Record<string, unknown> }) => invoke(args) } } }));
vi.mock("@/lib/mercadopago", () => ({ initMercadoPago: async () => true, tokenizeCardMP: tokenize }));
beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function open() {
  render(<SplitPaymentPanel orderId="order-test" total={459.99}
    form={{ fullName: "Cliente Teste", email: "teste@example.com", cpf: "12345678900" }} onPaid={vi.fn()}>
    <span>Pagamento integral</span>
  </SplitPaymentPanel>);
  await screen.findByPlaceholderText("Número do cartão");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
}

describe("Cartão do saldo dividido", () => {
  it("aceita validade digitada 1230 e envia só R$ 259,99 em duas parcelas, preservando o Pix pago", async () => {
    await open();
    fireEvent.change(screen.getByPlaceholderText("Número do cartão"), { target: { value: "4111111111111111" } });
    fireEvent.change(screen.getByPlaceholderText("Nome impresso no cartão"), { target: { value: "Cliente Teste" } });
    fireEvent.change(screen.getByPlaceholderText("MM/AA"), { target: { value: "1230" } });
    fireEvent.change(screen.getByPlaceholderText("CVV"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: /Pagar 2x/ }));
    await waitFor(() => expect(tokenize).toHaveBeenCalledWith(expect.objectContaining({ number: "4111111111111111", expMonth: "12", expYear: "2030" }), "credit"));
    expect(invoke).toHaveBeenCalledWith({ body: expect.objectContaining({ action: "charge_card", splitId: "pending-card", installments: 2 }) });
    expect(invoke.mock.calls.filter(([arg]) => arg.body.action === "charge_card")).toHaveLength(1);
  });

  it("lê preenchimento automático visível mesmo sem evento de mudança", async () => {
    await open();
    const values = { "Número do cartão": "4111111111111111", "Nome impresso no cartão": "Cliente Teste", "MM/AA": "1230", "CVV": "123" };
    for (const [placeholder, value] of Object.entries(values)) {
      const input = screen.getByPlaceholderText(placeholder) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    }
    fireEvent.click(screen.getByRole("button", { name: /Pagar 2x/ }));
    await waitFor(() => expect(tokenize).toHaveBeenCalledWith(expect.objectContaining({ expYear: "2030", holderName: "Cliente Teste" }), "credit"));
  });

  it("bloqueia mês inválido antes de tokenizar ou cobrar", async () => {
    await open();
    fireEvent.change(screen.getByPlaceholderText("Número do cartão"), { target: { value: "4111111111111111" } });
    fireEvent.change(screen.getByPlaceholderText("Nome impresso no cartão"), { target: { value: "Cliente Teste" } });
    fireEvent.change(screen.getByPlaceholderText("MM/AA"), { target: { value: "1330" } });
    fireEvent.change(screen.getByPlaceholderText("CVV"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: /Pagar 2x/ }));
    expect(tokenize).not.toHaveBeenCalled();
    expect(invoke.mock.calls.filter(([arg]) => arg.body.action === "charge_card")).toHaveLength(0);
  });
});