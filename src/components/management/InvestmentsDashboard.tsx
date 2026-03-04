import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart3, RefreshCw, Loader2, Plus, Trash2, TrendingUp,
  DollarSign, MessageSquare, Settings, Megaphone
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { toast } from "sonner";

interface MetaAdAccount {
  id: string;
  account_id: string;
  account_name: string | null;
  is_active: boolean;
}

interface MetaAdSpend {
  id: string;
  account_id: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpm: number;
  cpc: number;
}

interface DispatchRow {
  id: string;
  template_name: string;
  sent_count: number | null;
  started_at: string;
  status: string | null;
  cost_per_message: number | null;
}

type Period = "7d" | "30d" | "month" | "custom";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function InvestmentsDashboard() {
  const [period, setPeriod] = useState<Period>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([]);
  const [adSpend, setAdSpend] = useState<MetaAdSpend[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [newAccountId, setNewAccountId] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [costPerMessage, setCostPerMessage] = useState("0.50");

  const { dateFrom, dateTo } = useMemo(() => {
    const now = new Date();
    switch (period) {
      case "7d":
        return { dateFrom: format(subDays(now, 7), "yyyy-MM-dd"), dateTo: format(now, "yyyy-MM-dd") };
      case "30d":
        return { dateFrom: format(subDays(now, 30), "yyyy-MM-dd"), dateTo: format(now, "yyyy-MM-dd") };
      case "month":
        return { dateFrom: format(startOfMonth(now), "yyyy-MM-dd"), dateTo: format(endOfMonth(now), "yyyy-MM-dd") };
      case "custom":
        return { dateFrom: customFrom, dateTo: customTo };
    }
  }, [period, customFrom, customTo]);

  useEffect(() => {
    loadData();
    loadCostConfig();
  }, []);

  useEffect(() => {
    if (dateFrom && dateTo) fetchSpendAndDispatches();
  }, [dateFrom, dateTo]);

  const loadCostConfig = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "dispatch_cost_per_message")
      .maybeSingle();
    if (data?.value) setCostPerMessage(String(data.value));
  };

  const saveCostConfig = async () => {
    await supabase
      .from("app_settings")
      .upsert({ key: "dispatch_cost_per_message", value: parseFloat(costPerMessage) as any }, { onConflict: "key" });
    toast.success("Custo por mensagem salvo!");
    setShowConfig(false);
  };

  const loadData = async () => {
    const { data } = await supabase
      .from("meta_ad_accounts")
      .select("*")
      .eq("is_active", true)
      .order("account_name");
    setAdAccounts((data as MetaAdAccount[]) || []);
  };

  const fetchSpendAndDispatches = async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);

    const [spendRes, dispatchRes] = await Promise.all([
      supabase
        .from("meta_ad_spend_daily")
        .select("*")
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date"),
      supabase
        .from("dispatch_history")
        .select("id, template_name, sent_count, started_at, status, cost_per_message")
        .gte("started_at", dateFrom)
        .lte("started_at", dateTo + "T23:59:59")
        .order("started_at", { ascending: false }),
    ]);

    setAdSpend((spendRes.data as MetaAdSpend[]) || []);
    setDispatches((dispatchRes.data as DispatchRow[]) || []);
    setLoading(false);
  };

  const syncAds = async () => {
    setSyncing(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-ads-sync-spend`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ date_from: dateFrom, date_to: dateTo }),
        }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(`${data.synced} registros sincronizados`);
      if (data.errors?.length) toast.warning(`Erros: ${data.errors.join(", ")}`);
      fetchSpendAndDispatches();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const addAccount = async () => {
    if (!newAccountId.trim()) return;
    const accountId = newAccountId.startsWith("act_") ? newAccountId : `act_${newAccountId}`;
    const { error } = await supabase.from("meta_ad_accounts").insert({
      account_id: accountId,
      account_name: newAccountName || accountId,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Conta adicionada!");
    setNewAccountId("");
    setNewAccountName("");
    setShowAddAccount(false);
    loadData();
  };

  const removeAccount = async (id: string) => {
    await supabase.from("meta_ad_accounts").update({ is_active: false }).eq("id", id);
    toast.success("Conta removida");
    loadData();
  };

  // KPIs
  const cost = parseFloat(costPerMessage) || 0.5;
  const totalAdsSpend = adSpend.reduce((s, r) => s + Number(r.spend), 0);
  const totalImpressions = adSpend.reduce((s, r) => s + Number(r.impressions), 0);
  const totalClicks = adSpend.reduce((s, r) => s + Number(r.clicks), 0);
  const totalSentMessages = dispatches.reduce((s, d) => s + (d.sent_count || 0), 0);
  const totalDispatchCost = dispatches.reduce((s, d) => {
    const unitCost = d.cost_per_message != null ? Number(d.cost_per_message) : cost;
    return s + (d.sent_count || 0) * unitCost;
  }, 0);
  const totalInvestment = totalAdsSpend + totalDispatchCost;

  // Chart data: daily spend ads + dispatches
  const chartData = useMemo(() => {
    const map = new Map<string, { date: string; ads: number; disparos: number }>();

    adSpend.forEach((r) => {
      const d = r.date;
      const cur = map.get(d) || { date: d, ads: 0, disparos: 0 };
      cur.ads += Number(r.spend);
      map.set(d, cur);
    });

    dispatches.forEach((d) => {
      const day = d.started_at?.split("T")[0];
      if (!day) return;
      const unitCost = d.cost_per_message != null ? Number(d.cost_per_message) : cost;
      const cur = map.get(day) || { date: day, ads: 0, disparos: 0 };
      cur.disparos += (d.sent_count || 0) * unitCost;
      map.set(day, cur);
    });

    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [adSpend, dispatches, cost]);

  // Breakdown by account
  const accountBreakdown = useMemo(() => {
    const map = new Map<string, { spend: number; impressions: number; clicks: number }>();
    adSpend.forEach((r) => {
      const cur = map.get(r.account_id) || { spend: 0, impressions: 0, clicks: 0 };
      cur.spend += Number(r.spend);
      cur.impressions += Number(r.impressions);
      cur.clicks += Number(r.clicks);
      map.set(r.account_id, cur);
    });
    return [...map.entries()].map(([accountId, v]) => ({
      accountId,
      accountName: adAccounts.find((a) => a.account_id === accountId)?.account_name || accountId,
      ...v,
      cpc: v.clicks > 0 ? v.spend / v.clicks : 0,
      cpm: v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0,
    }));
  }, [adSpend, adAccounts]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Investimentos — Meta Ads + Disparos</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={() => setShowConfig(true)}>
            <Settings className="h-3.5 w-3.5" /> Configurar
          </Button>
          <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={() => setShowAddAccount(true)}>
            <Plus className="h-3.5 w-3.5" /> Conta Meta
          </Button>
          <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={syncAds} disabled={syncing}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sincronizar Ads
          </Button>
        </div>
      </div>

      {/* Period Filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1 border rounded-md p-0.5">
          {([
            { key: "7d", label: "7 dias" },
            { key: "30d", label: "30 dias" },
            { key: "month", label: "Mês" },
            { key: "custom", label: "Período" },
          ] as const).map((p) => (
            <Button
              key={p.key}
              variant={period === p.key ? "default" : "ghost"}
              size="sm"
              className="h-7 text-[11px] px-2.5"
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex gap-2">
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 w-36 text-xs" />
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 w-36 text-xs" />
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Total Ads</span>
              <Megaphone className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-lg font-bold">{fmt(totalAdsSpend)}</p>
            <p className="text-[10px] text-muted-foreground">{adAccounts.length} contas ativas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Total Disparos</span>
              <MessageSquare className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-lg font-bold">{fmt(totalDispatchCost)}</p>
            <p className="text-[10px] text-muted-foreground">{totalSentMessages.toLocaleString("pt-BR")} msgs × {fmt(cost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Investimento Total</span>
              <DollarSign className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-lg font-bold">{fmt(totalInvestment)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Impressões</span>
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-lg font-bold">{totalImpressions.toLocaleString("pt-BR")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Cliques</span>
              <BarChart3 className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-lg font-bold">{totalClicks.toLocaleString("pt-BR")}</p>
            <p className="text-[10px] text-muted-foreground">
              CPC médio {totalClicks > 0 ? fmt(totalAdsSpend / totalClicks) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Gastos Diários</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => {
                  const parts = v.split("-");
                  return `${parts[2]}/${parts[1]}`;
                }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `R$${v}`} />
                <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={(l) => {
                  const parts = l.split("-");
                  return `${parts[2]}/${parts[1]}/${parts[0]}`;
                }} />
                <Legend />
                <Bar dataKey="ads" name="Meta Ads" fill="hsl(var(--primary))" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="disparos" name="Disparos" fill="hsl(var(--accent))" stackId="a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Account Breakdown */}
      {accountBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Breakdown por Conta de Anúncio</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Conta</TableHead>
                  <TableHead className="text-xs text-right">Gasto</TableHead>
                  <TableHead className="text-xs text-right">Impressões</TableHead>
                  <TableHead className="text-xs text-right">Cliques</TableHead>
                  <TableHead className="text-xs text-right">CPC</TableHead>
                  <TableHead className="text-xs text-right">CPM</TableHead>
                  <TableHead className="text-xs w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountBreakdown.map((row) => (
                  <TableRow key={row.accountId}>
                    <TableCell className="text-xs font-medium">{row.accountName}</TableCell>
                    <TableCell className="text-xs text-right font-bold">{fmt(row.spend)}</TableCell>
                    <TableCell className="text-xs text-right">{row.impressions.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-xs text-right">{row.clicks.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-xs text-right">{fmt(row.cpc)}</TableCell>
                    <TableCell className="text-xs text-right">{fmt(row.cpm)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          const acc = adAccounts.find((a) => a.account_id === row.accountId);
                          if (acc) removeAccount(acc.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Dispatch Breakdown */}
      {dispatches.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Breakdown de Disparos</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Template</TableHead>
                  <TableHead className="text-xs text-right">Enviadas</TableHead>
                  <TableHead className="text-xs text-right">Custo Unit.</TableHead>
                  <TableHead className="text-xs text-right">Custo Total</TableHead>
                  <TableHead className="text-xs">Data</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dispatches.map((d) => {
                  const unitCost = d.cost_per_message != null ? Number(d.cost_per_message) : cost;
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs font-medium">{d.template_name}</TableCell>
                      <TableCell className="text-xs text-right">{(d.sent_count || 0).toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-xs text-right">{fmt(unitCost)}</TableCell>
                      <TableCell className="text-xs text-right font-bold">{fmt((d.sent_count || 0) * unitCost)}</TableCell>
                      <TableCell className="text-xs">
                        {d.started_at ? format(new Date(d.started_at), "dd/MM HH:mm") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.status === "completed" ? "default" : "secondary"} className="text-[10px]">
                          {d.status || "—"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Empty states */}
      {!loading && adAccounts.length === 0 && dispatches.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Megaphone className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">Nenhum dado de investimento</p>
            <p className="text-xs mt-1">Adicione contas Meta Ads ou faça disparos para ver dados aqui.</p>
          </CardContent>
        </Card>
      )}

      {/* Add Account Dialog */}
      <Dialog open={showAddAccount} onOpenChange={setShowAddAccount}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Conta Meta Ads</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Account ID *</Label>
              <Input
                value={newAccountId}
                onChange={(e) => setNewAccountId(e.target.value)}
                placeholder="act_123456789"
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Encontre no Gerenciador de Anúncios → Configurações da Conta
              </p>
            </div>
            <div>
              <Label className="text-xs">Nome da Conta</Label>
              <Input
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="Ex: Conta Principal"
                className="h-9"
              />
            </div>
            <Button className="w-full" onClick={addAccount}>
              Adicionar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cost Config Dialog */}
      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar Custos</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Custo por mensagem de template (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={costPerMessage}
                onChange={(e) => setCostPerMessage(e.target.value)}
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Templates de marketing Meta custam ~R$0,25-0,80. Valor padrão usado quando não há custo específico no disparo.
              </p>
            </div>
            <Button className="w-full" onClick={saveCostConfig}>
              Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
