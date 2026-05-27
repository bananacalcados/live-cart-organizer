import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FinanceHub } from "@/components/management/FinanceHub";

vi.mock("@/components/management/BankReconciliation", () => ({
  BankReconciliation: () => <div>Conciliação mock</div>,
}));

vi.mock("@/components/management/CashFlowDashboard", () => ({
  CashFlowDashboard: () => <div data-testid="cashflow-dashboard">Dashboard mock</div>,
}));

vi.mock("@/components/management/CashFlowByCategory", () => ({
  CashFlowByCategory: () => <div data-testid="cashflow-by-category">ByCategory mock</div>,
}));

vi.mock("@/components/management/CategoriesManager", () => ({
  CategoriesManager: () => <div>Categorias mock</div>,
}));

vi.mock("@/components/management/BankAccountsManager", () => ({
  BankAccountsManager: () => <div>Contas mock</div>,
}));

vi.mock("@/components/management/PaymentFeesManager", () => ({
  PaymentFeesManager: () => <div>Taxas mock</div>,
}));

vi.mock("@/components/management/FinancialAgentSettings", () => ({
  FinancialAgentSettings: () => <div>Agente mock</div>,
}));

describe("FinanceHub tabs", () => {
  it("mantém a aba Lançamentos ligada ao componente com edição", () => {
    render(<FinanceHub stores={[]} />);

    expect(screen.getByTestId("cashflow-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("cashflow-by-category")).not.toBeInTheDocument();

    screen.getByRole("tab", { name: /Lançamentos/i }).click();

    expect(screen.getByTestId("cashflow-by-category")).toBeInTheDocument();
    expect(screen.queryByTestId("cashflow-dashboard")).not.toBeInTheDocument();
  });
});