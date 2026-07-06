import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import QRCode from "react-qr-code";
import {
  Link as LinkIcon, Copy, RefreshCw, Loader2, MousePointerClick,
  LogIn, UserPlus, Crown, QrCode, Download, Info, TrendingUp, Printer,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface FunnelRow {
  link_id: string;
  slug: string;
  label: string | null;
  campaign_id: string;
  campaign_name: string;
  group_names: string[];
  clicks: number;
  campaign_clicks: number;
  redirect_count: number;
  group_entries: number;       // REAL (webhook)
  estimated_entries: number;   // ESTIMATIVA
  leads_created: number;       // REAL
  customers_tagged: number;    // REAL
}

const linkUrl = (slug: string) => `${window.location.origin}/vip/${slug}`;

export function VipLinksManager() {
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("90");
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [qrFor, setQrFor] = useState<FunnelRow | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("vip_link_funnel", { p_days: Number(days) });
      if (error) throw error;
      setRows((data as FunnelRow[]) || []);
    } catch (e: any) {
      toast.error("Erro ao carregar links: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const totals = useMemo(() => rows.reduce((a, r) => ({
    clicks: a.clicks + r.clicks,
    entries: a.entries + r.group_entries,
    leads: a.leads + r.leads_created,
    customers: a.customers + r.customers_tagged,
  }), { clicks: 0, entries: 0, leads: 0, customers: 0 }), [rows]);

  const copy = (slug: string) => {
    navigator.clipboard.writeText(linkUrl(slug));
    toast.success("Link copiado!");
  };

  const downloadQr = (slug: string) => {
    const svg = document.getElementById(`qr-${slug}`);
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 512; canvas.height = 512;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 32, 32, 448, 448);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `qr-${slug}.png`;
      a.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <LinkIcon className="h-4 w-4 text-primary" /> Links de entrada + Funil
            </h3>
            <p className="text-xs text-muted-foreground">
              Cliques e entradas são medidos de fontes diferentes (link vs. webhook do grupo).
              Crie e edite links dentro de cada campanha.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
                <SelectItem value="365">Último ano</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading} className="gap-1">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
          </div>
        </div>

        {/* Totais */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={MousePointerClick} color="text-blue-500" label="Cliques (real)" value={totals.clicks} />
          <StatCard icon={LogIn} color="text-emerald-500" label="Entradas no grupo (real)" value={totals.entries} />
          <StatCard icon={UserPlus} color="text-fuchsia-500" label="Leads criados (real)" value={totals.leads} />
          <StatCard icon={Crown} color="text-amber-500" label="Clientes tagueados (real)" value={totals.customers} />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhum link ativo. Abra uma campanha e crie um link na aba "Links".
          </CardContent></Card>
        ) : (
          <ScrollArea className="max-h-[520px]">
            <div className="space-y-2 pr-2">
              {rows.map((r) => {
                const clickShare = r.campaign_clicks > 0 ? r.clicks / r.campaign_clicks : 0;
                const isEstimated = r.campaign_clicks > r.clicks; // vários links → estimativa
                return (
                  <Card key={r.link_id}>
                    <CardContent className="p-3 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate flex items-center gap-1.5">
                            <span className="text-muted-foreground">/vip/</span>{r.slug}
                            {r.label && <Badge variant="secondary" className="text-[10px]">{r.label}</Badge>}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {r.campaign_name}{r.group_names.length ? ` · ${r.group_names.join(", ")}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setQrFor(r)} title="QR Code">
                            <QrCode className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => copy(r.slug)} title="Copiar link">
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* FUNIL */}
                      <div className="grid grid-cols-4 gap-1.5">
                        <FunnelStep icon={MousePointerClick} color="text-blue-500"
                          value={r.clicks} label="cliques" tag="real"
                          hint="Quantas pessoas abriram ESTE link específico (contador do link)." />
                        <FunnelStep icon={LogIn} color="text-emerald-500"
                          value={isEstimated ? r.estimated_entries : r.group_entries}
                          label="entradas"
                          tag={isEstimated ? "estimativa" : "real"}
                          hint={isEstimated
                            ? `ESTIMATIVA: vários links levam ao mesmo grupo, então não dá pra saber por qual link cada pessoa entrou. Este link = ${(clickShare * 100).toFixed(0)}% dos cliques da campanha → ~${(clickShare * 100).toFixed(0)}% das ${r.group_entries} entradas reais do grupo.`
                            : "REAL: entradas confirmadas no grupo pelo webhook do WhatsApp."} />
                        <FunnelStep icon={UserPlus} color="text-fuchsia-500"
                          value={r.leads_created} label="leads" tag="real"
                          hint="REAL: entradas que NÃO eram clientes → viraram lead no canal 'Grupo VIP'." />
                        <FunnelStep icon={Crown} color="text-amber-500"
                          value={r.customers_tagged} label="clientes" tag="real"
                          hint="REAL: entradas que já eram clientes → apenas tagueados (não viram lead)." />
                      </div>

                      {isEstimated && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-500 flex items-center gap-1">
                          <Info className="h-3 w-3 shrink-0" />
                          Entradas por link são <strong>estimadas</strong> pela proporção de cliques — as entradas reais ({r.group_entries}) são do grupo inteiro.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* QR DIALOG */}
        <Dialog open={!!qrFor} onOpenChange={(o) => !o && setQrFor(null)}>
          <DialogContent className="max-w-xs">
            <DialogHeader><DialogTitle className="text-sm">QR Code · /vip/{qrFor?.slug}</DialogTitle></DialogHeader>
            {qrFor && (
              <div className="flex flex-col items-center gap-3">
                <div className="bg-white p-4 rounded-lg">
                  <QRCode id={`qr-${qrFor.slug}`} value={linkUrl(qrFor.slug)} size={200} />
                </div>
                <p className="text-[11px] text-muted-foreground break-all text-center">{linkUrl(qrFor.slug)}</p>
                <div className="flex gap-2 w-full">
                  <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => copy(qrFor.slug)}>
                    <Copy className="h-3.5 w-3.5" /> Copiar
                  </Button>
                  <Button size="sm" className="flex-1 gap-1" onClick={() => downloadQr(qrFor.slug)}>
                    <Download className="h-3.5 w-3.5" /> Baixar
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function StatCard({ icon: Icon, color, label, value }: { icon: any; color: string; label: string; value: number }) {
  return (
    <Card><CardContent className="p-4 flex items-center gap-3">
      <div className="rounded-lg bg-muted p-2"><Icon className={`h-5 w-5 ${color}`} /></div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none">{value.toLocaleString("pt-BR")}</p>
        <p className="text-[11px] text-muted-foreground mt-1 truncate">{label}</p>
      </div>
    </CardContent></Card>
  );
}

function FunnelStep({ icon: Icon, color, value, label, tag, hint }: {
  icon: any; color: string; value: number; label: string; tag: "real" | "estimativa"; hint: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="rounded-md border bg-muted/30 p-2 text-center cursor-help">
          <Icon className={`h-3.5 w-3.5 mx-auto ${color}`} />
          <p className="text-base font-bold leading-tight mt-0.5">{value.toLocaleString("pt-BR")}</p>
          <p className="text-[9px] text-muted-foreground">{label}</p>
          <Badge variant={tag === "real" ? "outline" : "secondary"}
            className={`text-[8px] mt-0.5 px-1 py-0 ${tag === "estimativa" ? "text-amber-600" : ""}`}>
            {tag}
          </Badge>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}
