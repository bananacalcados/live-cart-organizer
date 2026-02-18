import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Upload, Brain, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Clock,
  TrendingUp, TrendingDown, DollarSign, FileText, Filter, ChevronDown,
  ChevronRight, Plus, X, Building2, Wallet, BarChart3, PieChart as PieChartIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from "recharts";
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, startOfWeek, endOfWeek } from "date-fns";
import { toast } from "sonner";

interface FinancialCategory {
  id: string;
  name: string;
  parent_id: string | null;
  type: string;
  tiny_category_id: string | null;
  is_custom: boolean;
  is_active: boolean;
}

interface BankTransaction {
  id: string;
  bank_account_id: string;
  transaction_date: string;
  description: string;
  memo: string | null;
  amount: number;
  type: string;
  fitid: string | null;
  category_id: string | null;
  ai_category_id: string | null;
  ai_confidence: number | null;
  classification_status: string;
  notes: string | null;
  import_batch_id: string | null;
}

interface BankAccount {
  id: string;
  name: string;
  bank_name: string | null;
  balance: number;
  store_id: string | null;
  account_type: string | null;
}

interface StoreRow {
  id: string;
  name: string;
}

const CHART_COLORS = [
  "hsl(142, 70%, 45%)", "hsl(0, 70%, 50%)", "hsl(48, 95%, 50%)",
  "hsl(200, 70%, 50%)", "hsl(280, 60%, 55%)", "hsl(25, 90%, 52%)",
  "hsl(170, 60%, 45%)", "hsl(330, 60%, 55%)"
];

function KPICard({ title, value, icon: Icon, sub, variant }: { title: string; value: string; icon: any; sub?: string; variant?: "destructive" | "success" }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-muted-foreground font-medium">{title}</span>
          <Icon className={`h-3.5 w-3.5 ${variant === "destructive" ? "text-destructive" : variant === "success" ? "text-primary" : "text-muted-foreground"}`} />
        </div>
        <p className={`text-lg font-bold ${variant === "destructive" ? "text-destructive" : variant === "success" ? "text-primary" : ""}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// OFX Parser (SGML-based format)
function parseOFX(content: string): { transactions: Array<{ date: string; description: string; amount: number; type: string; fitid: string; memo: string }>; accountId: string } {
  const transactions: Array<{ date: string; description: string; amount: number; type: string; fitid: string; memo: string }> = [];
  let accountId = "";

  // Extract account ID
  const acctMatch = content.match(/<ACCTID>([^<\n]+)/);
  if (acctMatch) accountId = acctMatch[1].trim();

  // Extract transactions
  const stmtTrnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;
  while ((match = stmtTrnRegex.exec(content)) !== null) {
    const block = match[1];
    const getField = (name: string) => {
      const m = block.match(new RegExp(`<${name}>([^<\\n]+)`));
      return m ? m[1].trim() : "";
    };

    const rawDate = getField("DTPOSTED");
    const date = rawDate.length >= 8 ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : "";
    const amount = parseFloat(getField("TRNAMT") || "0");
    const fitid = getField("FITID");
    const description = getField("NAME") || getField("MEMO") || "Sem descrição";
    const memo = getField("MEMO");
    const trnType = getField("TRNTYPE");

    transactions.push({
      date,
      description,
      amount: Math.abs(amount),
      type: amount >= 0 ? "credit" : "debit",
      fitid,
      memo: memo !== description ? memo : "",
    });
  }

  return { transactions, accountId };
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function BankReconciliation({ stores }: { stores: StoreRow[] }) {
  const [activeTab, setActiveTab] = useState("cashflow");
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [syncingCategories, setSyncingCategories] = useState(false);

  // Filters
  const [accountFilter, setAccountFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [periodPreset, setPeriodPreset] = useState<string>("month");

  // Category management
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatType, setNewCatType] = useState<"income" | "expense">("expense");

  // Bank account management
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccName, setNewAccName] = useState("");
  const [newAccBank, setNewAccBank] = useState("");
  const [newAccStore, setNewAccStore] = useState("");
  const [newAccType, setNewAccType] = useState("checking");

  // OFX import dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [importAccountId, setImportAccountId] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [txRes, catRes, bankRes] = await Promise.all([
      supabase.from("bank_transactions").select("*").gte("transaction_date", dateFrom).lte("transaction_date", dateTo).order("transaction_date", { ascending: false }),
      supabase.from("financial_categories").select("*").eq("is_active", true).order("name"),
      supabase.from("bank_accounts").select("*").eq("is_active", true).order("name"),
    ]);
    setTransactions((txRes.data || []) as unknown as BankTransaction[]);
    setCategories((catRes.data || []) as unknown as FinancialCategory[]);
    setBankAccounts((bankRes.data || []) as unknown as BankAccount[]);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { loadData(); }, [loadData]);

  // Period shortcuts
  const setPeriod = (p: string) => {
    setPeriodPreset(p);
    const today = new Date();
    switch (p) {
      case "month": setDateFrom(format(startOfMonth(today), "yyyy-MM-dd")); setDateTo(format(endOfMonth(today), "yyyy-MM-dd")); break;
      case "last_month": { const lm = subMonths(today, 1); setDateFrom(format(startOfMonth(lm), "yyyy-MM-dd")); setDateTo(format(endOfMonth(lm), "yyyy-MM-dd")); break; }
      case "year": setDateFrom(format(startOfYear(today), "yyyy-MM-dd")); setDateTo(format(endOfYear(today), "yyyy-MM-dd")); break;
      case "week": setDateFrom(format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd")); setDateTo(format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd")); break;
    }
  };

  // Filtered transactions
  const filtered = useMemo(() => {
    let f = transactions;
    if (accountFilter !== "all") f = f.filter(t => t.bank_account_id === accountFilter);
    if (storeFilter !== "all") {
      const storeAccountIds = bankAccounts.filter(a => a.store_id === storeFilter).map(a => a.id);
      f = f.filter(t => storeAccountIds.includes(t.bank_account_id));
    }
    return f;
  }, [transactions, accountFilter, storeFilter, bankAccounts]);

  // KPIs
  const totalIncome = filtered.filter(t => t.type === "credit").reduce((s, t) => s + Number(t.amount), 0);
  const totalExpense = filtered.filter(t => t.type === "debit").reduce((s, t) => s + Number(t.amount), 0);
  const balance = totalIncome - totalExpense;
  const pendingCount = filtered.filter(t => t.classification_status === "pending" || t.classification_status === "ai_suggested").length;

  // Handle file selection - open dialog to pick account
  const handleFileSelect = (files: FileList | null) => {
    if (!files?.length) return;
    setPendingFiles(Array.from(files));
    if (bankAccounts.length === 0) {
      setShowAddAccount(true);
      toast.info("Cadastre uma conta bancária primeiro para importar OFX");
      return;
    }
    setImportAccountId(accountFilter !== "all" ? accountFilter : bankAccounts[0]?.id || "");
    setShowImportDialog(true);
  };

  // OFX Import with selected account
  const executeOFXImport = async () => {
    if (!importAccountId) { toast.error("Selecione uma conta bancária"); return; }
    setShowImportDialog(false);
    setImporting(true);
    const batchId = `import_${Date.now()}`;
    let totalImported = 0;

    for (const file of pendingFiles) {
      try {
        const content = await file.text();
        const { transactions: parsed } = parseOFX(content);
        if (!parsed.length) { toast.error(`${file.name}: nenhuma transação encontrada no OFX`); continue; }

        const rows = parsed.map(t => ({
          bank_account_id: importAccountId,
          transaction_date: t.date,
          description: t.description,
          memo: t.memo || null,
          amount: t.amount,
          type: t.type,
          fitid: t.fitid || null,
          import_batch_id: batchId,
          classification_status: "pending" as const,
        }));

        // Insert individually to handle partial unique index
        for (const row of rows) {
          if (row.fitid) {
            const { data: existing } = await supabase
              .from("bank_transactions")
              .select("id")
              .eq("bank_account_id", row.bank_account_id)
              .eq("fitid", row.fitid)
              .maybeSingle();
            if (existing) continue;
          }
          const { error } = await supabase.from("bank_transactions").insert(row as any);
          if (!error) totalImported++;
        }
      } catch (e: any) {
        toast.error(`Erro no arquivo ${file.name}: ${e.message}`);
      }
    }

    toast.success(`${totalImported} transações importadas`);
    setPendingFiles([]);
    setImporting(false);
    loadData();
  };

  // Add bank account
  const addBankAccount = async () => {
    if (!newAccName.trim()) return;
    const { error, data } = await supabase.from("bank_accounts").insert({
      name: newAccName,
      bank_name: newAccBank || null,
      store_id: newAccStore || null,
      account_type: newAccType,
    } as any).select("id").single();
    if (error) { toast.error("Erro ao criar conta"); return; }
    toast.success("Conta bancária criada");
    setNewAccName("");
    setNewAccBank("");
    setNewAccStore("");
    setShowAddAccount(false);
    await loadData();
    // If we had pending files, open import dialog
    if (pendingFiles.length > 0 && data) {
      setImportAccountId(data.id);
      setShowImportDialog(true);
    }
  };

  // AI Classification
  const classifyTransactions = async () => {
    setClassifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-classify-transactions");
      if (error) throw error;
      toast.success(`${data.classified} transações classificadas pela IA`);
      loadData();
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    }
    setClassifying(false);
  };

  // Sync categories from Tiny
  const syncCategories = async () => {
    setSyncingCategories(true);
    try {
      const { data, error } = await supabase.functions.invoke("tiny-sync-categories");
      if (error) throw error;
      toast.success(`${data.synced} categorias sincronizadas do Tiny`);
      loadData();
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    }
    setSyncingCategories(false);
  };

  // Confirm/change classification
  const confirmClassification = async (txId: string, categoryId: string) => {
    await supabase.from("bank_transactions").update({
      category_id: categoryId,
      classification_status: "confirmed",
    } as any).eq("id", txId);
    setTransactions(prev => prev.map(t => t.id === txId ? { ...t, category_id: categoryId, classification_status: "confirmed" } : t));
  };

  const manualClassify = async (txId: string, categoryId: string) => {
    await supabase.from("bank_transactions").update({
      category_id: categoryId,
      classification_status: "manual",
    } as any).eq("id", txId);
    setTransactions(prev => prev.map(t => t.id === txId ? { ...t, category_id: categoryId, classification_status: "manual" } : t));
  };

  // Add custom category
  const addCategory = async () => {
    if (!newCatName.trim()) return;
    const { error } = await supabase.from("financial_categories").insert({
      name: newCatName, type: newCatType, is_custom: true,
    } as any);
    if (error) { toast.error("Erro ao criar categoria"); return; }
    toast.success("Categoria criada");
    setNewCatName("");
    setShowAddCategory(false);
    loadData();
  };

  const getCategoryName = (id: string | null) => categories.find(c => c.id === id)?.name || "—";
  const getAccountName = (id: string) => bankAccounts.find(a => a.id === id)?.name || "—";

  // Cash Flow chart data
  const cashFlowData = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    filtered.forEach(t => {
      const day = format(new Date(t.transaction_date + "T12:00:00"), "dd/MM");
      const cur = map.get(day) || { income: 0, expense: 0 };
      if (t.type === "credit") cur.income += Number(t.amount);
      else cur.expense += Number(t.amount);
      map.set(day, cur);
    });
    return [...map.entries()].map(([date, v]) => ({ date, ...v, saldo: v.income - v.expense })).sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered]);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; income: number; expense: number }>();
    filtered.forEach(t => {
      const catId = t.category_id || t.ai_category_id;
      const catName = catId ? getCategoryName(catId) : "Sem categoria";
      const cur = map.get(catName) || { name: catName, income: 0, expense: 0 };
      if (t.type === "credit") cur.income += Number(t.amount);
      else cur.expense += Number(t.amount);
      map.set(catName, cur);
    });
    return [...map.values()].sort((a, b) => (b.expense + b.income) - (a.expense + a.income));
  }, [filtered, categories]);

  // DRE data
  const dreData = useMemo(() => {
    const incomeByCategory = new Map<string, number>();
    const expenseByCategory = new Map<string, number>();
    filtered.forEach(t => {
      const catId = t.category_id || t.ai_category_id;
      const catName = catId ? getCategoryName(catId) : "Sem categoria";
      if (t.type === "credit") {
        incomeByCategory.set(catName, (incomeByCategory.get(catName) || 0) + Number(t.amount));
      } else {
        expenseByCategory.set(catName, (expenseByCategory.get(catName) || 0) + Number(t.amount));
      }
    });
    return {
      income: [...incomeByCategory.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      expense: [...expenseByCategory.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      totalIncome,
      totalExpense,
      result: totalIncome - totalExpense,
    };
  }, [filtered, categories, totalIncome, totalExpense]);

  // Expense pie chart data
  const expensePieData = useMemo(() => {
    return categoryBreakdown.filter(c => c.expense > 0).map(c => ({ name: c.name, value: c.expense })).slice(0, 8);
  }, [categoryBreakdown]);

  if (loading) return <div className="flex items-center justify-center h-32 text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Todas empresas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas empresas</SelectItem>
            {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue placeholder="Todas as contas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as contas</SelectItem>
            {bankAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} {a.bank_name ? `(${a.bank_name})` : ''}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setShowAddAccount(true)} title="Nova conta bancária">
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center gap-1 border rounded-md p-0.5">
          {[
            { key: "week", label: "Semana" },
            { key: "month", label: "Mês" },
            { key: "last_month", label: "Mês Passado" },
            { key: "year", label: "Ano" },
            { key: "custom", label: "Período" },
          ].map(p => (
            <Button key={p.key} variant={periodPreset === p.key ? "default" : "ghost"} size="sm" className="h-7 text-[11px] px-2.5"
              onClick={() => p.key !== "custom" ? setPeriod(p.key) : setPeriodPreset("custom")}>
              {p.label}
            </Button>
          ))}
        </div>
        {periodPreset === "custom" && (
          <div className="flex items-center gap-1">
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-xs w-[130px]" />
            <span className="text-xs text-muted-foreground">—</span>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-xs w-[130px]" />
          </div>
        )}
        <div className="ml-auto flex gap-1">
          <input ref={fileInputRef} type="file" accept=".ofx,.OFX" multiple className="hidden" onChange={e => handleFileSelect(e.target.files)} />
          <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Importar OFX
          </Button>
          <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={classifyTransactions} disabled={classifying || pendingCount === 0}>
            {classifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
            Classificar IA ({pendingCount})
          </Button>
          <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={syncCategories} disabled={syncingCategories}>
            {syncingCategories ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync Categorias
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Entradas" value={fmt(totalIncome)} icon={TrendingUp} variant="success" sub={`${filtered.filter(t => t.type === 'credit').length} transações`} />
        <KPICard title="Saídas" value={fmt(totalExpense)} icon={TrendingDown} variant="destructive" sub={`${filtered.filter(t => t.type === 'debit').length} transações`} />
        <KPICard title="Saldo Período" value={fmt(balance)} icon={DollarSign} variant={balance >= 0 ? "success" : "destructive"} />
        <KPICard title="Pendentes" value={pendingCount.toString()} icon={Clock} sub="classificações por revisar" />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="cashflow" className="gap-1 text-xs"><BarChart3 className="h-3.5 w-3.5" />Fluxo de Caixa</TabsTrigger>
          <TabsTrigger value="transactions" className="gap-1 text-xs"><FileText className="h-3.5 w-3.5" />Transações</TabsTrigger>
          <TabsTrigger value="dre" className="gap-1 text-xs"><PieChartIcon className="h-3.5 w-3.5" />DRE</TabsTrigger>
          <TabsTrigger value="categories" className="gap-1 text-xs"><Filter className="h-3.5 w-3.5" />Categorias</TabsTrigger>
        </TabsList>

        {/* Cash Flow */}
        <TabsContent value="cashflow" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Fluxo de Caixa Diário</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={cashFlowData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend />
                    <Bar dataKey="income" name="Entradas" fill="hsl(142, 70%, 45%)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="Saídas" fill="hsl(0, 70%, 50%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Saídas por Categoria</CardTitle></CardHeader>
              <CardContent>
                {expensePieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={expensePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                        label={({ name, percent }) => `${name.slice(0, 15)} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {expensePieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmt(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">Importe transações para ver o gráfico</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Cumulative balance line */}
          {cashFlowData.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Saldo Acumulado</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={cashFlowData.reduce((acc, d, i) => {
                    const prevBalance = i > 0 ? acc[i - 1].cumBalance : 0;
                    acc.push({ ...d, cumBalance: prevBalance + d.saldo });
                    return acc;
                  }, [] as any[])}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Line type="monotone" dataKey="cumBalance" name="Saldo Acumulado" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Transactions */}
        <TabsContent value="transactions" className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              {filtered.length === 0 ? (
                <div className="text-center py-12 space-y-3">
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Importe arquivos OFX para começar a conciliação</p>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>Importar OFX</Button>
                </div>
              ) : (
                <div className="max-h-[600px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[90px]">Data</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="w-[100px]">Conta</TableHead>
                        <TableHead className="text-right w-[100px]">Valor</TableHead>
                        <TableHead className="w-[160px]">Categoria IA</TableHead>
                        <TableHead className="w-[160px]">Categoria Final</TableHead>
                        <TableHead className="w-[80px]">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.slice(0, 200).map(tx => (
                        <TableRow key={tx.id} className={tx.classification_status === "pending" ? "bg-muted/30" : ""}>
                          <TableCell className="text-xs">{format(new Date(tx.transaction_date + "T12:00:00"), "dd/MM/yy")}</TableCell>
                          <TableCell className="text-xs max-w-[250px] truncate" title={tx.description}>
                            {tx.description}
                            {tx.memo && <span className="text-muted-foreground ml-1">({tx.memo})</span>}
                          </TableCell>
                          <TableCell className="text-xs">{getAccountName(tx.bank_account_id)}</TableCell>
                          <TableCell className={`text-right text-xs font-semibold ${tx.type === "credit" ? "text-primary" : "text-destructive"}`}>
                            {tx.type === "credit" ? "+" : "-"}{fmt(Number(tx.amount))}
                          </TableCell>
                          <TableCell className="text-xs">
                            {tx.ai_category_id ? (
                              <div className="flex items-center gap-1">
                                <span className="truncate">{getCategoryName(tx.ai_category_id)}</span>
                                {tx.ai_confidence && (
                                  <Badge variant="secondary" className="text-[9px] px-1">{Math.round(Number(tx.ai_confidence) * 100)}%</Badge>
                                )}
                                {tx.classification_status === "ai_suggested" && (
                                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => confirmClassification(tx.id, tx.ai_category_id!)}>
                                    <CheckCircle2 className="h-3 w-3 text-primary" />
                                  </Button>
                                )}
                              </div>
                            ) : "—"}
                          </TableCell>
                          <TableCell>
                            <Select value={tx.category_id || ""} onValueChange={v => manualClassify(tx.id, v)}>
                              <SelectTrigger className="h-7 text-[11px] w-[140px]">
                                <SelectValue placeholder="Selecionar" />
                              </SelectTrigger>
                              <SelectContent>
                                {categories.map(c => (
                                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {tx.classification_status === "confirmed" && <Badge className="text-[9px] bg-primary/20 text-primary">✓</Badge>}
                            {tx.classification_status === "manual" && <Badge className="text-[9px] bg-accent/20 text-accent-foreground">Manual</Badge>}
                            {tx.classification_status === "ai_suggested" && <Badge variant="outline" className="text-[9px]">IA</Badge>}
                            {tx.classification_status === "pending" && <Badge variant="secondary" className="text-[9px]">Pendente</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filtered.length > 200 && <p className="text-xs text-muted-foreground text-center py-2">Mostrando 200 de {filtered.length} transações</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* DRE */}
        <TabsContent value="dre" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Demonstração do Resultado do Exercício (DRE)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* Income */}
              <div>
                <h4 className="text-xs font-bold text-primary mb-2 flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> RECEITAS</h4>
                <Table>
                  <TableBody>
                    {dreData.income.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs py-1.5">{item.name}</TableCell>
                        <TableCell className="text-right text-xs py-1.5 font-semibold text-primary">{fmt(item.value)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-bold">
                      <TableCell className="text-xs py-2">TOTAL RECEITAS</TableCell>
                      <TableCell className="text-right text-xs py-2 text-primary">{fmt(dreData.totalIncome)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {/* Expenses */}
              <div>
                <h4 className="text-xs font-bold text-destructive mb-2 flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5" /> DESPESAS</h4>
                <Table>
                  <TableBody>
                    {dreData.expense.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs py-1.5">{item.name}</TableCell>
                        <TableCell className="text-right text-xs py-1.5 font-semibold text-destructive">-{fmt(item.value)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-bold">
                      <TableCell className="text-xs py-2">TOTAL DESPESAS</TableCell>
                      <TableCell className="text-right text-xs py-2 text-destructive">-{fmt(dreData.totalExpense)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {/* Result */}
              <div className={`p-4 rounded-lg border-2 ${dreData.result >= 0 ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5"}`}>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm">RESULTADO LÍQUIDO</span>
                  <span className={`text-xl font-bold ${dreData.result >= 0 ? "text-primary" : "text-destructive"}`}>
                    {fmt(dreData.result)}
                  </span>
                </div>
                {dreData.totalIncome > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Margem: {((dreData.result / dreData.totalIncome) * 100).toFixed(1)}%
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categories */}
        <TabsContent value="categories" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Categorias Financeiras</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={() => setShowAddCategory(true)}>
                <Plus className="h-3.5 w-3.5" /> Nova Categoria
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Income categories */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-primary">Receitas</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {categories.filter(c => c.type === "income").map(c => (
                    <div key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 text-xs">
                      <span>{c.name}</span>
                      <div className="flex items-center gap-1">
                        {c.is_custom && <Badge variant="secondary" className="text-[9px]">Custom</Badge>}
                        {!c.is_custom && <Badge variant="outline" className="text-[9px]">Tiny</Badge>}
                      </div>
                    </div>
                  ))}
                  {categories.filter(c => c.type === "income").length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">Sincronize categorias do Tiny</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Expense categories */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-destructive">Despesas</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {categories.filter(c => c.type === "expense").map(c => (
                    <div key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 text-xs">
                      <span>{c.name}</span>
                      <div className="flex items-center gap-1">
                        {c.is_custom && <Badge variant="secondary" className="text-[9px]">Custom</Badge>}
                        {!c.is_custom && <Badge variant="outline" className="text-[9px]">Tiny</Badge>}
                      </div>
                    </div>
                  ))}
                  {categories.filter(c => c.type === "expense").length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">Sincronize categorias do Tiny</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Category usage summary */}
          {categoryBreakdown.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Uso por Categoria (Período)</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Categoria</TableHead>
                      <TableHead className="text-right">Entradas</TableHead>
                      <TableHead className="text-right">Saídas</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryBreakdown.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{c.name}</TableCell>
                        <TableCell className="text-right text-xs text-primary">{c.income > 0 ? fmt(c.income) : "—"}</TableCell>
                        <TableCell className="text-right text-xs text-destructive">{c.expense > 0 ? fmt(c.expense) : "—"}</TableCell>
                        <TableCell className={`text-right text-xs font-semibold ${c.income - c.expense >= 0 ? "text-primary" : "text-destructive"}`}>
                          {fmt(c.income - c.expense)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Add Category Dialog */}
          <Dialog open={showAddCategory} onOpenChange={setShowAddCategory}>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova Categoria</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Nome</Label>
                  <Input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Ex: Marketing Digital" className="h-9" />
                </div>
                <div>
                  <Label className="text-xs">Tipo</Label>
                  <Select value={newCatType} onValueChange={(v: any) => setNewCatType(v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="income">Receita</SelectItem>
                      <SelectItem value="expense">Despesa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full" onClick={addCategory}>Criar Categoria</Button>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>

      {/* Add Bank Account Dialog */}
      <Dialog open={showAddAccount} onOpenChange={setShowAddAccount}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova Conta Bancária</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome da Conta</Label>
              <Input value={newAccName} onChange={e => setNewAccName(e.target.value)} placeholder="Ex: Bradesco PJ - Loja Centro" className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Banco</Label>
              <Input value={newAccBank} onChange={e => setNewAccBank(e.target.value)} placeholder="Ex: Bradesco, Itaú, Nubank..." className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Empresa (Loja)</Label>
              <Select value={newAccStore} onValueChange={setNewAccStore}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a loja" /></SelectTrigger>
                <SelectContent>
                  {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={newAccType} onValueChange={setNewAccType}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Conta Corrente</SelectItem>
                  <SelectItem value="savings">Poupança</SelectItem>
                  <SelectItem value="investment">Investimento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={addBankAccount} disabled={!newAccName.trim()}>Criar Conta</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* OFX Import Account Selection Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Importar OFX — Selecionar Conta</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {pendingFiles.length} arquivo(s) selecionado(s). Escolha a conta bancária destino:
            </p>
            <Select value={importAccountId} onValueChange={setImportAccountId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
              <SelectContent>
                {bankAccounts.map(a => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} {a.bank_name ? `(${a.bank_name})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setShowImportDialog(false); setShowAddAccount(true); }}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Nova Conta
              </Button>
              <Button className="flex-1" onClick={executeOFXImport} disabled={!importAccountId}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Importar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
