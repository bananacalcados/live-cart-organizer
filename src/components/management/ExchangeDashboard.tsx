import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { RefreshCw, ArrowLeftRight, AlertTriangle, TrendingUp, Package } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

type ExchangeRequest = {
  id: string;
  phone: string;
  customer_name: string | null;
  order_number: string | null;
  product_name: string;
  product_size: string | null;
  desired_size: string | null;
  reason_category: string;
  reason_subcategory: string | null;
  ai_nuance_tags: string[];
  customer_verbatim: string | null;
  ai_interpretation: string | null;
  fit_area: string | null;
  fit_detail: string | null;
  reverse_shipping_code: string | null;
  status: string;
  auto_approved: boolean;
  requires_human_review: boolean;
  review_notes: string | null;
  created_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  solicitado: "Solicitado",
  aprovado: "Aprovado",
  aguardando_postagem: "Aguardando Postagem",
  em_transito: "Em Trânsito",
  recebido: "Recebido",
  concluido: "Concluído",
  recusado: "Recusado",
  cancelado: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  solicitado: "bg-yellow-100 text-yellow-800",
  aprovado: "bg-green-100 text-green-800",
  aguardando_postagem: "bg-blue-100 text-blue-800",
  em_transito: "bg-indigo-100 text-indigo-800",
  recebido: "bg-purple-100 text-purple-800",
  concluido: "bg-emerald-100 text-emerald-800",
  recusado: "bg-red-100 text-red-800",
  cancelado: "bg-gray-100 text-gray-800",
};

const CATEGORY_LABELS: Record<string, string> = {
  tamanho: "Tamanho",
  defeito: "Defeito",
  nao_gostou: "Não Gostou",
  produto_errado: "Produto Errado",
  outro: "Outro",
};

const CHART_COLORS = ["#f59e0b", "#ef4444", "#8b5cf6", "#3b82f6", "#6b7280"];

export default function ExchangeDashboard() {
  const [exchanges, setExchanges] = useState<ExchangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [periodDays, setPeriodDays] = useState(30);

  const fetchExchanges = async () => {
    setLoading(true);
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await (supabase as any)
      .from("exchange_requests")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar trocas");
      console.error(error);
    } else {
      setExchanges(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchExchanges(); }, [periodDays]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return exchanges;
    return exchanges.filter((e) => e.status === statusFilter);
  }, [exchanges, statusFilter]);

  // Stats
  const stats = useMemo(() => {
    const total = exchanges.length;
    const pending = exchanges.filter((e) => ["solicitado"].includes(e.status)).length;
    const autoApproved = exchanges.filter((e) => e.auto_approved).length;
    const byCategory: Record<string, number> = {};
    exchanges.forEach((e) => {
      byCategory[e.reason_category] = (byCategory[e.reason_category] || 0) + 1;
    });
    return { total, pending, autoApproved, byCategory };
  }, [exchanges]);

  // Charts data
  const categoryChartData = useMemo(() => {
    return Object.entries(stats.byCategory).map(([key, value]) => ({
      name: CATEGORY_LABELS[key] || key,
      value,
    }));
  }, [stats.byCategory]);

  const fitAreaData = useMemo(() => {
    const areas: Record<string, number> = {};
    exchanges
      .filter((e) => e.reason_category === "tamanho" && e.fit_area)
      .forEach((e) => {
        const area = e.fit_area!;
        areas[area] = (areas[area] || 0) + 1;
      });
    return Object.entries(areas)
      .map(([name, count]) => ({ name: name.replace(/_/g, " "), count }))
      .sort((a, b) => b.count - a.count);
  }, [exchanges]);

  const productRankData = useMemo(() => {
    const products: Record<string, { count: number; reasons: Record<string, number> }> = {};
    exchanges.forEach((e) => {
      const key = e.product_name;
      if (!products[key]) products[key] = { count: 0, reasons: {} };
      products[key].count++;
      const cat = e.reason_category;
      products[key].reasons[cat] = (products[key].reasons[cat] || 0) + 1;
    });
    return Object.entries(products)
      .map(([name, data]) => ({
        name: name.length > 30 ? name.slice(0, 30) + "…" : name,
        fullName: name,
        count: data.count,
        topReason: Object.entries(data.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] || "",
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [exchanges]);

  const nuanceTagData = useMemo(() => {
    const tags: Record<string, number> = {};
    exchanges.forEach((e) => {
      (e.ai_nuance_tags || []).forEach((tag) => {
        tags[tag] = (tags[tag] || 0) + 1;
      });
    });
    return Object.entries(tags)
      .map(([tag, count]) => ({ tag: tag.replace(/_/g, " "), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [exchanges]);

  const updateStatus = async (id: string, newStatus: string) => {
    const { error } = await (supabase as any)
      .from("exchange_requests")
      .update({ status: newStatus, reviewed_at: new Date().toISOString() })
      .eq("id", id);

    if (error) toast.error("Erro ao atualizar status");
    else {
      toast.success("Status atualizado!");
      fetchExchanges();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6" /> Trocas e Devoluções
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Análise inteligente dos motivos de troca
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
              <SelectItem value="365">1 ano</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchExchanges}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Total de Trocas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            <p className="text-xs text-muted-foreground">Pendentes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-green-600">{stats.autoApproved}</div>
            <p className="text-xs text-muted-foreground">Auto-Aprovadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-primary">
              {stats.total > 0 ? Math.round((stats.autoApproved / stats.total) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">Taxa Automação</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="analytics">
        <TabsList>
          <TabsTrigger value="analytics">📊 Análises</TabsTrigger>
          <TabsTrigger value="list">📋 Solicitações</TabsTrigger>
        </TabsList>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Reasons Pie Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Motivos de Troca</CardTitle>
              </CardHeader>
              <CardContent>
                {categoryChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={categoryChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {categoryChartData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-center py-8">Sem dados</p>
                )}
              </CardContent>
            </Card>

            {/* Fit Area Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> Áreas do Pé (Trocas por Tamanho)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fitAreaData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={fitAreaData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-center py-8">Sem dados de fit</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Products Ranking */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" /> Top Produtos com Mais Trocas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {productRankData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={productRankData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                    <YAxis />
                    <Tooltip formatter={(val: any, _: any, props: any) => [val, props.payload.fullName]} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-foreground text-center py-8">Sem dados</p>
              )}
            </CardContent>
          </Card>

          {/* Nuance Tags */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Tags de Nuance (Interpretação IA)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {nuanceTagData.map((t) => (
                  <Badge key={t.tag} variant="secondary" className="text-sm">
                    {t.tag} <span className="ml-1 font-bold">({t.count})</span>
                  </Badge>
                ))}
                {nuanceTagData.length === 0 && (
                  <p className="text-muted-foreground">Sem tags ainda</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* List Tab */}
        <TabsContent value="list" className="space-y-4">
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filtrar por status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(STATUS_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="border rounded-lg overflow-auto max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Nuances</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((ex) => (
                  <TableRow key={ex.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(new Date(ex.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{ex.customer_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{ex.phone}</div>
                    </TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate" title={ex.product_name}>
                      <div>{ex.product_name}</div>
                      {ex.product_size && (
                        <div className="text-xs text-muted-foreground">
                          Tam: {ex.product_size} → {ex.desired_size || "?"}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {CATEGORY_LABELS[ex.reason_category] || ex.reason_category}
                      </Badge>
                      {ex.reason_subcategory && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {ex.reason_subcategory.replace(/_/g, " ")}
                        </div>
                      )}
                      {ex.ai_interpretation && (
                        <div className="text-xs text-muted-foreground mt-1 max-w-[200px] line-clamp-2" title={ex.ai_interpretation}>
                          💡 {ex.ai_interpretation}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(ex.ai_nuance_tags || []).slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px] px-1">
                            {tag.replace(/_/g, " ")}
                          </Badge>
                        ))}
                      </div>
                      {ex.fit_area && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {ex.fit_area} / {ex.fit_detail || "—"}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[ex.status] || ""}`}>
                        {STATUS_LABELS[ex.status] || ex.status}
                      </span>
                      {ex.auto_approved && (
                        <div className="text-[10px] text-green-600 mt-1">✅ Auto</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {ex.status === "solicitado" && ex.requires_human_review && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => updateStatus(ex.id, "aprovado")}>
                            Aprovar
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={() => updateStatus(ex.id, "recusado")}>
                            Recusar
                          </Button>
                        </div>
                      )}
                      {ex.status === "aprovado" && (
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => updateStatus(ex.id, "aguardando_postagem")}>
                          Postagem
                        </Button>
                      )}
                      {ex.reverse_shipping_code && (
                        <div className="text-[10px] text-blue-600 mt-1">
                          📦 {ex.reverse_shipping_code}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Nenhuma troca encontrada
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
