import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart3, Home, TrendingUp, DollarSign, Package, ShoppingCart, Store,
  ArrowDownRight, RefreshCw, Loader2, Box, ShoppingBag, Calendar, Receipt,
  AlertTriangle, CheckCircle2, Clock, Wallet, Plus, Trash2, Check, Building2,
  Users, Save, UserCheck, Calculator
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { format, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfYear, endOfYear, subMonths } from "date-fns";
import { toast } from "sonner";
import { TeamProfilesManager } from "@/components/TeamProfilesManager";
import { BankReconciliation } from "@/components/management/BankReconciliation";
import { StrategyManager } from "@/components/management/StrategyManager";
import { MarginFormation } from "@/components/management/MarginFormation";
import { CrmDuplicates } from "@/components/management/CrmDuplicates";
import { InvestmentsDashboard } from "@/components/management/InvestmentsDashboard";
import { AbcCurveAnalysis } from "@/components/management/AbcCurveAnalysis";
import ExchangeDashboard from "@/components/management/ExchangeDashboard";

interface PosSale {
  id: string;
  store_id: string;
  total: number;
  discount: number;
  subtotal: number;
  payment_method: string | null;
  paid_at: string | null;
  created_at: string;
  status: string;
}

interface PosSaleItem {
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  quantity: number;
  total_price: number;
  sale_id: string;
}

interface TinySyncedOrder {
  id: string;
  store_id: string;
  tiny_order_id: string;
  tiny_order_number: string | null;
  order_date: string;
  customer_name: string | null;
  status: string | null;
  payment_method: string | null;
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  items: any;
  synced_at?: string;
}

interface StoreRow {
  id: string;
  name: string;
  revenue_target?: number;
  is_simulation?: boolean;
  tiny_token?: string | null;
}

interface InventorySummaryRow {
  store_id: string;
  total_items: number;
  total_value: number;
  total_cost: number;
  zero_stock: number;
  total_skus: number;
}

const CHART_COLORS = [
  "hsl(0, 0%, 15%)", "hsl(48, 95%, 50%)", "hsl(25, 90%, 52%)",
  "hsl(0, 0%, 35%)", "hsl(48, 80%, 40%)", "hsl(25, 70%, 40%)",
  "hsl(0, 0%, 55%)", "hsl(48, 60%, 60%)"
];

const CENTRO_ID = "4ade7b44-5043-4ab1-a124-7a6ab5468e29";
const PEROLA_ID = "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2";
const PHYSICAL_STORE_IDS = [CENTRO_ID, PEROLA_ID];

const AUTO_REFRESH_MS = 60_000; // 1 minute

type Period = "today" | "7d" | "30d" | "month" | "last_month" | "custom";

function KPICard({ title, value, icon: Icon, sub, variant }: { title: string; value: string; icon: any; sub?: string; variant?: "destructive" }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-muted-foreground font-medium">{title}</span>
          <Icon className={`h-3.5 w-3.5 ${variant === "destructive" ? "text-destructive" : "text-primary"}`} />
        </div>
        <p className={`text-lg font-bold ${variant === "destructive" ? "text-destructive" : ""}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function AccountsPayableContent({ accountsPayable, stores, storeFilter, fmt, onRefresh }: {
  accountsPayable: any[];
  stores: StoreRow[];
  storeFilter: string;
  fmt: (v: number) => string;
  onRefresh: () => void;
}) {
  const [apStoreFilter, setApStoreFilter] = useState(storeFilter);
  const [apDateFrom, setApDateFrom] = useState("");
  const [apDateTo, setApDateTo] = useState("");
  const [apPeriod, setApPeriod] = useState<"all" | "today" | "week" | "month" | "year" | "custom">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [markingPaid, setMarkingPaid] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [showAddBank, setShowAddBank] = useState(false);
  const [newBank, setNewBank] = useState({ name: "", bank_name: "", balance: "", account_type: "corrente" });
  const [savingBank, setSavingBank] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<"contas" | "bancos">("contas");

  useEffect(() => {
    loadBankAccounts();
  }, []);

  const loadBankAccounts = async () => {
    const { data } = await supabase.from("bank_accounts").select("*").eq("is_active", true).order("name");
    setBankAccounts(data || []);
  };

  const addBankAccount = async () => {
    if (!newBank.name.trim()) { toast.error("Nome é obrigatório"); return; }
    setSavingBank(true);
    try {
      const { error } = await supabase.from("bank_accounts").insert({
        name: newBank.name,
        bank_name: newBank.bank_name || null,
        balance: parseFloat(newBank.balance || "0"),
        account_type: newBank.account_type,
      });
      if (error) throw error;
      toast.success("Conta bancária adicionada!");
      setNewBank({ name: "", bank_name: "", balance: "", account_type: "corrente" });
      setShowAddBank(false);
      loadBankAccounts();
    } catch { toast.error("Erro ao adicionar conta"); }
    finally { setSavingBank(false); }
  };

  const updateBankBalance = async (id: string, balance: number) => {
    await supabase.from("bank_accounts").update({ balance }).eq("id", id);
    loadBankAccounts();
  };

  const deleteBankAccount = async (id: string) => {
    await supabase.from("bank_accounts").update({ is_active: false }).eq("id", id);
    toast.success("Conta removida");
    loadBankAccounts();
  };

  // Filters
  let filtered = apStoreFilter === "all"
    ? accountsPayable
    : accountsPayable.filter(ap => ap.store_id === apStoreFilter);

  if (apDateFrom) {
    filtered = filtered.filter(ap => ap.data_vencimento && ap.data_vencimento >= apDateFrom);
  }
  if (apDateTo) {
    filtered = filtered.filter(ap => ap.data_vencimento && ap.data_vencimento <= apDateTo);
  }

  const openAP = filtered.filter(ap => ap.situacao === 'aberto' || ap.situacao === 'parcial');
  const paidAP = filtered.filter(ap => ap.situacao === 'pago');
  const overdueAP = openAP.filter(ap => ap.data_vencimento && new Date(ap.data_vencimento) < new Date());
  const totalOpen = openAP.reduce((s: number, ap: any) => s + Number(ap.saldo || ap.valor || 0), 0);
  const totalPaid = paidAP.reduce((s: number, ap: any) => s + Number(ap.valor_pago || ap.valor || 0), 0);
  const totalOverdue = overdueAP.reduce((s: number, ap: any) => s + Number(ap.saldo || ap.valor || 0), 0);

  const selectedTotal = openAP.filter(ap => selectedIds.has(ap.id)).reduce((s: number, ap: any) => s + Number(ap.saldo || ap.valor || 0), 0);
  const totalBankBalance = bankAccounts.reduce((s, b) => s + Number(b.balance || 0), 0);

  const getStoreName = (storeId: string) => stores.find(s => s.id === storeId)?.name || "—";

  const formatDateBR = (d: string | null) => {
    if (!d) return "—";
    const date = new Date(d + 'T12:00:00');
    return date.toLocaleDateString("pt-BR");
  };

  const situacaoBadge = (sit: string) => {
    switch (sit) {
      case 'pago': return <Badge className="bg-primary text-primary-foreground text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" />Pago</Badge>;
      case 'aberto': return <Badge variant="outline" className="text-[10px]"><Clock className="h-3 w-3 mr-1" />Aberto</Badge>;
      case 'parcial': return <Badge className="bg-accent text-accent-foreground text-[10px]">Parcial</Badge>;
      case 'cancelado': return <Badge variant="destructive" className="text-[10px]">Cancelado</Badge>;
      default: return <Badge variant="secondary" className="text-[10px]">{sit}</Badge>;
    }
  };

  const isOverdue = (ap: any) => ap.data_vencimento && new Date(ap.data_vencimento) < new Date() && (ap.situacao === 'aberto' || ap.situacao === 'parcial');

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === openAP.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(openAP.map(ap => ap.id)));
    }
  };

  const markSelectedAsPaid = async () => {
    if (selectedIds.size === 0) return;
    setMarkingPaid(true);
    try {
      const { data, error } = await supabase.functions.invoke('tiny-mark-account-paid', {
        body: { account_ids: [...selectedIds] },
      });
      if (error) throw error;
      const successes = (data?.results || []).filter((r: any) => r.status === 'success' || r.status === 'local_only').length;
      toast.success(`${successes} contas marcadas como pagas`);
      setSelectedIds(new Set());
      onRefresh();
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    } finally {
      setMarkingPaid(false);
    }
  };

  // Categories summary
  const categorySummary = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    openAP.forEach(ap => {
      const cat = ap.categoria || "Sem categoria";
      const cur = map.get(cat) || { count: 0, total: 0 };
      cur.count++;
      cur.total += Number(ap.saldo || ap.valor || 0);
      map.set(cat, cur);
    });
    return [...map.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);
  }, [openAP]);

  return (
    <>
      {/* Sub-tabs */}
      <div className="flex gap-2 mb-4">
        <Button
          variant={activeSubTab === "contas" ? "default" : "outline"}
          size="sm" className="gap-1 h-8 text-xs"
          onClick={() => setActiveSubTab("contas")}
        >
          <Receipt className="h-3.5 w-3.5" /> Contas a Pagar
        </Button>
        <Button
          variant={activeSubTab === "bancos" ? "default" : "outline"}
          size="sm" className="gap-1 h-8 text-xs"
          onClick={() => setActiveSubTab("bancos")}
        >
          <Building2 className="h-3.5 w-3.5" /> Contas Bancárias
        </Button>
      </div>

      {activeSubTab === "bancos" ? (
        <>
          {/* Bank Accounts */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard title="Saldo Total" value={fmt(totalBankBalance)} icon={Wallet} />
            <KPICard
              title="Cobertura das Contas"
              value={totalOpen > 0 ? `${Math.round((totalBankBalance / totalOpen) * 100)}%` : "—"}
              icon={CheckCircle2}
              variant={totalBankBalance < totalOpen ? "destructive" : undefined}
              sub={totalBankBalance >= totalOpen ? "Cobre todas em aberto" : `Faltam ${fmt(totalOpen - totalBankBalance)}`}
            />
            <KPICard title="Total em Aberto" value={fmt(totalOpen)} icon={Clock} variant="destructive" />
            <KPICard title="Contas Bancárias" value={bankAccounts.length.toString()} icon={Building2} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bankAccounts.map(bank => (
              <Card key={bank.id}>
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      <div>
                        <h4 className="font-semibold text-sm">{bank.name}</h4>
                        {bank.bank_name && <p className="text-[10px] text-muted-foreground">{bank.bank_name}</p>}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteBankAccount(bank.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Saldo</span>
                      <span className="text-lg font-bold">{fmt(Number(bank.balance))}</span>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Novo saldo"
                        className="h-7 text-xs flex-1"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            updateBankBalance(bank.id, parseFloat((e.target as HTMLInputElement).value || "0"));
                            (e.target as HTMLInputElement).value = "";
                          }
                        }}
                      />
                      <Badge variant="secondary" className="text-[10px]">{bank.account_type}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Add card */}
            <Card className="border-dashed cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setShowAddBank(true)}>
              <CardContent className="pt-5 flex flex-col items-center justify-center h-full min-h-[140px] text-muted-foreground">
                <Plus className="h-6 w-6 mb-2" />
                <p className="text-sm font-medium">Adicionar Conta</p>
              </CardContent>
            </Card>
          </div>

          {/* Add Bank Dialog */}
          <Dialog open={showAddBank} onOpenChange={setShowAddBank}>
            <DialogContent>
              <DialogHeader><DialogTitle>Adicionar Conta Bancária</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Nome da Conta *</Label>
                  <Input value={newBank.name} onChange={e => setNewBank(s => ({ ...s, name: e.target.value }))} placeholder="Ex: Conta PJ Itaú" className="h-9" />
                </div>
                <div>
                  <Label className="text-xs">Banco</Label>
                  <Input value={newBank.bank_name} onChange={e => setNewBank(s => ({ ...s, bank_name: e.target.value }))} placeholder="Ex: Itaú, Bradesco, Nubank" className="h-9" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Saldo Atual (R$)</Label>
                    <Input type="number" value={newBank.balance} onChange={e => setNewBank(s => ({ ...s, balance: e.target.value }))} placeholder="0,00" className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Tipo</Label>
                    <Select value={newBank.account_type} onValueChange={v => setNewBank(s => ({ ...s, account_type: v }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="corrente">Corrente</SelectItem>
                        <SelectItem value="poupanca">Poupança</SelectItem>
                        <SelectItem value="investimento">Investimento</SelectItem>
                        <SelectItem value="caixa">Caixa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button className="w-full" onClick={addBankAccount} disabled={savingBank}>
                  {savingBank ? "Salvando..." : "Adicionar"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <>
           {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={apStoreFilter} onValueChange={setApStoreFilter}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="Todas as lojas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as lojas</SelectItem>
                {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1 border rounded-md p-0.5">
              {([
                { key: "all", label: "Tudo" },
                { key: "today", label: "Hoje" },
                { key: "week", label: "Semana" },
                { key: "month", label: "Mês" },
                { key: "year", label: "Ano" },
                { key: "custom", label: "Período" },
              ] as const).map(p => (
                <Button
                  key={p.key}
                  variant={apPeriod === p.key ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-[11px] px-2.5"
                  onClick={() => {
                    setApPeriod(p.key);
                    const today = new Date();
                    if (p.key === "all") { setApDateFrom(""); setApDateTo(""); }
                    else if (p.key === "today") { const d = format(today, "yyyy-MM-dd"); setApDateFrom(d); setApDateTo(d); }
                    else if (p.key === "week") { setApDateFrom(format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd")); setApDateTo(format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd")); }
                    else if (p.key === "month") { setApDateFrom(format(startOfMonth(today), "yyyy-MM-dd")); setApDateTo(format(endOfMonth(today), "yyyy-MM-dd")); }
                    else if (p.key === "year") { setApDateFrom(format(startOfYear(today), "yyyy-MM-dd")); setApDateTo(format(endOfYear(today), "yyyy-MM-dd")); }
                  }}
                />
              ))}
            </div>

            {apPeriod === "custom" && (
              <>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">De:</span>
                  <Input type="date" value={apDateFrom} onChange={e => setApDateFrom(e.target.value)} className="h-8 text-xs w-[140px]" />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">Até:</span>
                  <Input type="date" value={apDateTo} onChange={e => setApDateTo(e.target.value)} className="h-8 text-xs w-[140px]" />
                </div>
              </>
            )}

            {(apDateFrom || apDateTo) && apPeriod !== "custom" && (
              <span className="text-[10px] text-muted-foreground">
                {apDateFrom && formatDateBR(apDateFrom)} — {apDateTo && formatDateBR(apDateTo)}
              </span>
            )}
          </div>

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Receipt className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Nenhuma conta a pagar encontrada.</p>
                <p className="text-xs mt-1">Clique em "Sincronizar Contas" para importar do Tiny ERP.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KPICard title="Total em Aberto" value={fmt(totalOpen)} icon={Clock} variant={totalOpen > 0 ? "destructive" : undefined} />
                <KPICard title="Vencidas" value={fmt(totalOverdue)} icon={AlertTriangle} variant="destructive" sub={`${overdueAP.length} contas`} />
                <KPICard title="Total Pago" value={fmt(totalPaid)} icon={CheckCircle2} sub={`${paidAP.length} contas`} />
                <KPICard title="Total de Contas" value={filtered.length.toString()} icon={Receipt} />
              </div>

              {/* Categories breakdown */}
              {categorySummary.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Por Categoria (Em Aberto)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {categorySummary.map((cat, i) => (
                        <Badge key={i} variant="outline" className="text-xs py-1 px-2">
                          {cat.name}: {fmt(cat.total)} ({cat.count})
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Selected actions bar */}
              {selectedIds.size > 0 && (
                <Card className="border-primary/50 bg-primary/5">
                  <CardContent className="py-3 px-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Check className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{selectedIds.size} contas selecionadas</span>
                      <span className="text-sm font-bold">{fmt(selectedTotal)}</span>
                      {totalBankBalance > 0 && (
                        <Badge variant={totalBankBalance >= selectedTotal ? "default" : "destructive"} className="text-xs">
                          {totalBankBalance >= selectedTotal
                            ? `✓ Saldo cobre (${fmt(totalBankBalance)})`
                            : `✗ Saldo insuficiente (${fmt(totalBankBalance)})`
                          }
                        </Badge>
                      )}
                    </div>
                    <Button
                      size="sm" className="gap-1"
                      onClick={markSelectedAsPaid}
                      disabled={markingPaid}
                    >
                      {markingPaid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {markingPaid ? "Processando..." : "Marcar como Pago"}
                    </Button>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Contas em Aberto e Vencidas</CardTitle>
                </CardHeader>
                <CardContent>
                  {openAP.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-6">Nenhuma conta em aberto 🎉</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8">
                              <Checkbox
                                checked={selectedIds.size === openAP.length && openAP.length > 0}
                                onCheckedChange={toggleSelectAll}
                              />
                            </TableHead>
                            <TableHead className="text-xs">Fornecedor</TableHead>
                            <TableHead className="text-xs">Loja</TableHead>
                            <TableHead className="text-xs">Nº Doc</TableHead>
                            <TableHead className="text-xs">Vencimento</TableHead>
                            <TableHead className="text-xs text-right">Valor</TableHead>
                            <TableHead className="text-xs text-right">Saldo</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-xs">Categoria</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {openAP.sort((a, b) => (a.data_vencimento || '').localeCompare(b.data_vencimento || '')).map((ap: any) => (
                            <TableRow key={ap.id} className={`${isOverdue(ap) ? "bg-destructive/5" : ""} ${selectedIds.has(ap.id) ? "bg-primary/5" : ""}`}>
                              <TableCell>
                                <Checkbox checked={selectedIds.has(ap.id)} onCheckedChange={() => toggleSelect(ap.id)} />
                              </TableCell>
                              <TableCell className="text-xs font-medium max-w-[200px] truncate">{ap.nome_fornecedor || "—"}</TableCell>
                              <TableCell className="text-xs">{getStoreName(ap.store_id)}</TableCell>
                              <TableCell className="text-xs">{ap.numero_doc || "—"}</TableCell>
                              <TableCell className="text-xs">
                                <span className={isOverdue(ap) ? "text-destructive font-bold" : ""}>
                                  {formatDateBR(ap.data_vencimento)}
                                </span>
                                {isOverdue(ap) && <AlertTriangle className="h-3 w-3 inline ml-1 text-destructive" />}
                              </TableCell>
                              <TableCell className="text-xs text-right">{fmt(Number(ap.valor || 0))}</TableCell>
                              <TableCell className="text-xs text-right font-semibold">{fmt(Number(ap.saldo || 0))}</TableCell>
                              <TableCell>{situacaoBadge(ap.situacao)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{ap.categoria || "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Contas Pagas</CardTitle>
                </CardHeader>
                <CardContent>
                  {paidAP.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-6">Nenhuma conta paga registrada.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Fornecedor</TableHead>
                            <TableHead className="text-xs">Loja</TableHead>
                            <TableHead className="text-xs">Nº Doc</TableHead>
                            <TableHead className="text-xs">Pagamento</TableHead>
                            <TableHead className="text-xs text-right">Valor</TableHead>
                            <TableHead className="text-xs text-right">Pago</TableHead>
                            <TableHead className="text-xs">Categoria</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paidAP.slice(0, 50).map((ap: any) => (
                            <TableRow key={ap.id}>
                              <TableCell className="text-xs font-medium max-w-[200px] truncate">{ap.nome_fornecedor || "—"}</TableCell>
                              <TableCell className="text-xs">{getStoreName(ap.store_id)}</TableCell>
                              <TableCell className="text-xs">{ap.numero_doc || "—"}</TableCell>
                              <TableCell className="text-xs">{formatDateBR(ap.data_pagamento)}</TableCell>
                              <TableCell className="text-xs text-right">{fmt(Number(ap.valor || 0))}</TableCell>
                              <TableCell className="text-xs text-right font-semibold">{fmt(Number(ap.valor_pago || 0))}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{ap.categoria || "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}

export default function Management() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("30d");
  const [customFrom, setCustomFrom] = useState(() => format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  
  const [syncingStock, setSyncingStock] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ currentDate: string; storeName: string; phase: string } | null>(null);

  const [tinyOrders, setTinyOrders] = useState<TinySyncedOrder[]>([]);
  const [posSales, setPosSales] = useState<PosSale[]>([]);
  const [posSaleItems, setPosSaleItems] = useState<(PosSaleItem & { store_id: string })[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [inventoryData, setInventoryData] = useState<InventorySummaryRow[]>([]);
  const [accountsPayable, setAccountsPayable] = useState<any[]>([]);
  const [syncingAP, setSyncingAP] = useState(false);
  const [stockItems, setStockItems] = useState<any[]>([]);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSyncKeyRef = useRef<string | null>(null);
  const userInteractingRef = useRef(false);
  const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (period) {
      case "today": return { start: startOfDay(now), end: endOfDay(now) };
      case "7d": return { start: startOfDay(subDays(now, 7)), end: endOfDay(now) };
      case "30d": return { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
      case "month": return { start: startOfMonth(now), end: endOfMonth(now) };
      case "last_month": { const lm = subMonths(now, 1); return { start: startOfMonth(lm), end: endOfMonth(lm) }; }
      case "custom": return { start: startOfDay(new Date(customFrom + 'T12:00:00')), end: endOfDay(new Date(customTo + 'T12:00:00')) };
    }
  }, [period, customFrom, customTo]);

  const fetchAllTinyOrders = async (startDate: string, endDate: string, statuses: string[]) => {
    const PAGE_SIZE = 1000;
    let allData: any[] = [];
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase.from("tiny_synced_orders").select("*")
        .gte("order_date", startDate).lte("order_date", endDate)
        .in("status", statuses)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      allData = allData.concat(data || []);
      hasMore = (data?.length || 0) === PAGE_SIZE;
      from += PAGE_SIZE;
    }
    return allData;
  };

  const fetchPosSales = async (startISO: string, endISO: string) => {
    const PAGE_SIZE = 1000;
    let allSales: any[] = [];
    let allItems: any[] = [];

    // Fetch completed sales with paid_at in range
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase.from("pos_sales")
        .select("id, store_id, total, discount, subtotal, payment_method, paid_at, status, created_at")
        .in("status", ["completed", "paid"])
        .not("paid_at", "is", null)
        .gte("paid_at", startISO)
        .lte("paid_at", endISO)
        .in("store_id", PHYSICAL_STORE_IDS)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      allSales = allSales.concat(data || []);
      hasMore = (data?.length || 0) === PAGE_SIZE;
      from += PAGE_SIZE;
    }

    // Also fetch completed sales WITHOUT paid_at (use created_at as fallback)
    from = 0;
    hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase.from("pos_sales")
        .select("id, store_id, total, discount, subtotal, payment_method, paid_at, status, created_at")
        .in("status", ["completed", "paid"])
        .is("paid_at", null)
        .gte("created_at", startISO)
        .lte("created_at", endISO)
        .in("store_id", PHYSICAL_STORE_IDS)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      allSales = allSales.concat(data || []);
      hasMore = (data?.length || 0) === PAGE_SIZE;
      from += PAGE_SIZE;
    }

    // Deduplicate by id (in case of overlap)
    const seenIds = new Set<string>();
    allSales = allSales.filter(s => {
      if (seenIds.has(s.id)) return false;
      seenIds.add(s.id);
      return true;
    });

    // Fetch items for these sales
    if (allSales.length > 0) {
      const saleIds = allSales.map(s => s.id);
      for (let i = 0; i < saleIds.length; i += 200) {
        const batch = saleIds.slice(i, i + 200);
        const { data: items } = await supabase.from("pos_sale_items")
          .select("product_name, variant_name, sku, quantity, total_price, sale_id")
          .in("sale_id", batch);
        if (items) {
          // Enrich items: add store_id and fix total_price when 0
          const enriched = items.map(item => {
            const sale = allSales.find(s => s.id === item.sale_id);
            let itemPrice = Number(item.total_price || 0);
            // When total_price is 0, distribute sale total proportionally
            if (itemPrice === 0 && sale) {
              const saleItems = items.filter(it => it.sale_id === item.sale_id);
              const totalQty = saleItems.reduce((s, it) => s + (it.quantity || 1), 0);
              itemPrice = (Number(sale.total || 0) / totalQty) * (item.quantity || 1);
            }
            return { ...item, total_price: itemPrice, store_id: sale?.store_id || "" };
          });
          allItems = allItems.concat(enriched);
        }
      }
    }

    return { sales: allSales, items: allItems };
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const startDate = dateRange.start.toISOString().split('T')[0];
    const endDate = dateRange.end.toISOString().split('T')[0];
    const startISO = dateRange.start.toISOString();
    const endISO = dateRange.end.toISOString();

    const APPROVED_STATUSES = ['Faturado', 'Aprovado', 'Preparando envio', 'Pronto para envio', 'Enviado', 'Entregue', 'Não entregue'];

    const [tinyData, posData, storesRes, invRes, apRes, stockRes] = await Promise.all([
      fetchAllTinyOrders(startDate, endDate, APPROVED_STATUSES),
      fetchPosSales(startISO, endISO),
      supabase.from("pos_stores").select("id, name, revenue_target, is_simulation, tiny_token").eq("is_active", true),
      supabase.rpc("get_inventory_summary"),
      supabase.from("tiny_accounts_payable").select("*").order("data_vencimento", { ascending: true }),
      supabase.from("pos_products").select("name, variant, sku, stock, price, cost_price, store_id").eq("is_active", true).gt("stock", 0),
    ]);

    // Keep every valid Tiny order for the selected period.
    // Store attribution can vary by depósito (ex.: Site, Centro, Perola),
    // so filtering by a fixed online store ID list undercounts online revenue.
    setTinyOrders((tinyData as TinySyncedOrder[]) || []);
    setPosSales(posData.sales);
    setPosSaleItems(posData.items);
    setStores(storesRes.data || []);
    setInventoryData((invRes.data || []) as unknown as InventorySummaryRow[]);
    setAccountsPayable((apRes.data || []) as any[]);
    setStockItems(stockRes.data || []);
    setLoading(false);
  }, [dateRange]);

  const runSyncWithResume = async (body: any) => {
    setSyncing(true);
    setSyncProgress({ currentDate: "Iniciando...", storeName: "", phase: body.stock_only ? "stock" : "orders" });

    const pollInterval = setInterval(async () => {
      const { data: logs } = await supabase
        .from('tiny_management_sync_log')
        .select('orders_synced, status, store_id, current_date_syncing, phase')
        .in('status', ['running', 'partial'])
        .order('started_at', { ascending: false })
        .limit(1);
      if (logs && logs.length > 0) {
        const log = logs[0] as any;
        const storeName = stores.find(s => s.id === log.store_id)?.name || "Loja";
        setSyncProgress({ currentDate: log.current_date_syncing || "Processando...", storeName, phase: log.phase || 'orders' });
      }
    }, 1500);

    try {
      let totalSynced = 0;

      const storesToSync = body.store_id
        ? [body.store_id]
        : stores.filter(s => Boolean(s.tiny_token)).map(s => s.id);

      for (const sid of storesToSync) {
        let currentBody = { ...body, store_id: sid };
        let attempts = 0;
        const MAX_ATTEMPTS = 30;

        while (attempts < MAX_ATTEMPTS) {
          attempts++;
          const { data, error } = await supabase.functions.invoke('tiny-sync-management', { body: currentBody });
          if (error) throw error;

          const partialResults = data?.results || [];
          totalSynced += partialResults.reduce((s: number, r: any) => s + (r.orders_synced || 0), 0);

          const partial = partialResults.find((r: any) => r.status === 'partial');
          if (partial) {
            const stName = stores.find(s => s.id === sid)?.name || "Loja";
            if (partial.resume_stock_page) {
              toast.info(`Continuando estoque ${stName}... (pg ${partial.resume_stock_page})`);
              currentBody = {
                store_id: partial.store_id,
                stock_only: true,
                resume_stock_page: partial.resume_stock_page,
                resume_log_id: partial.resume_log_id,
              };
            } else if (partial.resume_date) {
              toast.info(`Continuando pedidos ${stName}... (${partial.resume_date})`);
              currentBody = {
                ...body,
                store_id: partial.store_id,
                resume_date: partial.resume_date,
                resume_log_id: partial.resume_log_id,
              };
            }
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }

          // Check if orders sync timed out (skipped store means it was cut short)
          const skipped = partialResults.find((r: any) => r.status === 'skipped');
          if (skipped) {
            // Re-run for this store
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }

          break;
        }
      }

      toast.success(`Sincronização concluída: ${totalSynced} pedidos importados`);
      fetchData();
    } catch (e: any) {
      toast.error(`Erro na sincronização: ${e.message}`);
    } finally {
      clearInterval(pollInterval);
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const syncTinyOrders = () => {
    const fromDate = format(dateRange.start, 'dd/MM/yyyy');
    const toDate = format(dateRange.end, 'dd/MM/yyyy');
    runSyncWithResume({ date_from: fromDate, date_to: toDate, sync_stock: false });
  };

  const syncTinyStock = async () => {
    setSyncingStock(true);
    setSyncProgress({ currentDate: "Estoque: Iniciando...", storeName: "", phase: "stock" });

    const pollInterval = setInterval(async () => {
      const { data: logs } = await supabase
        .from('tiny_management_sync_log')
        .select('orders_synced, status, store_id, current_date_syncing, phase')
        .in('status', ['running', 'partial'])
        .order('started_at', { ascending: false })
        .limit(1);
      if (logs && logs.length > 0) {
        const log = logs[0] as any;
        const storeName = stores.find(s => s.id === log.store_id)?.name || "Loja";
        setSyncProgress({ currentDate: log.current_date_syncing || "Processando...", storeName, phase: 'stock' });
      }
    }, 1500);

    try {
      const storesToSync = stores.filter(s => Boolean(s.tiny_token)).map(s => s.id);
      for (const sid of storesToSync) {
        let currentBody: any = { stock_only: true, store_id: sid };
        let attempts = 0;
        const MAX_ATTEMPTS = 250;

        while (attempts < MAX_ATTEMPTS) {
          attempts++;
          const { data, error } = await supabase.functions.invoke('tiny-sync-management', { body: currentBody });
          if (error) throw error;

          const partialResults = data?.results || [];
          const partial = partialResults.find((r: any) => r.status === 'partial');
          if (partial?.resume_stock_page) {
            const stName = stores.find(s => s.id === sid)?.name || "Loja";
            const pct = partial.stock_updated && partial.resume_stock_page ? `${Math.round((partial.stock_updated / 5900) * 100)}%` : `pg ${partial.resume_stock_page}`;
            toast.info(`Continuando estoque ${stName}... (${pct})`);
            currentBody = {
              store_id: partial.store_id,
              stock_only: true,
              resume_stock_page: partial.resume_stock_page,
              resume_log_id: partial.resume_log_id,
            };
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          break;
        }
        const stName = stores.find(s => s.id === sid)?.name || "Loja";
        toast.success(`Estoque ${stName} sincronizado`);
      }
      toast.success("Sincronização de estoque concluída!");
      fetchData();
    } catch (e: any) {
      toast.error(`Erro na sincronização de estoque: ${e.message}`);
    } finally {
      clearInterval(pollInterval);
      setSyncingStock(false);
      setSyncProgress(null);
    }
  };


  const syncAccountsPayable = async () => {
    setSyncingAP(true);
    try {
      const { data, error } = await supabase.functions.invoke('tiny-sync-accounts-payable', {
        body: storeFilter !== 'all' ? { store_id: storeFilter } : {},
      });
      if (error) throw error;
      const total = (data?.results || []).reduce((s: number, r: any) => s + (r.total_synced || 0), 0);
      toast.success(`Contas a pagar sincronizadas: ${total} contas`);
      fetchData();
    } catch (e: any) {
      toast.error(`Erro ao sincronizar contas a pagar: ${e.message}`);
    } finally {
      setSyncingAP(false);
    }
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    autoSyncKeyRef.current = null;
  }, [period, customFrom, customTo]);

  useEffect(() => {
    if (loading || syncing || stores.length === 0) return;

    const now = new Date();
    const periodIncludesToday = dateRange.end >= startOfDay(now);
    if (!periodIncludesToday) return;

    const latestOrderDate = tinyOrders.reduce<Date | null>((latest, order) => {
      if (!order.order_date) return latest;
      const orderDate = new Date(`${order.order_date}T12:00:00`);
      if (Number.isNaN(orderDate.getTime())) return latest;
      return !latest || orderDate > latest ? orderDate : latest;
    }, null);

    const todayStart = startOfDay(now);
    const hasCurrentMonthGap = period === "month" && (!latestOrderDate || latestOrderDate < todayStart);

    const latestSyncedAt = tinyOrders.reduce<Date | null>((latest, order) => {
      if (!order.synced_at) return latest;
      const syncedAt = new Date(order.synced_at);
      if (Number.isNaN(syncedAt.getTime())) return latest;
      return !latest || syncedAt > latest ? syncedAt : latest;
    }, null);

    const syncIsStale = !latestSyncedAt || latestSyncedAt < startOfDay(now);
    if (!syncIsStale && !hasCurrentMonthGap) return;

    const rangeKey = `${startOfDay(dateRange.start).toISOString()}::${startOfDay(dateRange.end).toISOString()}::${hasCurrentMonthGap ? 'gap' : 'stale'}`;
    if (autoSyncKeyRef.current === rangeKey) return;

    autoSyncKeyRef.current = rangeKey;
    toast.info("Atualizando vendas online do Tiny para completar o período atual...");
    runSyncWithResume({
      date_from: format(dateRange.start, 'dd/MM/yyyy'),
      date_to: format(dateRange.end, 'dd/MM/yyyy'),
      sync_stock: false,
    });
  }, [loading, syncing, stores, tinyOrders, dateRange, period, customFrom, customTo]);

  // Auto-refresh every minute — pauses while user is interacting (typing, clicking forms, etc.)
  useEffect(() => {
    const markInteracting = () => {
      userInteractingRef.current = true;
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
      interactionTimerRef.current = setTimeout(() => { userInteractingRef.current = false; }, 120_000);
    };
    const events = ['mousedown', 'keydown', 'focusin', 'input', 'change'] as const;
    events.forEach(e => document.addEventListener(e, markInteracting));

    autoRefreshRef.current = setInterval(() => {
      if (!userInteractingRef.current) fetchData();
    }, AUTO_REFRESH_MS);

    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
      events.forEach(e => document.removeEventListener(e, markInteracting));
    };
  }, [fetchData]);

  // --- Computed ---

  // POS sales for physical stores
  const filteredPosSales = useMemo(() => {
    if (storeFilter === "all") return posSales;
    return posSales.filter(s => s.store_id === storeFilter);
  }, [posSales, storeFilter]);

  const filteredPosItems = useMemo(() => {
    if (storeFilter === "all") return posSaleItems;
    return posSaleItems.filter(i => i.store_id === storeFilter);
  }, [posSaleItems, storeFilter]);

  // Online (Tiny/Shopify) orders
  const filteredTinyOrders = useMemo(() => {
    if (storeFilter === "all") return tinyOrders;
    return tinyOrders.filter(s => s.store_id === storeFilter);
  }, [tinyOrders, storeFilter]);

  // Parse items from tiny orders for ABC
  const allTinyItems = useMemo(() => {
    const items: { name: string; sku: string; quantity: number; unit_price: number; total: number; store_id: string }[] = [];
    tinyOrders.forEach(order => {
      try {
        const parsed = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
        parsed.forEach((i: any) => items.push({ ...i, store_id: order.store_id }));
      } catch {}
    });
    return items;
  }, [tinyOrders]);

  // Per-store KPIs
  const centroSales = posSales.filter(s => s.store_id === CENTRO_ID);
  const perolaSales = posSales.filter(s => s.store_id === PEROLA_ID);
  const centroRevenue = centroSales.reduce((s, v) => s + Number(v.total || 0), 0);
  const perolaRevenue = perolaSales.reduce((s, v) => s + Number(v.total || 0), 0);
  const centroDiscount = centroSales.reduce((s, v) => s + Number(v.discount || 0), 0);
  const perolaDiscount = perolaSales.reduce((s, v) => s + Number(v.discount || 0), 0);

  const centroItems = posSaleItems.filter(i => i.store_id === CENTRO_ID);
  const perolaItems = posSaleItems.filter(i => i.store_id === PEROLA_ID);
  const centroItemsSold = centroItems.reduce((s, v) => s + (v.quantity || 0), 0);
  const perolaItemsSold = perolaItems.reduce((s, v) => s + (v.quantity || 0), 0);
  const centroTicket = centroSales.length > 0 ? centroRevenue / centroSales.length : 0;
  const perolaTicket = perolaSales.length > 0 ? perolaRevenue / perolaSales.length : 0;
  const centroItemsPerSale = centroSales.length > 0 ? centroItemsSold / centroSales.length : 0;
  const perolaItemsPerSale = perolaSales.length > 0 ? perolaItemsSold / perolaSales.length : 0;

  const physicalRevenue = filteredPosSales.reduce((s, v) => s + Number(v.total || 0), 0);
  const physicalDiscount = filteredPosSales.reduce((s, v) => s + Number(v.discount || 0), 0);
  const physicalOrders = filteredPosSales.length;
  const physicalItemsSold = filteredPosItems.reduce((s, v) => s + (v.quantity || 0), 0);

  const shopifyRevenue = filteredTinyOrders.reduce((s, v) => s + Number(v.total || 0), 0);
  const shopifyDiscount = filteredTinyOrders.reduce((s, v) => s + Number(v.discount || 0), 0);
  const shopifyOrders = filteredTinyOrders.length;
  const shopifyTicket = shopifyOrders > 0 ? shopifyRevenue / shopifyOrders : 0;

  const totalRevenue = physicalRevenue + shopifyRevenue;
  const totalOrders = physicalOrders + shopifyOrders;
  const totalDiscount = physicalDiscount + shopifyDiscount;

  // Payment methods (physical stores)
  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredPosSales.forEach(s => {
      const m = s.payment_method || "Outros";
      map.set(m, (map.get(m) || 0) + Number(s.total));
    });
    filteredTinyOrders.forEach(s => {
      const m = s.payment_method || "Online";
      map.set(m, (map.get(m) || 0) + Number(s.total));
    });
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredPosSales, filteredTinyOrders]);

  // Daily trend
  const dailyTrend = useMemo(() => {
    const map = new Map<string, { centro: number; perola: number; shopify: number }>();
    posSales.forEach(s => {
      const dateRef = s.paid_at || (s as any).created_at;
      if (!dateRef) return;
      const day = format(new Date(dateRef), "dd/MM");
      const cur = map.get(day) || { centro: 0, perola: 0, shopify: 0 };
      if (s.store_id === CENTRO_ID) cur.centro += Number(s.total);
      else if (s.store_id === PEROLA_ID) cur.perola += Number(s.total);
      map.set(day, cur);
    });
    tinyOrders.forEach(s => {
      const day = s.order_date ? format(new Date(s.order_date + 'T12:00:00'), "dd/MM") : "??";
      const cur = map.get(day) || { centro: 0, perola: 0, shopify: 0 };
      cur.shopify += Number(s.total);
      map.set(day, cur);
    });
    return [...map.entries()]
      .map(([date, v]) => ({ date, ...v, total: v.centro + v.perola + v.shopify }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [posSales, tinyOrders]);

  // Store comparison
  const storeComparison = useMemo(() => {
    const results: { name: string; revenue: number; orders: number }[] = [];
    // Centro
    results.push({ name: "Loja Centro", revenue: centroRevenue, orders: centroSales.length });
    // Perola
    results.push({ name: "Loja Perola", revenue: perolaRevenue, orders: perolaSales.length });
    // Shopify
    results.push({ name: "Shopify (Online)", revenue: shopifyRevenue, orders: shopifyOrders });
    return results.filter(s => s.orders > 0).sort((a, b) => b.revenue - a.revenue);
  }, [centroRevenue, perolaRevenue, shopifyRevenue, centroSales, perolaSales, shopifyOrders]);

  // ABC Curve data — merge POS items + Shopify items
  const abcSaleItems = useMemo(() => {
    const items: { product_name: string; variant_name: string | null; sku: string | null; quantity: number; total_price: number; store_id: string; source: "pos" | "shopify" }[] = [];
    // POS items
    posSaleItems.forEach(i => {
      items.push({ ...i, source: "pos" });
    });
    // Shopify/Tiny items
    allTinyItems.forEach(i => {
      items.push({
        product_name: i.name,
        variant_name: null,
        sku: i.sku,
        quantity: i.quantity,
        total_price: i.total || (i.unit_price * i.quantity) || 0,
        store_id: i.store_id,
        source: "shopify",
      });
    });
    return items;
  }, [posSaleItems, allTinyItems]);

  const abcStockItems = useMemo(() => {
    return stockItems.map((i: any) => ({
      name: i.name,
      variant: i.variant,
      sku: i.sku,
      stock: i.stock,
      price: i.price,
      cost_price: i.cost_price || 0,
      store_id: i.store_id,
    }));
  }, [stockItems]);

  // Inventory summary
  const inventorySummary = useMemo(() => {
    return stores.map(st => {
      const inv = inventoryData.find(i => i.store_id === st.id);
      return {
        name: st.name,
        totalItems: Number(inv?.total_items || 0),
        totalValue: Number(inv?.total_value || 0),
        totalCost: Number(inv?.total_cost || 0),
        zeroStock: Number(inv?.zero_stock || 0),
        totalSkus: Number(inv?.total_skus || 0),
      };
    });
  }, [inventoryData, stores]);

  const totalStockValue = inventorySummary.reduce((s, v) => s + v.totalValue, 0);
  const totalStockCost = inventorySummary.reduce((s, v) => s + v.totalCost, 0);
  const totalZeroStock = inventorySummary.reduce((s, v) => s + v.zeroStock, 0);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-[hsl(0,0%,8%)] text-[hsl(45,10%,95%)]">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <BarChart3 className="h-5 w-5" />
            </div>
            <h1 className="text-lg font-bold text-[hsl(45,10%,95%)]">Gestão</h1>
          </div>
          <div className="flex items-center gap-2">
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[160px] h-8 text-xs bg-[hsl(0,0%,15%)] border-[hsl(0,0%,20%)] text-[hsl(45,10%,90%)]">
                <SelectValue placeholder="Todas as lojas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as lojas</SelectItem>
                {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-[140px] h-8 text-xs bg-[hsl(0,0%,15%)] border-[hsl(0,0%,20%)] text-[hsl(45,10%,90%)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="month">Mês atual</SelectItem>
                <SelectItem value="last_month">Mês passado</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
            {period === "custom" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1 h-8 text-xs bg-[hsl(0,0%,15%)] border-[hsl(0,0%,20%)] text-[hsl(45,10%,90%)]">
                    <Calendar className="h-3.5 w-3.5" />
                    {format(new Date(customFrom + 'T12:00:00'), 'dd/MM/yy')} — {format(new Date(customTo + 'T12:00:00'), 'dd/MM/yy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3 space-y-2" align="end">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium w-8">De:</label>
                    <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 text-xs w-[150px]" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium w-8">Até:</label>
                    <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-8 text-xs w-[150px]" />
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <Button variant="outline" size="sm" onClick={syncTinyOrders} disabled={syncing || syncingStock} className="gap-1 h-8 text-xs bg-primary text-primary-foreground border-primary hover:bg-primary/90 hover:text-primary-foreground">
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {syncing && syncProgress
                ? `${syncProgress.storeName} — ${syncProgress.currentDate}`
                : syncing ? "Iniciando..." : "Pedidos Tiny"}
            </Button>
            <Button variant="outline" size="sm" onClick={syncTinyStock} disabled={syncing || syncingStock} className="gap-1 h-8 text-xs bg-[hsl(25,90%,52%)] text-white border-[hsl(25,90%,52%)] hover:bg-[hsl(25,90%,45%)] max-w-[280px]">
              {syncingStock ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Box className="h-3.5 w-3.5" />}
              <span className="truncate">
                {syncingStock && syncProgress
                  ? `${syncProgress.storeName} — ${syncProgress.currentDate}`
                  : syncingStock ? "Estoque..." : "Estoque"}
              </span>
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1 h-8 text-[hsl(45,10%,90%)] hover:text-primary hover:bg-[hsl(0,0%,15%)]"><Home className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container py-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando dados...</div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
              <KPICard title="Faturamento Total" value={fmt(totalRevenue)} icon={DollarSign} sub={`${totalOrders} vendas • TM ${fmt(totalOrders > 0 ? totalRevenue / totalOrders : 0)}`} />
              <KPICard title="Loja Centro" value={fmt(centroRevenue)} icon={Store} sub={`${centroSales.length} vendas • TM ${fmt(centroTicket)} • ${centroItemsPerSale.toFixed(1)} itens/venda`} />
              <KPICard title="Loja Pérola" value={fmt(perolaRevenue)} icon={Store} sub={`${perolaSales.length} vendas • TM ${fmt(perolaTicket)} • ${perolaItemsPerSale.toFixed(1)} itens/venda`} />
              <KPICard title="Shopify (Online)" value={fmt(shopifyRevenue)} icon={ShoppingCart} sub={`${shopifyOrders} pedidos • TM ${fmt(shopifyTicket)}`} />
              <KPICard title="Descontos" value={fmt(totalDiscount)} icon={ArrowDownRight} variant="destructive" sub={`${totalRevenue > 0 ? ((totalDiscount / (totalRevenue + totalDiscount)) * 100).toFixed(1) : 0}% do bruto`} />
            </div>

            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">Visão Geral</TabsTrigger>
                <TabsTrigger value="products">Produtos</TabsTrigger>
                <TabsTrigger value="stores">Lojas</TabsTrigger>
                <TabsTrigger value="inventory">Estoque</TabsTrigger>
                <TabsTrigger value="accounts_payable" className="gap-1">
                  <Receipt className="h-3.5 w-3.5" />
                  Contas a Pagar
                </TabsTrigger>
                <TabsTrigger value="financeiro" className="gap-1">
                  <Wallet className="h-3.5 w-3.5" />
                  Financeiro
                </TabsTrigger>
                <TabsTrigger value="team" className="gap-1">
                  <Users className="h-3.5 w-3.5" />
                  Equipe
                </TabsTrigger>
                <TabsTrigger value="strategy" className="gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Estratégia
                </TabsTrigger>
                <TabsTrigger value="margin" className="gap-1">
                  <Calculator className="h-3.5 w-3.5" />
                  Formação de Margem
                </TabsTrigger>
                <TabsTrigger value="crm_duplicates" className="gap-1">
                  <Users className="h-3.5 w-3.5" />
                  CRM Duplicados
                </TabsTrigger>
                <TabsTrigger value="investments" className="gap-1">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Investimentos
                </TabsTrigger>
                <TabsTrigger value="exchanges" className="gap-1">
                  <ArrowDownRight className="h-3.5 w-3.5" />
                  Trocas
                </TabsTrigger>
              </TabsList>

              {/* Overview */}
              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card className="lg:col-span-2">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Faturamento Diário (POS + Shopify)</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={dailyTrend}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                          <Tooltip formatter={(v: number) => fmt(v)} />
                          <Legend />
                          <Bar dataKey="centro" name="Loja Centro" fill="hsl(0, 0%, 15%)" radius={[4,4,0,0]} stackId="lojas" />
                          <Bar dataKey="perola" name="Loja Pérola" fill="hsl(25, 90%, 52%)" radius={[4,4,0,0]} stackId="lojas" />
                          <Bar dataKey="shopify" name="Shopify" fill="hsl(48, 95%, 50%)" radius={[4,4,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Pagamentos (Lojas)</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                          <Pie data={paymentBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                            {paymentBreakdown.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmt(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Comparativo por Canal</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={storeComparison} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => fmt(v)} />
                        <Bar dataKey="revenue" name="Faturamento" fill="hsl(25, 90%, 52%)" radius={[0,4,4,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Products */}
              <TabsContent value="products" className="space-y-4">
                <AbcCurveAnalysis
                  saleItems={abcSaleItems}
                  stockItems={abcStockItems}
                  stores={stores}
                  fmt={fmt}
                />
              </TabsContent>

              {/* Stores */}
              <TabsContent value="stores" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {storeComparison.map((sc, i) => (
                    <Card key={i}>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Store className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold">{sc.name}</h3>
                            <p className="text-xs text-muted-foreground">{sc.orders} pedidos no período</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Faturamento</span>
                            <span className="font-bold">{fmt(sc.revenue)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Ticket Médio</span>
                            <span className="font-semibold">{sc.orders > 0 ? fmt(sc.revenue / sc.orders) : "—"}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              {/* Inventory */}
              <TabsContent value="inventory" className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <KPICard title="Valor em Estoque (Venda)" value={fmt(totalStockValue)} icon={Package} />
                  <KPICard title="Custo em Estoque" value={fmt(totalStockCost)} icon={DollarSign} />
                  <KPICard title="Margem Estimada" value={totalStockCost > 0 ? `${(((totalStockValue - totalStockCost) / totalStockValue) * 100).toFixed(0)}%` : "—"} icon={TrendingUp} />
                  <KPICard title="Produtos Zerados" value={totalZeroStock.toString()} icon={ArrowDownRight} variant="destructive" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {inventorySummary.map((inv, i) => (
                    <Card key={i}>
                      <CardContent className="pt-6">
                        <h3 className="font-semibold mb-3">{inv.name}</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Itens em estoque</span>
                            <span className="font-bold">{inv.totalItems.toLocaleString("pt-BR")}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Valor (venda)</span>
                            <span className="font-semibold">{fmt(inv.totalValue)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Custo</span>
                            <span className="font-semibold text-muted-foreground">{fmt(inv.totalCost)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Margem</span>
                            <span className="font-semibold">{inv.totalCost > 0 ? `${(((inv.totalValue - inv.totalCost) / inv.totalValue) * 100).toFixed(0)}%` : "—"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Produtos zerados</span>
                            <Badge variant={inv.zeroStock > 0 ? "destructive" : "secondary"}>{inv.zeroStock}</Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              {/* Contas a Pagar */}
              <TabsContent value="accounts_payable" className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Contas a Pagar — Todas as Contas Tiny</h3>
                  <Button
                    variant="outline" size="sm"
                    onClick={syncAccountsPayable}
                    disabled={syncingAP || syncing}
                    className="gap-1 h-8 text-xs"
                  >
                    {syncingAP ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {syncingAP ? "Sincronizando..." : "Sincronizar Contas"}
                  </Button>
                </div>

                <AccountsPayableContent
                  accountsPayable={accountsPayable}
                  stores={stores}
                  storeFilter={storeFilter}
                  fmt={fmt}
                  onRefresh={fetchData}
                />
              </TabsContent>

              {/* Financeiro / Conciliação Bancária */}
              <TabsContent value="financeiro" className="space-y-4">
                <BankReconciliation stores={stores} />
              </TabsContent>

              {/* Equipe / Perfis */}
              <TabsContent value="team" className="space-y-4">
                <TeamProfilesManager stores={stores} />
              </TabsContent>

              {/* Estratégia */}
              <TabsContent value="strategy" className="space-y-4">
                <StrategyManager stores={stores} />
              </TabsContent>

              {/* Formação de Margem */}
              <TabsContent value="margin" className="space-y-4">
                <MarginFormation stores={stores} onStoresChanged={fetchData} />
              </TabsContent>

              {/* CRM Duplicados */}
              <TabsContent value="crm_duplicates" className="space-y-4">
                <CrmDuplicates />
              </TabsContent>

              {/* Investimentos */}
              <TabsContent value="investments" className="space-y-4">
                <InvestmentsDashboard />
              </TabsContent>

              {/* Trocas e Devoluções */}
              <TabsContent value="exchanges" className="space-y-4">
                <ExchangeDashboard />
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
