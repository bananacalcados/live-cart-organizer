// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StepPayment } from "@/components/checkout/PaymentSection";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => ({ data: { success: true, gateway: "mercadopago" }, error: null })) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }) }) }),
} }));
vi.mock("@/lib/mercadopago", () => ({ initMercadoPago: async () => false, tokenizeCardMP: async () => null, getCardCapabilities: async () => null }));
vi.mock("@/lib/metaPixel", () => ({ trackPixelEvent: vi.fn() }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); invoke.mockClear(); });

describe("pagamento com armazenamento bloqueado no navegador", () => {
  it("envia uma única tentativa de cartão mesmo quando o navegador bloqueia salvar e apagar a sessão", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    render(<StepPayment orderId="storage-blocked" amount={100} products={[]}
      form={{ fullName: "Cliente Teste", email: "teste@example.com", cpf: "12345678900", whatsapp: "33999990000", cep: "35051520", address: "Rua Teste", addressNumber: "1", complement: "", neighborhood: "Centro", city: "Governador Valadares", state: "MG" }}
      installmentConfig={{ max_installments: 6, interest_free_installments: 6, monthly_interest_rate: 0 }}
      preselectedInstallments={1} onPaymentConfirmed={vi.fn()} />);
    fireEvent.click(screen.getByText("Cartão de crédito"));
    fireEvent.change(screen.getByPlaceholderText("JOÃO SILVA"), { target: { value: "Cliente Teste" } });
    fireEvent.change(screen.getByPlaceholderText("0000 0000 0000 0000"), { target: { value: "4111111111111111" } });
    fireEvent.change(screen.getByPlaceholderText("MM/AA"), { target: { value: "12/30" } });
    fireEvent.change(screen.getByPlaceholderText("123"), { target: { value: "123" } });
    fireEvent.click(await screen.findByRole("button", { name: /CLIQUE AQUI PARA CONCLUIR PAGAMENTO/i }));
    await waitFor(() => expect(invoke.mock.calls.filter(([name]) => name === "pagarme-create-charge")).toHaveLength(1));
  });
});