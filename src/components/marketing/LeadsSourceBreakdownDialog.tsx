import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  key: string;
  label?: string;
  leads: number;
  new_leads: number;
  converted: number;
  converted_new: number;
  conversion_rate: number;
  valor_convertido: number;
  receita_total_com_recompras: number;
  ticket_medio_conversao: number;
  spend?: number | null;
  cost_per_lead?: number | null;
  cost_per_converted?: number | null;
};

type WaCampaign = {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  share_pct: number;
  leads_rateados: number;
  convertidos_rateados: number;
  cost_per_converted: number | null;
};

type Dim = "link" | "campaign" | "adset" | "adset_meta" | "ad" | "tag";

const TYPEBOT = "Evento / Live (Typebot)";
const ADS = "Anúncios (Ads)";

const BASE_DIMS: { value: Dim; label: string }[] = [
  { value: "link", label: "Link" },
  { value: "campaign", label: "Campanha" },
  { value: "adset", label: "Conjunto" },
  { value: "ad", label: "Anúncio" },
  { value: "tag", label: "Etiqueta" },
];

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const optBRL = (v: number | null | undefined) => (v == null ? "—" : fmtBRL(v));

export function LeadsSourceBreakdownDialog({
  channel,
  baseParams,
  onClose,
}: {
  channel: string | null;
  baseParams: Record<string, unknown>;
  onClose: () => void;
}) {
  const isTypebot = channel === TYPEBOT;
  const dims: { value: Dim; label: string }[] = isTypebot
    ? [{ value: "adset_meta", label: "Conjunto (Meta)" }, ...BASE_DIMS]
    : BASE_DIMS;
  const [dim, setDim] = useState<Dim>("link");
  const [rows, setRows] = useState<Row[]>([]);
  const [waCampaigns, setWaCampaigns] = useState<WaCampaign[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<"valor" | "leads" | "convertidos">("valor");

  useEffect(() => {
    if (channel === TYPEBOT) { setDim("adset_meta"); setSortBy("convertidos"); }
    else { setDim("link"); setSortBy("valor"); }
  }, [channel]);

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
        if (!cancelled) {
          setRows(((data as any)?.rows || []) as Row[]);
          setWaCampaigns(((data as any)?.whatsapp_campaigns ?? null) as WaCampaign[] | null);
        }
      } catch (e: any) {
        if (!cancelled) { setRows([]); setWaCampaigns(null); }
        toast.error("Erro ao carregar detalhamento: " + (e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [channel, dim, baseParams]);

  const showCost = dim === "adset_meta";
  const sorted = [...rows].sort((a, b) =>
    sortBy === "valor" ? b.valor_convertido - a.valor_convertido
      : sortBy === "convertidos" ? b.converted - a.converted || b.leads - a.leads
      : b.leads - a.leads);

  return (
    <Dialog open={!!channel} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Origem detalhada — {channel}</DialogTitle>
          <DialogDescription>
            Qual link / campanha / conjunto / anúncio trouxe mais leads e, principalmente, mais conversão.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {dims.map(d => (
            <Button key={d.value} size="sm" variant={dim === d.value ? "default" : "outline"} onClick={() => setDim(d.value)}>
              {d.label}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Ordenar por</span>
            <Button size="sm" variant={sortBy === "convertidos" ? "secondary" : "ghost"} onClick={() => setSortBy("convertidos")}>Convertidos</Button>
            <Button size="sm" variant={sortBy === "valor" ? "secondary" : "ghost"} onClick={() => setSortBy("valor")}>Receita</Button>
            <Button size="sm" variant={sortBy === "leads" ? "secondary" : "ghost"} onClick={() => setSortBy("leads")}>Leads</Button>
          </div>
        </div>

        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="max-h-[60vh] overflow-auto space-y-4">
            {sorted.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sem dados nessa dimensão para o período. Conjunto e anúncio só existem para leads captados após a
                ativação da captura (use as macros da Meta no link: utm_content e utm_term).
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-1.5 pr-2">{dims.find(d => d.value === dim)?.label}</th>
                    <th className="py-1.5 px-2 text-right">Leads</th>
                    <th className="py-1.5 px-2 text-right">Novos</th>
                    <th className="py-1.5 px-2 text-right">Convertidos</th>
                    <th className="py-1.5 px-2 text-right">Taxa</th>
                    <th className="py-1.5 px-2 text-right">Ticket</th>
                    <th className="py-1.5 px-2 text-right">Receita</th>
                    {showCost && <>
                      <th className="py-1.5 px-2 text-right">Gasto</th>
                      <th className="py-1.5 px-2 text-right">Custo/lead</th>
                      <th className="py-1.5 pl-2 text-right">Custo/convertido</th>
                    </>}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => (
                    <tr key={r.key} className="border-b last:border-0">
                      <td className="py-1.5 pr-2 font-medium break-all">
                        {r.label || r.key}
                        {r.label && r.label !== r.key && <div className="text-[10px] text-muted-foreground">{r.key}</div>}
                      </td>
                      <td className="py-1.5 px-2 text-right">{r.leads}</td>
                      <td className="py-1.5 px-2 text-right">{r.new_leads}</td>
                      <td className="py-1.5 px-2 text-right">{r.converted}</td>
                      <td className="py-1.5 px-2 text-right">
                        <Badge variant="outline" className="text-[10px]">{r.conversion_rate}%</Badge>
                      </td>
                      <td className="py-1.5 px-2 text-right">{fmtBRL(r.ticket_medio_conversao)}</td>
                      <td className="py-1.5 px-2 text-right font-semibold">{fmtBRL(r.valor_convertido)}</td>
                      {showCost && <>
                        <td className="py-1.5 px-2 text-right">{optBRL(r.spend)}</td>
                        <td className="py-1.5 px-2 text-right">{optBRL(r.cost_per_lead)}</td>
                        <td className="py-1.5 pl-2 text-right font-semibold">{optBRL(r.cost_per_converted)}</td>
                      </>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {channel === ADS && waCampaigns && (
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium mb-1">
                  Campanhas WhatsApp — gasto e custo por convertido
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        A mensagem do anúncio não traz o ID da campanha. Por isso, os contatos e convertidos desta
                        linha são rateados entre as campanhas proporcionalmente ao gasto de cada uma no período.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                {waCampaigns.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem gasto sincronizado de campanhas WhatsApp no período.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="py-1.5 pr-2">Campanha</th>
                        <th className="py-1.5 px-2 text-right">Gasto</th>
                        <th className="py-1.5 px-2 text-right">% do gasto</th>
                        <th className="py-1.5 px-2 text-right">Contatos (rateio)</th>
                        <th className="py-1.5 px-2 text-right">Convertidos (rateio)</th>
                        <th className="py-1.5 pl-2 text-right">Custo/convertido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {waCampaigns.map(c => (
                        <tr key={c.campaign_id} className="border-b last:border-0">
                          <td className="py-1.5 pr-2 font-medium break-all">{c.campaign_name}</td>
                          <td className="py-1.5 px-2 text-right">{fmtBRL(c.spend)}</td>
                          <td className="py-1.5 px-2 text-right">{c.share_pct}%</td>
                          <td className="py-1.5 px-2 text-right">{c.leads_rateados.toLocaleString("pt-BR")}</td>
                          <td className="py-1.5 px-2 text-right">{c.convertidos_rateados.toLocaleString("pt-BR")}</td>
                          <td className="py-1.5 pl-2 text-right font-semibold">{optBRL(c.cost_per_converted)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
