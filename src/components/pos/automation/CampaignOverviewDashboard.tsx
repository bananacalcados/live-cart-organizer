import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Loader2, RefreshCw, Percent, DollarSign, TrendingUp,
  ShoppingBag, Package, Users, Megaphone, Send, Calendar, Store,
  ChevronDown, ChevronUp,
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface OverviewStats {
  campanhas: number;
  total: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falhou: number;
  nao_entregavel: number;
  pendente: number;
  conversoes: number;
  valor_conversao: number;
  itens_vendidos: number;
  custo_por_msg: number;
  custo: number;
  roas: number;
  taxa_conversao: number;
  ticket_medio: number;
}

interface ConvItem {
  name: string | null;
  variant: string | null;
  size: string | null;
  qty: number;
  price: number;
}
interface ConvSale {
  id: string;
  campanha: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  date: string;
  total: number;
  subtotal: number;
  discount: number;
  payment_method: string | null;
  sale_type: string | null;
  seller: string | null;
  store: string | null;
  items: ConvItem[];
}

const brl = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "—";

const toISO = (d: Date) => {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
};

type PresetKey = "7d" | "30d" | "this_month" | "last_month" | "prev_2_months" | "custom";

function computePreset(key: PresetKey): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case "7d": {
      const s = new Date(now); s.setDate(s.getDate() - 6);
      return { start: toISO(s), end: toISO(now) };
    }
    case "30d": {
      const s = new Date(now); s.setDate(s.getDate() - 29);
      return { start: toISO(s), end: toISO(now) };
    }
    case "this_month":
      return { start: toISO(new Date(y, m, 1)), end: toISO(now) };
    case "last_month":
      return { start: toISO(new Date(y, m - 1, 1)), end: toISO(new Date(y, m, 0)) };
    case "prev_2_months":
      return { start: toISO(new Date(y, m - 2, 1)), end: toISO(new Date(y, m, 0)) };
    default:
      return { start: toISO(new Date(y, m, 1)), end: toISO(now) };
  }
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "this_month", label: "Este mês" },
  { key: "last_month", label: "Mês passado" },
  { key: "prev_2_months", label: "2 meses" },
  { key: "custom", label: "Período específico" },
];

function Metric({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-neutral-500">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className={`mt-1 text-xl font-bold ${accent || "text-neutral-800"}`}>{value}</p>
      {sub && <p className="text-[11px] text-neutral-400">{sub}</p>}
    </Card>
  );
}

const saleTypeLabel = (t: string | null) =>
  t === "online" || t === "pickup" ? "Online" : "Presencial";

export function CampaignOverviewDashboard({ onClose }: { onClose: () => void }) {
  const [preset, setPreset] = useState<PresetKey>("30d");
  const initial = computePreset("30d");
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);

  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<ConvSale[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [showList, setShowList] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setLoadingSales(true);
    const [{ data: st, error: e1 }, { data: cs, error: e2 }] = await Promise.all([
      supabase.rpc("campaigns_overview_stats", { p_start: start, p_end: end }),
      supabase.rpc("campaigns_overview_conversions", { p_start: start, p_end: end }),
    ]);
    if (e1) toast.error("Erro ao carregar painel geral");
    if (e2) toast.error("Erro ao carregar conversões");
    setStats((st as unknown as OverviewStats) || null);
    setSales((cs as unknown as ConvSale[]) || []);
    setLoading(false);
    setLoadingSales(false);
  };

  useEffect(() => { load(); }, [start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyPreset = (key: PresetKey) => {
    setPreset(key);
    if (key !== "custom") {
      const r = computePreset(key);
      setStart(r.start);
      setEnd(r.end);
    }
  };

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const uniqueBuyers = useMemo(() => {
    const s = new Set<string>();
    sales.forEach((v) => s.add((v.customer_phone || v.customer_name || v.id)));
    return s.size;
  }, [sales]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="gap-2 text-neutral-700" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" /> Voltar às automações
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={load}>
          <RefreshCw className="h-4 w-4" /> Atualizar
        </Button>
      </div>

      <div>
        <h3 className="text-base font-bold text-neutral-800">Painel geral das automações</h3>
        <p className="text-xs text-neutral-500">
          Resultados consolidados de todos os disparos no período selecionado (conversões em até 7 dias úteis após cada envio).
        </p>
      </div>

      {/* Filtro de período */}
      <Card className="p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={preset === p.key ? "default" : "outline"}
              className={preset === p.key ? "bg-blue-600 hover:bg-blue-700" : ""}
              onClick={() => applyPreset(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-neutral-500">De</span>
              <Input type="date" value={start} max={end} className="h-8 w-[150px]"
                onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-neutral-500">Até</span>
              <Input type="date" value={end} min={start} className="h-8 w-[150px]"
                onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        )}
        <p className="text-[11px] text-neutral-400">
          Período: {new Date(start + "T00:00").toLocaleDateString("pt-BR")} — {new Date(end + "T00:00").toLocaleDateString("pt-BR")}
        </p>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={<Megaphone className="h-4 w-4" />} label="Campanhas"
              value={String(stats?.campanhas ?? 0)} sub="com disparos no período" accent="text-blue-600" />
            <Metric icon={<Send className="h-4 w-4" />} label="Pessoas atingidas"
              value={String(stats?.enviados ?? 0)} sub={`${stats?.entregues ?? 0} entregues · ${stats?.lidos ?? 0} lidas`} />
            <Metric icon={<DollarSign className="h-4 w-4" />} label="Custo do disparo"
              value={brl(stats?.custo ?? 0)} sub={`${stats?.enviados ?? 0} msg × ${brl(stats?.custo_por_msg ?? 0.4)}`} accent="text-rose-600" />
            <Metric icon={<Percent className="h-4 w-4" />} label="Taxa de conversão"
              value={`${stats?.taxa_conversao ?? 0}%`} sub={`${stats?.conversoes ?? 0} conversões`} accent="text-indigo-600" />
            <Metric icon={<DollarSign className="h-4 w-4" />} label="Valor de conversão"
              value={brl(stats?.valor_conversao ?? 0)} accent="text-emerald-600" />
            <Metric icon={<TrendingUp className="h-4 w-4" />} label="ROAS"
              value={`${stats?.roas ?? 0}x`} sub={`Retorno sobre o custo`} accent="text-emerald-600" />
            <Metric icon={<Users className="h-4 w-4" />} label="Clientes que converteram"
              value={String(stats?.conversoes ?? 0)} sub={`Ticket médio ${brl(stats?.ticket_medio ?? 0)}`} />
            <Metric icon={<Package className="h-4 w-4" />} label="Itens vendidos"
              value={String(stats?.itens_vendidos ?? 0)} />
          </div>

          {/* Entregabilidade */}
          <Card className="p-3">
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded bg-sky-50 px-2 py-0.5 text-sky-700">Enviadas: {stats?.enviados ?? 0}</span>
              <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">Entregues: {stats?.entregues ?? 0}</span>
              <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">Lidas: {stats?.lidos ?? 0}</span>
              <span className="rounded bg-orange-50 px-2 py-0.5 text-orange-700">Não entregáveis: {stats?.nao_entregavel ?? 0}</span>
              <span className="rounded bg-rose-50 px-2 py-0.5 text-rose-700">Falhas: {stats?.falhou ?? 0}</span>
              <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">Na fila: {stats?.pendente ?? 0}</span>
            </div>
          </Card>

          {/* Lista de conversões */}
          <Card className="overflow-hidden">
            <button
              className="flex w-full items-center justify-between p-4 text-left"
              onClick={() => setShowList((s) => !s)}
            >
              <div>
                <h4 className="text-sm font-bold text-neutral-800">
                  Clientes que converteram
                  <Badge className="ml-2 bg-emerald-100 text-emerald-700">{sales.length} pedidos</Badge>
                </h4>
                <p className="text-[11px] text-neutral-400">
                  {uniqueBuyers} clientes · {brl(stats?.valor_conversao ?? 0)} em vendas
                </p>
              </div>
              {showList ? <ChevronUp className="h-4 w-4 text-neutral-400" /> : <ChevronDown className="h-4 w-4 text-neutral-400" />}
            </button>

            {showList && (
              <div className="border-t border-neutral-100">
                {loadingSales ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-blue-500" /></div>
                ) : sales.length === 0 ? (
                  <p className="py-8 text-center text-sm text-neutral-400">Nenhuma conversão no período.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Campanha</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Canal</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sales.map((v) => (
                        <Fragment key={v.id}>
                          <TableRow className="cursor-pointer" onClick={() => toggleRow(v.id)}>
                            <TableCell>
                              {expanded.has(v.id)
                                ? <ChevronUp className="h-4 w-4 text-neutral-400" />
                                : <ChevronDown className="h-4 w-4 text-neutral-400" />}
                            </TableCell>
                            <TableCell>
                              <p className="font-medium text-neutral-800">{v.customer_name || "Cliente"}</p>
                              <p className="text-[11px] text-neutral-400">{v.customer_phone || "—"}</p>
                            </TableCell>
                            <TableCell className="text-xs text-neutral-600">{v.campanha || "—"}</TableCell>
                            <TableCell className="text-xs text-neutral-600">
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="h-3 w-3 text-neutral-400" />{fmtDate(v.date)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">{saleTypeLabel(v.sale_type)}</Badge>
                              {v.store && <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-neutral-500"><Store className="h-3 w-3" />{v.store}</span>}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-emerald-600">{brl(v.total)}</TableCell>
                          </TableRow>
                          {expanded.has(v.id) && (
                            <TableRow key={v.id + "-d"} className="bg-neutral-50/60">
                              <TableCell></TableCell>
                              <TableCell colSpan={5}>
                                <div className="space-y-1 py-1">
                                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-neutral-500">
                                    {v.payment_method && <span>Pagamento: <b className="text-neutral-700">{v.payment_method}</b></span>}
                                    {v.seller && <span>Vendedora: <b className="text-neutral-700">{v.seller}</b></span>}
                                    {v.discount > 0 && <span>Desconto: <b className="text-neutral-700">{brl(v.discount)}</b></span>}
                                  </div>
                                  <div className="mt-1 space-y-0.5">
                                    {v.items.length === 0 ? (
                                      <p className="text-[11px] text-neutral-400">Sem itens registrados.</p>
                                    ) : v.items.map((it, i) => (
                                      <div key={i} className="flex items-center justify-between text-[12px] text-neutral-700">
                                        <span>
                                          {it.qty}× {it.name || "Produto"}
                                          {it.variant ? ` · ${it.variant}` : ""}
                                          {it.size ? ` · Tam ${it.size}` : ""}
                                        </span>
                                        <span className="text-neutral-500">{brl(it.price)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
