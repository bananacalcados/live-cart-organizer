import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Loader2, ChevronDown, ChevronUp, CheckCircle2, XCircle,
  Clock, TrendingUp, DollarSign, Package, Percent, ShoppingBag, RefreshCw,
  Calendar, User, CreditCard, Store, History,
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Stats {
  total: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falhou: number;
  nao_entregavel: number;
  pendente: number;
  capped: number;
  rate_limit: number;
  aguardando_retry: number;
  enfileirados: number;
  pct_concluida: number;
  conversoes: number;
  valor_conversao: number;
  itens_vendidos: number;
  custo_por_msg: number;
  custo: number;
  roas: number;
  taxa_conversao: number;
  ticket_medio: number;
}

interface EnvioRow {
  envio_id: string;
  phone: string | null;
  nome: string | null;
  status: string;
  erro: string | null;
  enviado_em: string | null;
  converteu: boolean;
  valor: number;
  comprou_em: string | null;
}

interface BuyerSaleItem {
  name: string | null;
  variant: string | null;
  size: string | null;
  qty: number;
  price: number;
}

interface BuyerSale {
  id: string;
  date: string;
  total: number;
  subtotal: number;
  discount: number;
  payment_method: string | null;
  payment_gateway: string | null;
  sale_type: string | null;
  seller: string | null;
  store: string | null;
  items: BuyerSaleItem[];
}

interface BuyerDetail {
  total_previous: number;
  total_lifetime: number;
  sales: BuyerSale[];
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "—";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  enviado: { label: "Enviado", cls: "bg-sky-100 text-sky-700" },
  entregue: { label: "Entregue", cls: "bg-emerald-100 text-emerald-700" },
  lido: { label: "Lido", cls: "bg-emerald-100 text-emerald-700" },
  falhou: { label: "Falhou", cls: "bg-rose-100 text-rose-700" },
  nao_entregavel: { label: "Não entregável", cls: "bg-orange-100 text-orange-700" },
  pendente: { label: "Pendente", cls: "bg-amber-100 text-amber-700" },
  capped: { label: "Limite", cls: "bg-neutral-200 text-neutral-600" },
};

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

export function CampaignDashboard({
  campanhaId, nome, onClose,
}: {
  campanhaId: string; nome: string; onClose: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showList, setShowList] = useState(false);
  const [rows, setRows] = useState<EnvioRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  const [selectedBuyer, setSelectedBuyer] = useState<EnvioRow | null>(null);
  const [buyerDetail, setBuyerDetail] = useState<BuyerDetail | null>(null);
  const [loadingBuyer, setLoadingBuyer] = useState(false);

  const openBuyer = async (row: EnvioRow) => {
    setSelectedBuyer(row);
    setBuyerDetail(null);
    setLoadingBuyer(true);
    const { data, error } = await supabase.rpc("campaign_buyer_detail", { p_envio_id: row.envio_id });
    if (error) toast.error("Erro ao carregar detalhes da compra");
    setBuyerDetail((data as unknown as BuyerDetail) || null);
    setLoadingBuyer(false);
  };

  const loadStats = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("campaign_dashboard_stats", { p_campanha_id: campanhaId });
    if (error) toast.error("Erro ao carregar painel");
    setStats((data as unknown as Stats) || null);
    setLoading(false);
  };

  const loadRows = async () => {
    setLoadingRows(true);
    const { data, error } = await supabase.rpc("campaign_envios_detail", { p_campanha_id: campanhaId });
    if (error) toast.error("Erro ao carregar destinatários");
    setRows((data as EnvioRow[]) || []);
    setLoadingRows(false);
  };

  useEffect(() => { loadStats(); }, [campanhaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleList = () => {
    const next = !showList;
    setShowList(next);
    if (next && rows.length === 0) loadRows();
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="gap-2 text-neutral-700" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" /> Voltar às automações
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => { loadStats(); if (showList) loadRows(); }}>
          <RefreshCw className="h-4 w-4" /> Atualizar
        </Button>
      </div>

      <div>
        <h3 className="text-base font-bold text-neutral-800">{nome}</h3>
        <p className="text-xs text-neutral-500">Resultado da campanha (conversões em até 7 dias úteis após o disparo).</p>
      </div>

      {/* Progresso */}
      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-neutral-700">Conclusão da campanha</span>
          <span className="text-sm font-bold text-blue-600">{stats?.pct_concluida ?? 0}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${stats?.pct_concluida ?? 0}%` }} />
        </div>
        <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
          <span className="rounded bg-sky-50 px-2 py-0.5 text-sky-700">Enviados: {stats?.enviados ?? 0}</span>
          <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">Entregues: {stats?.entregues ?? 0}</span>
          <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">Lidos: {stats?.lidos ?? 0}</span>
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-600">Na fila: {stats?.enfileirados ?? 0}</span>
          <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">Aguardando reenvio: {stats?.aguardando_retry ?? 0}</span>
          <span className="rounded bg-violet-50 px-2 py-0.5 text-violet-700">Limite Meta (aguardando): {stats?.rate_limit ?? 0}</span>
          <span className="rounded bg-orange-50 px-2 py-0.5 text-orange-700">Não entregáveis: {stats?.nao_entregavel ?? 0}</span>
          <span className="rounded bg-rose-50 px-2 py-0.5 text-rose-700">Falhas: {stats?.falhou ?? 0}</span>
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-600">Total: {stats?.total ?? 0}</span>
        </div>
        <p className="text-[10px] text-neutral-400 pt-0.5">
          "Não entregáveis" = a Meta recusou o número (sem WhatsApp ativo, inválido ou que não aceita a mensagem). Não são reenviados.
        </p>
      </Card>

      {/* Resultado financeiro */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={<Percent className="h-4 w-4" />} label="Taxa de conversão"
          value={`${stats?.taxa_conversao ?? 0}%`} sub={`${stats?.conversoes ?? 0} conversões`} accent="text-blue-600" />
        <Metric icon={<DollarSign className="h-4 w-4" />} label="Valor de conversão"
          value={brl(stats?.valor_conversao ?? 0)} accent="text-emerald-600" />
        <Metric icon={<TrendingUp className="h-4 w-4" />} label="ROAS"
          value={`${stats?.roas ?? 0}x`} sub={`Custo ${brl(stats?.custo ?? 0)}`} accent="text-indigo-600" />
        <Metric icon={<ShoppingBag className="h-4 w-4" />} label="Nº de conversões"
          value={String(stats?.conversoes ?? 0)} />
        <Metric icon={<DollarSign className="h-4 w-4" />} label="Custo do disparo"
          value={brl(stats?.custo ?? 0)} sub={`${stats?.enviados ?? 0} msg × ${brl(stats?.custo_por_msg ?? 0.4)}`} accent="text-rose-600" />
        <Metric icon={<Package className="h-4 w-4" />} label="Itens vendidos"
          value={String(stats?.itens_vendidos ?? 0)} />
        <Metric icon={<DollarSign className="h-4 w-4" />} label="Ticket médio"
          value={brl(stats?.ticket_medio ?? 0)} />
        <Metric icon={<TrendingUp className="h-4 w-4" />} label="Lucro líquido"
          value={brl((stats?.valor_conversao ?? 0) - (stats?.custo ?? 0))}
          accent={(stats?.valor_conversao ?? 0) - (stats?.custo ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"} />
      </div>

      {/* Lista de destinatários */}
      <Card className="overflow-hidden">
        <button
          onClick={toggleList}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-neutral-50"
        >
          <span className="text-sm font-semibold text-neutral-700">
            Ver todos os números que receberam ({stats?.total ?? 0})
          </span>
          {showList ? <ChevronUp className="h-4 w-4 text-neutral-400" /> : <ChevronDown className="h-4 w-4 text-neutral-400" />}
        </button>

        {showList && (
          <div className="border-t">
            {loadingRows ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-blue-500" /></div>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-400">Nenhum envio registrado ainda.</p>
            ) : (
              <div className="max-h-[480px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Comprou?</TableHead>
                      <TableHead>Data da compra</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const sm = STATUS_META[r.status] || { label: r.status, cls: "bg-neutral-100 text-neutral-600" };
                      return (
                        <TableRow
                          key={r.envio_id}
                          onClick={r.converteu ? () => openBuyer(r) : undefined}
                          className={r.converteu ? "cursor-pointer hover:bg-emerald-50/60" : undefined}
                        >
                          <TableCell className="font-medium text-neutral-700">
                            {r.converteu
                              ? <span className="text-emerald-700 underline decoration-dotted underline-offset-2">{r.nome || "—"}</span>
                              : (r.nome || "—")}
                          </TableCell>
                          <TableCell className="text-neutral-600">{r.phone || "—"}</TableCell>
                          <TableCell>
                            <Badge className={`${sm.cls} text-[10px]`}>
                              {r.status === "falhou" && <XCircle className="mr-1 h-3 w-3" />}
                              {(r.status === "entregue" || r.status === "lido") && <CheckCircle2 className="mr-1 h-3 w-3" />}
                              {r.status === "pendente" && <Clock className="mr-1 h-3 w-3" />}
                              {sm.label}
                            </Badge>
                            {r.status === "falhou" && r.erro && (
                              <span className="ml-1 block max-w-[220px] truncate text-[10px] text-rose-400" title={r.erro}>{r.erro}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {r.converteu
                              ? <span className="flex items-center gap-1 text-emerald-600 text-xs font-semibold"><CheckCircle2 className="h-3.5 w-3.5" /> Sim</span>
                              : <span className="text-neutral-400 text-xs">Não</span>}
                          </TableCell>
                          <TableCell className="text-neutral-600 text-xs whitespace-nowrap">
                            {r.converteu ? fmtDate(r.comprou_em) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-medium text-neutral-700">
                            {r.converteu ? brl(r.valor) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Modal de detalhes da compra */}
      <Dialog open={!!selectedBuyer} onOpenChange={(o) => { if (!o) { setSelectedBuyer(null); setBuyerDetail(null); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {selectedBuyer?.nome || "Cliente"}
            </DialogTitle>
            <p className="text-xs text-neutral-500">{selectedBuyer?.phone || "—"}</p>
          </DialogHeader>

          {loadingBuyer ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-blue-500" /></div>
          ) : !buyerDetail ? (
            <p className="py-8 text-center text-sm text-neutral-400">Não foi possível carregar os detalhes.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-neutral-50 p-2.5 text-xs text-neutral-600">
                <History className="h-4 w-4 text-neutral-400" />
                <span>
                  <b className="text-neutral-800">{buyerDetail.total_previous}</b> compra(s) anterior(es) ·{" "}
                  <b className="text-neutral-800">{buyerDetail.total_lifetime}</b> no total
                </span>
              </div>

              {buyerDetail.sales.length === 0 ? (
                <p className="py-6 text-center text-sm text-neutral-400">Nenhum pedido encontrado na janela de conversão.</p>
              ) : (
                buyerDetail.sales.map((s) => (
                  <Card key={s.id} className="p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                        <Calendar className="h-3.5 w-3.5" /> {fmtDate(s.date)}
                      </span>
                      <span className="text-sm font-bold text-emerald-600">{brl(s.total)}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <span className="flex items-center gap-1.5 text-neutral-600">
                        <User className="h-3.5 w-3.5 text-neutral-400" /> {s.seller || "—"}
                      </span>
                      <span className="flex items-center gap-1.5 text-neutral-600">
                        <Store className="h-3.5 w-3.5 text-neutral-400" /> {s.store || "—"}
                      </span>
                      <span className="flex items-center gap-1.5 text-neutral-600 col-span-2">
                        <CreditCard className="h-3.5 w-3.5 text-neutral-400" />
                        {s.payment_method || "—"}
                        {s.payment_gateway && <span className="text-neutral-400">({s.payment_gateway})</span>}
                      </span>
                    </div>

                    {s.discount > 0 && (
                      <p className="text-[11px] text-neutral-400">
                        Subtotal {brl(s.subtotal)} · Desconto {brl(s.discount)}
                      </p>
                    )}

                    <div className="border-t pt-2 space-y-1.5">
                      {s.items.map((it, i) => (
                        <div key={i} className="flex items-start justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <p className="text-neutral-700 truncate">{it.name || "Produto"}</p>
                            {(it.variant || it.size) && (
                              <p className="text-[11px] text-neutral-400">
                                {[it.variant, it.size].filter(Boolean).join(" · ")}
                              </p>
                            )}
                          </div>
                          <span className="whitespace-nowrap text-neutral-600">
                            {it.qty}× {brl(it.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
