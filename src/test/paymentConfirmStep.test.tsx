// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { StepPayment, type CustomerFormData, type InstallmentConfig } from "@/components/checkout/PaymentSection";

const form: CustomerFormData = {
  fullName: "Maria Aparecida da Silva",
  email: "maria@teste.com",
  cpf: "123.456.789-00",
  whatsapp: "(33) 99999-0000",
  cep: "35000-000",
  address: "Rua Teste",
  addressNumber: "100",
  complement: "",
  neighborhood: "Centro",
  city: "Valadares",
  state: "MG",
};

const config: InstallmentConfig = {
  max_installments: 6,
  interest_free_installments: 6,
  monthly_interest_rate: 0,
};

function fillCard() {
  fireEvent.change(screen.getByLabelText(/nome no cartão/i), { target: { value: "Maria A Silva" } });
  fireEvent.change(screen.getByLabelText(/número do cartão/i), { target: { value: "4111111111111111" } });
  fireEvent.change(screen.getByLabelText(/validade/i), { target: { value: "12/30" } });
  fireEvent.change(screen.getByLabelText(/cvv/i), { target: { value: "123" } });
}

beforeEach(() => {
  cleanup();
});

describe("Etapa final de pagamento (botão CLIQUE AQUI PARA CONCLUIR PAGAMENTO)", () => {
  it("cartão de crédito: mostra o resumo com o botão gigante quando tudo está preenchido", async () => {
    render(
      <StepPayment
        orderId="teste-1"
        amount={430}
        products={[]}
        form={form}
        installmentConfig={config}
        onPaymentConfirmed={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Cartão de crédito"));
    await waitFor(() => screen.getByLabelText(/nome no cartão/i));

    // Antes de completar: botão pede as parcelas, sem o resumo.
    expect(screen.queryByText(/falta só apertar o botão/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Selecione as parcelas/i })).toBeInTheDocument();

    fillCard();
    fireEvent.change(screen.getByLabelText(/parcelas/i), { target: { value: "3" } });

    // Resumo aparece com a frase final e o valor das parcelas.
    expect(await screen.findByText(/falta só apertar o botão/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CLIQUE AQUI PARA CONCLUIR PAGAMENTO/i })).toBeInTheDocument();
    expect(screen.getByText(/3x de R\$ /i)).toBeInTheDocument();
    // Campos escondidos no resumo, mas recuperáveis.
    expect(screen.queryByLabelText(/nome no cartão/i)).not.toBeInTheDocument();
  });

  it("cartão de débito: à vista, resumo aparece ao completar os campos", async () => {
    render(
      <StepPayment
        orderId="teste-2"
        amount={430}
        products={[]}
        form={form}
        installmentConfig={config}
        onPaymentConfirmed={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Cartão de débito"));
    await waitFor(() => screen.getByLabelText(/nome no cartão/i));

    fillCard();

    expect(await screen.findByText(/falta só apertar o botão/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CLIQUE AQUI PARA CONCLUIR PAGAMENTO/i })).toBeInTheDocument();
    expect(screen.getByText(/à vista/i)).toBeInTheDocument();
  });

  it("Editar dados do cartão volta ao formulário mantendo o botão com a frase final", async () => {
    render(
      <StepPayment
        orderId="teste-3"
        amount={430}
        products={[]}
        form={form}
        installmentConfig={config}
        onPaymentConfirmed={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Cartão de débito"));
    await waitFor(() => screen.getByLabelText(/nome no cartão/i));
    fillCard();
    fireEvent.click(await screen.findByText(/editar dados do cartão/i));

    // Formulário volta visível, com botão verde e a mesma frase final.
    expect(screen.getByLabelText(/nome no cartão/i)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /CLIQUE AQUI PARA CONCLUIR PAGAMENTO/i });
    expect(btn).toBeInTheDocument();
  });
});
