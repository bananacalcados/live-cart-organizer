import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DollarSign, Users, TrendingUp, Clock, RefreshCw, Target, Send,
  BarChart3, Loader2, ArrowUpRight, Percent,
} from "lucide-react";

interface CampaignResult {
  campaign: string;
  type: "lead_capture" | "mass_dispatch";
  leads_captured: number;
  leads_converted: number;
  conversion_rate: number;
  total_revenue: number;
  avg_ticket: number;
  avg_conversion_days: number;
}

interface Summary {
  total_leads: number;
  total_leads_converted: number;
  total_lead_revenue: number;
  total_dispatches_sent: number;
  total_dispatch_conversions: number;
  total_dispatch_revenue: number;
  overall_revenue: number;
  avg_conversion_days: number;
}

export function MarketingAttributionDashboard() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignResult[]>([]);
  const [filter, setFilter] = useState<"all" | "lead_capture" | "mass_dispatch">("all");

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketing-attribution-dashboard");
      if (error) throw error;
      setSummary(data.summary);
      setCampaigns(data.campaigns || []);
    } catch (err) {
      console.error("Error fetching attribution:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const fmt = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const filtered = filter === "all"
    ? campaigns
    : campaigns.filter((c) => c.type === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Calculando atribuição de vendas...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Dashboard de Atribuição</h3>
          <p className="text-xs text-muted-foreground">
            ROI de captação de leads e disparos em massa (janela de 7 dias para clientes existentes)
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} className="gap-1">
          <RefreshCw className="h-3.5 w-3.5" />Atualizar
        </Button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                <p className="text-xs text-muted-foreground">Faturamento Atribuído</p>
              </div>
              <p className="text-xl font-bold text-emerald-500">{fmt(summary.overall_revenue)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Target className="h-4 w-4 text-blue-500" />
                <p className="text-xs text-muted-foreground">Leads Captados</p>
              </div>
              <p className="text-xl font-bold">{summary.total_leads.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {summary.total_leads_converted} convertidos → {fmt(summary.total_lead_revenue)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Send className="h-4 w-4 text-violet-500" />
                <p className="text-xs text-muted-foreground">Disparos em Massa</p>
              </div>
              <p className="text-xl font-bold">{summary.total_dispatches_sent.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {summary.total_dispatch_conversions} conversões → {fmt(summary.total_dispatch_revenue)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-amber-500" />
                <p className="text-xs text-muted-foreground">Tempo Médio Conversão</p>
              </div>
              <p className="text-xl font-bold">{summary.avg_conversion_days} dias</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("all")}
          className="text-xs"
        >
          Todas ({campaigns.length})
        </Button>
        <Button
          variant={filter === "lead_capture" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("lead_capture")}
          className="text-xs gap-1"
        >
          <Target className="h-3 w-3" />
          Leads ({campaigns.filter((c) => c.type === "lead_capture").length})
        </Button>
        <Button
          variant={filter === "mass_dispatch" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("mass_dispatch")}
          className="text-xs gap-1"
        >
          <Send className="h-3 w-3" />
          Disparos ({campaigns.filter((c) => c.type === "mass_dispatch").length})
        </Button>
      </div>

      {/* Table */}
      <Card>
        <ScrollArea className="max-h-[500px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Captados</TableHead>
                <TableHead className="text-right">Convertidos</TableHead>
                <TableHead className="text-right">Taxa Conv.</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">Ticket Médio</TableHead>
                <TableHead className="text-right">Tempo Médio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium max-w-[200px] truncate">{c.campaign}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      c.type === "lead_capture"
                        ? "bg-blue-500/10 text-blue-500 border-blue-500/30 text-[10px]"
                        : "bg-violet-500/10 text-violet-500 border-violet-500/30 text-[10px]"
                    }>
                      {c.type === "lead_capture" ? "Lead" : "Disparo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{c.leads_captured.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <span className={c.leads_converted > 0 ? "text-emerald-500 font-medium" : ""}>
                      {c.leads_converted}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={c.conversion_rate > 5 ? "text-emerald-500" : c.conversion_rate > 0 ? "text-amber-500" : "text-muted-foreground"}>
                      {c.conversion_rate}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {c.total_revenue > 0 ? fmt(c.total_revenue) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.avg_ticket > 0 ? fmt(c.avg_ticket) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {c.avg_conversion_days > 0 ? `${c.avg_conversion_days}d` : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    Nenhuma campanha com dados de atribuição
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </Card>

      {/* Totals row */}
      {filtered.length > 0 && (
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-medium">TOTAL ({filtered.length} campanhas)</span>
              <div className="flex gap-6">
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Captados</p>
                  <p className="font-bold">{filtered.reduce((a, b) => a + b.leads_captured, 0).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Convertidos</p>
                  <p className="font-bold text-emerald-500">{filtered.reduce((a, b) => a + b.leads_converted, 0)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Faturamento</p>
                  <p className="font-bold text-emerald-500">{fmt(filtered.reduce((a, b) => a + b.total_revenue, 0))}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
