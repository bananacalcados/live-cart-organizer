import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Users, TrendingUp, RefreshCw, UserPlus } from "lucide-react";

type Cohort = "reativado_pre_lead" | "novo_1_compra" | "novo_recorrente" | "nao_convertido";

interface CohortRow {
  cohort: Cohort;
  leads: number;
  revenue: number;
  avg_ltv: number;
  avg_orders: number;
  avg_days_to_purchase: number;
}
interface SourceBlock {
  source: string;
  total_leads: number;
  cohorts: CohortRow[];
}
interface LeadDetail {
  lead_id: string;
  name: string;
  phone: string;
  source: string;
  cohort: Cohort;
  captured_at: string;
  first_purchase_at: string | null;
  last_purchase_at: string | null;
  total_orders: number | null;
  total_spent: number | null;
  days_to_first_purchase: number | null;
}

const COHORT_META: Record<Cohort, { label: string; color: string; desc: string; Icon: any }> = {
  reativado_pre_lead: {
    label: "Reativados",
    color: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    desc: "Já eram clientes antes de virar lead",
    Icon: RefreshCw,
  },
  novo_recorrente: {
    label: "Novos recorrentes",
    color: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
    desc: "1ª compra após virar lead • 2+ pedidos",
    Icon: TrendingUp,
  },
  novo_1_compra: {
    label: "Novos (1 compra)",
    color: "bg-sky-500/10 text-sky-700 border-sky-500/30",
    desc: "1ª compra após virar lead • ainda não recomprou",
    Icon: UserPlus,
  },
  nao_convertido: {
    label: "Não convertidos",
    color: "bg-muted text-muted-foreground border-border",
    desc: "Sem compra rastreada na base",
    Icon: Users,
  },
};

const brl = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function LeadCohortPanel({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(true);
  const [totalLeads, setTotalLeads] = useState(0);
  const [sources, setSources] = useState<SourceBlock[]>([]);
  const [details, setDetails] = useState<LeadDetail[]>([]);
  const [activeSource, setActiveSource] = useState<string>("__all__");
  const [activeCohort, setActiveCohort] = useState<Cohort | "__all__">("__all__");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("event_lead_cohorts" as any, { p_event_id: eventId });
    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }
    const d: any = data || {};
    setTotalLeads(d.total_leads || 0);
    setSources(d.sources || []);
    setDetails(d.leads_detail || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [eventId]);

  const aggregated = useMemo(() => {
    const src = activeSource === "__all__" ? sources : sources.filter((s) => s.source === activeSource);
    const acc: Record<Cohort, CohortRow> = {} as any;
    for (const s of src) {
      for (const c of s.cohorts || []) {
        const cur = acc[c.cohort];
        if (!cur) {
          acc[c.cohort] = { ...c };
        } else {
          const totalLeads = cur.leads + c.leads;
          acc[c.cohort] = {
            cohort: c.cohort,
            leads: totalLeads,
            revenue: Number(cur.revenue) + Number(c.revenue),
            avg_ltv: totalLeads ? (cur.avg_ltv * cur.leads + c.avg_ltv * c.leads) / totalLeads : 0,
            avg_orders: totalLeads ? (cur.avg_orders * cur.leads + c.avg_orders * c.leads) / totalLeads : 0,
            avg_days_to_purchase: totalLeads
              ? (cur.avg_days_to_purchase * cur.leads + c.avg_days_to_purchase * c.leads) / totalLeads
              : 0,
          };
        }
      }
    }
    return acc;
  }, [sources, activeSource]);

  const totalFiltered = Object.values(aggregated).reduce((a, r) => a + r.leads, 0);
  const totalRevenue = Object.values(aggregated).reduce((a, r) => a + Number(r.revenue), 0);

  const filteredDetails = useMemo(() => {
    return details.filter((d) => {
      if (activeSource !== "__all__" && d.source !== activeSource) return false;
      if (activeCohort !== "__all__" && d.cohort !== activeCohort) return false;
      return true;
    }).slice(0, 500);
  }, [details, activeSource, activeCohort]);

  const sourceOptions = useMemo(
    () => ["__all__", ...sources.map((s) => s.source)],
    [sources]
  );

  const exportCsv = () => {
    const header = "Nome,WhatsApp,Origem,Coorte,Capturado em,1ª compra,Última compra,Pedidos,LTV,Dias até 1ª compra\n";
    const rows = filteredDetails.map((d) =>
      [
        d.name, d.phone, d.source, d.cohort,
        new Date(d.captured_at).toLocaleString("pt-BR"),
        d.first_purchase_at ? new Date(d.first_purchase_at).toLocaleDateString("pt-BR") : "",
        d.last_purchase_at ? new Date(d.last_purchase_at).toLocaleDateString("pt-BR") : "",
        d.total_orders ?? 0,
        d.total_spent ?? 0,
        d.days_to_first_purchase ?? "",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `leads-coortes-${eventId}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="p-8 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cruzando leads com base de clientes...</div>;
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="font-bold text-base">Coortes de Leads deste evento</h3>
            <p className="text-xs text-muted-foreground">
              Cruzamento por WhatsApp (8 dígitos) com a base unificada. Mostra quem já era cliente, quem virou cliente novo e quem virou recorrente.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3 w-3 mr-1" /> Atualizar</Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>Exportar CSV</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mb-3">
          {sourceOptions.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSource(s)}
              className={`text-xs px-2 py-1 rounded border ${activeSource === s ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
            >
              {s === "__all__" ? `Todas origens (${totalLeads})` : `${s} (${sources.find(x => x.source === s)?.total_leads || 0})`}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {(Object.keys(COHORT_META) as Cohort[]).map((c) => {
            const row = aggregated[c] || { leads: 0, revenue: 0, avg_ltv: 0, avg_orders: 0, avg_days_to_purchase: 0, cohort: c };
            const meta = COHORT_META[c];
            const pct = totalFiltered ? Math.round((row.leads / totalFiltered) * 100) : 0;
            const Icon = meta.Icon;
            const active = activeCohort === c;
            return (
              <button
                key={c}
                onClick={() => setActiveCohort(active ? "__all__" : c)}
                className={`text-left p-3 rounded-lg border transition ${meta.color} ${active ? "ring-2 ring-primary" : ""}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide">{meta.label}</span>
                </div>
                <div className="text-xl font-bold leading-tight">{row.leads} <span className="text-xs font-normal opacity-70">({pct}%)</span></div>
                <div className="text-[11px] opacity-80 mt-1">{meta.desc}</div>
                <div className="mt-2 space-y-0.5 text-[11px]">
                  <div>Receita: <b>{brl(Number(row.revenue))}</b></div>
                  <div>LTV médio: <b>{brl(Number(row.avg_ltv))}</b></div>
                  <div>Pedidos médios: <b>{Number(row.avg_orders).toFixed(2)}</b></div>
                  {c !== "reativado_pre_lead" && c !== "nao_convertido" && (
                    <div>Dias até 1ª compra: <b>{Number(row.avg_days_to_purchase).toFixed(1)}</b></div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground border-t pt-2">
          <span>Leads no filtro: <b className="text-foreground">{totalFiltered}</b></span>
          <span>Receita total atribuída: <b className="text-foreground">{brl(totalRevenue)}</b></span>
          <span>Conversão (novos reais): <b className="text-foreground">{totalFiltered ? Math.round((((aggregated.novo_1_compra?.leads || 0) + (aggregated.novo_recorrente?.leads || 0)) / totalFiltered) * 100) : 0}%</b></span>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold text-sm">
            Leads {activeCohort !== "__all__" ? `— ${COHORT_META[activeCohort as Cohort].label}` : ""} ({filteredDetails.length})
          </h4>
          {activeCohort !== "__all__" && (
            <Button size="sm" variant="ghost" onClick={() => setActiveCohort("__all__")}>Limpar filtro</Button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2">Nome</th>
                <th>WhatsApp</th>
                <th>Origem</th>
                <th>Coorte</th>
                <th className="text-right">Pedidos</th>
                <th className="text-right">LTV</th>
                <th className="text-right">Dias p/ 1ª</th>
                <th>Capturado</th>
              </tr>
            </thead>
            <tbody>
              {filteredDetails.map((d) => {
                const meta = COHORT_META[d.cohort];
                return (
                  <tr key={d.lead_id} className="border-b hover:bg-muted/30">
                    <td className="py-1.5">{d.name}</td>
                    <td className="font-mono">{d.phone}</td>
                    <td>{d.source}</td>
                    <td><span className={`px-1.5 py-0.5 rounded border text-[10px] ${meta.color}`}>{meta.label}</span></td>
                    <td className="text-right">{d.total_orders ?? 0}</td>
                    <td className="text-right">{brl(Number(d.total_spent || 0))}</td>
                    <td className="text-right">{d.days_to_first_purchase ?? "—"}</td>
                    <td className="text-muted-foreground">{new Date(d.captured_at).toLocaleDateString("pt-BR")}</td>
                  </tr>
                );
              })}
              {filteredDetails.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum lead nessa coorte</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
