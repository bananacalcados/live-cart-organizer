import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BankReconciliation } from "@/components/management/BankReconciliation";
import { CashFlowDashboard } from "@/components/management/CashFlowDashboard";
import { CashFlowByCategory } from "@/components/management/CashFlowByCategory";
import { CategoriesManager } from "@/components/management/CategoriesManager";
import { PaymentFeesManager } from "@/components/management/PaymentFeesManager";
import { FinancialAgentSettings } from "@/components/management/FinancialAgentSettings";
import { Wallet, ArrowLeftRight, Percent, Bot, FolderTree, BarChart3 } from "lucide-react";

interface Store { id: string; name: string; }

export function FinanceHub({ stores }: { stores: Store[] }) {
  return (
    <Tabs defaultValue="categorized" className="space-y-4">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="categorized" className="gap-1"><BarChart3 className="h-3.5 w-3.5" />Fluxo por Categoria</TabsTrigger>
        <TabsTrigger value="cashflow" className="gap-1"><Wallet className="h-3.5 w-3.5" />Lançamentos</TabsTrigger>
        <TabsTrigger value="categories" className="gap-1"><FolderTree className="h-3.5 w-3.5" />Plano de Contas</TabsTrigger>
        <TabsTrigger value="reconciliation" className="gap-1"><ArrowLeftRight className="h-3.5 w-3.5" />Conciliação</TabsTrigger>
        <TabsTrigger value="fees" className="gap-1"><Percent className="h-3.5 w-3.5" />Taxas</TabsTrigger>
        <TabsTrigger value="agent" className="gap-1"><Bot className="h-3.5 w-3.5" />Agente IA</TabsTrigger>
      </TabsList>
      <TabsContent value="categorized"><CashFlowByCategory stores={stores} /></TabsContent>
      <TabsContent value="cashflow"><CashFlowDashboard stores={stores} /></TabsContent>
      <TabsContent value="categories"><CategoriesManager /></TabsContent>
      <TabsContent value="reconciliation"><BankReconciliation stores={stores} /></TabsContent>
      <TabsContent value="fees"><PaymentFeesManager /></TabsContent>
      <TabsContent value="agent"><FinancialAgentSettings /></TabsContent>
    </Tabs>
  );
}
