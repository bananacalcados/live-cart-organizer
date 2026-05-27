import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FinanceHub } from "@/components/management/FinanceHub";

vi.mock("@/components/ui/tabs", () => {
  const TabsContext = React.createContext<{ value: string; setValue: (value: string) => void } | null>(null);

  return {
    Tabs: ({ defaultValue, children }: { defaultValue: string; children: React.ReactNode }) => {
      const [value, setValue] = React.useState(defaultValue);
      return <TabsContext.Provider value={{ value, setValue }}>{children}</TabsContext.Provider>;
    },
    TabsList: ({ children }: { children: React.ReactNode }) => <div role="tablist">{children}</div>,
    TabsTrigger: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const ctx = React.useContext(TabsContext)!;
      return (
        <button role="tab" aria-selected={ctx.value === value} onClick={() => ctx.setValue(value)}>
          {children}
        </button>
      );
    },
    TabsContent: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const ctx = React.useContext(TabsContext)!;
      return ctx.value === value ? <div>{children}</div> : null;
    },
  };
});

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

    fireEvent.click(screen.getByRole("tab", { name: /Lançamentos/i }));

    expect(screen.getByTestId("cashflow-by-category")).toBeInTheDocument();
    expect(screen.queryByTestId("cashflow-dashboard")).not.toBeInTheDocument();
  });
});