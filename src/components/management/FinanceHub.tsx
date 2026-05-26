import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BankReconciliation } from "@/components/management/BankReconciliation";
import { CashFlowDashboard } from "@/components/management/CashFlowDashboard";
import { PaymentFeesManager } from "@/components/management/PaymentFeesManager";
import { FinancialAgentSettings } from "@/components/management/FinancialAgentSettings";
import { Wallet, ArrowLeftRight, Percent, Bot } from "lucide-react";

interface Store { id: string; name: string; }

export function FinanceHub({ stores }: { stores: Store[] }) {
  return (
    <Tabs defaultValue="cashflow" className="space-y-4">
      <TabsList>
        <TabsTrigger value="cashflow" className="gap-1"><Wallet className="h-3.5 w-3.5" />Fluxo de Caixa</TabsTrigger>
        <TabsTrigger value="reconciliation" className="gap-1"><ArrowLeftRight className="h-3.5 w-3.5" />Conciliação Bancária</TabsTrigger>
        <TabsTrigger value="fees" className="gap-1"><Percent className="h-3.5 w-3.5" />Taxas</TabsTrigger>
        <TabsTrigger value="agent" className="gap-1"><Bot className="h-3.5 w-3.5" />Agente IA</TabsTrigger>
      </TabsList>
      <TabsContent value="cashflow"><CashFlowDashboard stores={stores} /></TabsContent>
      <TabsContent value="reconciliation"><BankReconciliation stores={stores} /></TabsContent>
      <TabsContent value="fees"><PaymentFeesManager /></TabsContent>
      <TabsContent value="agent"><FinancialAgentSettings /></TabsContent>
    </Tabs>
  );
}
