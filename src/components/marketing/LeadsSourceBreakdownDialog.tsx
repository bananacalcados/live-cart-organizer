import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  key: string;
  leads: number;
  new_leads: number;
  converted: number;
  converted_new: number;
  conversion_rate: number;
  valor_convertido: number;
  receita_total_com_recompras: number;
  ticket_medio_conversao: number;
};

type Dim = "link" | "campaign" | "adset" | "ad" | "tag";

const DIMS: { value: Dim; label: string }[] = [
  { value: "link", label: "Link" },
  { value: "campaign", label: "Campanha" },
  { value: "adset", label: "Conjunto" },
  { value: "ad", label: "Anúncio" },
  { value: "tag", label: "Etiqueta" },
];

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function LeadsSourceBreakdownDialog({
  channel,
  baseParams,
  onClose,
}: {
  channel: string | null;
  baseParams: Record<string, unknown>;
  onClose: () => void;
}) {
  const [dim, setDim] = useState<Dim>("link");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<"valor" | "leads">("valor");

  useEffect(() => {
    if (!channel) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("marketing-leads-dashboard", {
          body: { ...baseParams, breakdown_channel: channel, breakdown_dim: dim },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        if (!cancelled) setRows(((data as any)?.rows || []) as Row[]);
      } catch (e: any) {
        if (!cancelled) setRows([]);
        toast.error("Erro ao carregar detalhamento: " + (e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [channel, dim, baseParams]);

  const sorted = [...rows].sort((a, b) =>
    sortBy === "valor" ? b.valor_convertido - a.valor_convertido : b.leads - a.leads);

  return (
    <Dialog open={!!channel} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Origem detalhada — {channel}</DialogTitle>
          <DialogDescription>
            Qual link / campanha / conjunto / anúncio trouxe mais leads e, principalmente, mais conversão.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {DIMS.map(d => (
            <Button
              key={d.value}
              size="sm"
              variant={dim === d.value ? "default" : "outline"}
              onClick={() => setDim(d.value)}
            >
              {d.label}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Ordenar por</span>
            <Button size="sm" variant={sortBy === "valor" ? "secondary" : "ghost"} onClick={() => setSortBy("valor")}>Receita</Button>
            <Button size="sm" variant={sortBy === "leads" ? "secondary" : "ghost"} onClick={() => setSortBy("leads")}>Leads</Button>
          </div>
        </div>

        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados nessa dimensão para o período. Conjunto e anúncio só existem para leads captados após a
            ativação da captura (use as macros da Meta no link: utm_content e utm_term).
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1.5 pr-2">{DIMS.find(d => d.value === dim)?.label}</th>
                  <th className="py-1.5 px-2 text-right">Leads</th>
                  <th className="py-1.5 px-2 text-right">Novos</th>
                  <th className="py-1.5 px-2 text-right">Convertidos</th>
                  <th className="py-1.5 px-2 text-right">Taxa</th>
                  <th className="py-1.5 px-2 text-right">Ticket</th>
                  <th className="py-1.5 pl-2 text-right">Receita</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="py-1.5 pr-2 font-medium break-all">{r.key}</td>
                    <td className="py-1.5 px-2 text-right">{r.leads}</td>
                    <td className="py-1.5 px-2 text-right">{r.new_leads}</td>
                    <td className="py-1.5 px-2 text-right">{r.converted}</td>
                    <td className="py-1.5 px-2 text-right">
                      <Badge variant="outline" className="text-[10px]">{r.conversion_rate}%</Badge>
                    </td>
                    <td className="py-1.5 px-2 text-right">{fmtBRL(r.ticket_medio_conversao)}</td>
                    <td className="py-1.5 pl-2 text-right font-semibold">{fmtBRL(r.valor_convertido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
