// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AustpayTestPage from "@/pages/AustpayTestPage";
import { maskCardExpiry, maskCardNumber, maskCpf } from "@/lib/formatMasks";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue({ data: { approved: false }, error: null }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
afterEach(() => { cleanup(); invoke.mockClear(); });

it("separa a validade digitada como 0633 em mês e ano", () => {
  expect(maskCardExpiry("0633")).toBe("06/33");
});
it("separa os grupos do CPF", () => {
  expect(maskCpf("12345678900")).toBe("123.456.789-00");
});
it("separa os grupos do cartão", () => {
  expect(maskCardNumber("4111111111111111")).toBe("4111 1111 1111 1111");
});
it("envia os números sem pontuação e a validade separada para o pagamento", async () => {
  render(<MemoryRouter><AustpayTestPage /></MemoryRouter>);
  for (const [label, value] of [["Nome como no cartão", "Cliente Teste"], ["CPF", "12345678900"], ["Número do cartão", "4111111111111111"], ["Validade (mês/ano)", "0633"], ["CVV", "123"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Pagar R$ 50,00" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(invoke.mock.calls[0][1].body).toMatchObject({ cpf: "12345678900", card: { number: "4111111111111111", expMonth: "06", expYear: "33", cvv: "123" } });
});