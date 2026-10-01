import { useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, subMonths, differenceInDays, addDays } from "date-fns";
import { Loader2, Download, Settings, AlertTriangle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const BRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Row = Record<string, number | null>;
type DreResult = { channels: Record<string, Row> };

const COLS: { key: string; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "online", label: "Online" },
  { key: "loja_centro", label: "Loja Centro" },
  { key: "loja_perola", label: "Loja Pérola" },
  { key: "outros", label: "Outros" },
  { key: "total", label: "Total" },
];

const LINES: { key: string; label: string; sign?: "-" | "="; strong?: boolean; pct?: boolean; info?: string }[] = [
  { key: "receita_bruta", label: "Receita bruta", strong: true },
  { key: "devolucoes", label: "(-) Devoluções / trocas / chargebacks", sign: "-" },
  { key: "descontos_cashback", label: "(-) Descontos e cashback", sign: "-" },
  { key: "receita_liquida", label: "= Receita líquida", sign: "=", strong: true },
  { key: "impostos", label: "(-) Impostos", sign: "-" },
  { key: "cmv", label: "(-) CMV (custo do produto)", sign: "-", info: "cmv" },
  { key: "margem_bruta", label: "= Margem bruta", sign: "=", strong: true },
  { key: "taxas_pagamento", label: "(-) Taxas de pagamento", sign: "-", info: "taxa" },
  { key: "frete_pago", label: "(-) Frete pago", sign: "-" },
  { key: "frete_cobrado", label: "Frete cobrado (já na receita)" },
  { key: "embalagem", label: "(-) Embalagem", sign: "-" },
  { key: "comissoes", label: "(-) Comissões", sign: "-" },
  { key: "marketing_ads", label: "(-) Marketing — anúncios Meta", sign: "-" },
  { key: "marketing_disparos", label: "(-) Marketing — disparos", sign: "-" },
  { key: "margem_contribuicao", label: "= Margem de contribuição", sign: "=", strong: true },
  { key: "custos_fixos", label: "(-) Custos fixos", sign: "-" },
  { key: "resultado_operacional", label: "= Resultado operacional", sign: "=", strong: true },
  { key: "ponto_equilibrio", label: "Ponto de equilíbrio (receita líquida)" },
];

interface Params {
  tax_regime: string; simples_rate_pct: number; commission_pct_store: number; commission_pct_online: number;
  commission_pct_live: number; packaging_cost_per_shipped_order: number; fixed_cost_allocation: string;
}

export function POSDreTab() {
  const now = new Date();
  const [from, setFrom] = useState(format(startOfMonth(now), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(now), "yyyy-MM-dd"));
  const [storeId, setStoreId] = useState<string>("all");
  const [channel, setChannel] = useState<string>("all");
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<DreResult | null>(null);
  const [prev, setPrev] = useState<DreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);

  const prevRange = useMemo(() => {
    const f = new Date(from + "T00:00:00");
    const t = new Date(to + "T00:00:00");
    const pf = subMonths(f, 1);
    const isFullMonth = format(startOfMonth(f), "yyyy-MM-dd") === from && format(endOfMonth(f), "yyyy-MM-dd") === to;
    const pt = isFullMonth ? endOfMonth(pf) : addDays(pf, differenceInDays(t, f));
    return { from: format(pf, "yyyy-MM-dd"), to: format(pt, "yyyy-MM-dd") };
  }, [from, to]);

  const load = async () => {
    setLoading(true);
    const args = (f: string, t: string) => ({
      p_from: f, p_to: t, p_channel: null, p_store_id: storeId === "all" ? null : storeId,
    });
    const [cur, old] = await Promise.all([
      supabase.rpc("dre_period" as any, args(from, to)),
      supabase.rpc("dre_period" as any, args(prevRange.from, prevRange.to)),
    ]);
    if (cur.error) toast.error("Erro ao calcular DRE: " + cur.error.message);
    setData((cur.data as any) || null);
    setPrev((old.data as any) || null);
    setLoading(false);
  };

  useEffect(() => {
    supabase.from("pos_stores").select("id, name").eq("is_active", true).order("name").then(({ data }) => setStores(data || []));
  }, []);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to, storeId]);

  const visibleCols = COLS.filter((c) => {
    if (channel === "all") return c.key !== "outros" || (data?.channels?.outros?.vendas ?? 0) > 0;
    if (channel === "loja") return c.key.startsWith("loja_") || c.key === "total";
    return c.key === channel || c.key === "total";
  });

  const total = data?.channels?.total || {};
  const prevTotal = prev?.channels?.total || {};
  const rl = Number(total.receita_liquida || 0);
  const pe = total.ponto_equilibrio as number | null;
  const peText = pe == null ? "—" : rl >= pe ? "Atingido" : `Falta ${BRL(pe - rl)}`;

  const exportCsv = () => {
    if (!data) return;
    const header = ["Linha", ...visibleCols.flatMap((c) => [`${c.label} (R$)`, `${c.label} (%RL)`]), "Var. vs mês anterior (Total)"];
    const lines = LINES.map((l) => {
      const cells = visibleCols.flatMap((c) => {
        const r = data.channels[c.key] || {};
        const v = Number(r[l.key] || 0);
        const base = Number(r.receita_liquida || 0);
        return [v.toFixed(2).replace(".", ","), base ? ((v / base) * 100).toFixed(1).replace(".", ",") : ""];
      });
      return [l.label, ...cells, variation(total[l.key], prevTotal[l.key]) ?? ""];
    });
    const csv = [header, ...lines].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dre_${from}_${to}.csv`;
    a.click();
  };

  return (
    <TooltipProvider>
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground block">De</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block">Até</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block">Loja</label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as lojas</SelectItem>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block">Canal</label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="loja">Lojas físicas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setParamsOpen(true)}><Settings className="h-4 w-4 mr-1" />Parâmetros</Button>
            <Button size="sm" onClick={exportCsv} disabled={!data}><Download className="h-4 w-4 mr-1" />Exportar CSV</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Margem bruta" value={pct(total.margem_bruta_pct)} />
          <Kpi label="Margem de contribuição" value={pct(total.margem_contribuicao_pct)} />
          <Kpi label="Resultado operacional" value={BRL(total.resultado_operacional)} negative={Number(total.resultado_operacional) < 0} />
          <Kpi label="Ponto de equilíbrio" value={pe == null ? "—" : BRL(pe)} sub={peText} negative={pe != null && rl < pe} />
        </div>

        {loading && !data ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : data ? (
          <div className="overflow-auto rounded-md border border-border">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left p-2 min-w-[240px]">Linha</th>
                  {visibleCols.map((c) => <th key={c.key} className="text-right p-2 min-w-[120px]">{c.label}</th>)}
                  <th className="text-right p-2 min-w-[90px]">Var. mês ant.</th>
                </tr>
              </thead>
              <tbody>
                {LINES.map((l) => {
                  const showInfo =
                    (l.info === "cmv" && Number(total.cmv_estimado_pct) > 0) ||
                    (l.info === "taxa" && Number(total.vendas_sem_regra_taxa) > 0);
                  const tip = l.info === "cmv"
                    ? `${pct(total.cmv_estimado_pct)} da receita usa custo estimado (custo atual do produto, não o custo da data da venda). Itens sem custo cadastrado contam como zero.`
                    : `${total.vendas_sem_regra_taxa} venda(s) sem taxa cadastrada para a forma de pagamento — contadas com taxa zero. Cadastre em Taxas de Pagamento.`;
                  const varTxt = variation(total[l.key], prevTotal[l.key]);
                  return (
                    <tr key={l.key} className={`border-t border-border ${l.strong ? "bg-muted/20 font-semibold" : ""}`}>
                      <td className="p-2">
                        <span className="inline-flex items-center gap-1">
                          {l.label}
                          {showInfo && (
                            <Tooltip>
                              <TooltipTrigger><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /></TooltipTrigger>
                              <TooltipContent className="max-w-xs">{tip}</TooltipContent>
                            </Tooltip>
                          )}
                        </span>
                      </td>
                      {visibleCols.map((c) => {
                        const r = data.channels[c.key] || {};
                        const v = r[l.key];
                        const base = Number(r.receita_liquida || 0);
                        const isNeg = l.sign === "=" && Number(v) < 0;
                        return (
                          <td key={c.key} className={`p-2 text-right ${isNeg ? "text-destructive" : ""}`}>
                            {v == null ? "—" : BRL(Number(v))}
                            {v != null && base > 0 && l.key !== "ponto_equilibrio" && (
                              <span className="block text-[10px] text-muted-foreground font-normal">{((Number(v) / base) * 100).toFixed(1)}%</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-2 text-right text-muted-foreground">{varTxt ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          Comparação com {format(new Date(prevRange.from + "T00:00:00"), "dd/MM/yyyy")} a {format(new Date(prevRange.to + "T00:00:00"), "dd/MM/yyyy")}. Percentuais sobre a receita líquida.
        </p>
      </div>
      <DreParamsDialog open={paramsOpen} onOpenChange={setParamsOpen} onSaved={load} />
    </TooltipProvider>
  );
}

function pct(v: unknown) {
  return v == null ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
function variation(cur: unknown, old: unknown): string | null {
  const c = Number(cur || 0), o = Number(old || 0);
  if (!o) return null;
  const d = ((c - o) / Math.abs(o)) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
}

function Kpi({ label, value, sub, negative }: { label: string; value: string; sub?: string; negative?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold ${negative ? "text-destructive" : ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function DreParamsDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const [p, setP] = useState<Params | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from("dre_parameters" as any).select("*").eq("id", 1).maybeSingle().then(({ data }) => setP(data as any));
  }, [open]);

  const save = async () => {
    if (!p) return;
    setSaving(true);
    const { error } = await supabase.from("dre_parameters" as any).upsert({ id: 1, ...p } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Parâmetros salvos");
    onOpenChange(false);
    onSaved();
  };

  const num = (k: keyof Params) => (
    <Input type="number" step="0.01" value={(p?.[k] as number) ?? 0}
      onChange={(e) => setP((x) => x && ({ ...x, [k]: parseFloat(e.target.value) || 0 }))} className="h-9" />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Parâmetros da DRE</DialogTitle></DialogHeader>
        {!p ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : (
          <div className="grid gap-3 text-sm">
            <Field label="Regime de impostos">
              <Select value={p.tax_regime} onValueChange={(v) => setP({ ...p, tax_regime: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="aliquotas_item">Alíquotas dos itens (ICMS/PIS/COFINS)</SelectItem>
                  <SelectItem value="simples">Simples Nacional (% sobre a venda)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {p.tax_regime === "simples" && <Field label="Alíquota do Simples (%)">{num("simples_rate_pct")}</Field>}
            <Field label="Comissão — lojas (%)">{num("commission_pct_store")}</Field>
            <Field label="Comissão — online e WhatsApp (%)">{num("commission_pct_online")}</Field>
            <Field label="Comissão — live (%)">{num("commission_pct_live")}</Field>
            <Field label="Embalagem por pedido enviado (R$)">{num("packaging_cost_per_shipped_order")}</Field>
            <Field label="Rateio dos custos fixos">
              <Select value={p.fixed_cost_allocation} onValueChange={(v) => setP({ ...p, fixed_cost_allocation: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="by_revenue">Proporcional à receita</SelectItem>
                  <SelectItem value="by_store">Por loja (demais canais pela receita)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Salvar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[11px] text-muted-foreground block mb-1">{label}</label>{children}</div>;
}
