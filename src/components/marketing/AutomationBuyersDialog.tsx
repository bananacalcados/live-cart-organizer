import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CampaignChatViewerDialog } from "@/components/pos/automation/CampaignChatViewerDialog";

interface Buyer {
  sale_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  total: number;
  sale_at: string;
  touch_at: string;
  store_name: string | null;
  sale_type: string | null;
  sales_channel: string | null;
  event_id: string | null;
  whatsapp_number_id: string | null;
  items: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  flowId: string | null;
  flowName: string;
  days: number;
}

const dt = (v: string) =>
  new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function channelLabel(b: Buyer): string {
  if (b.sale_type === "live" || b.event_id) return "Live";
  if (b.sale_type === "physical" || b.sales_channel === "presencial") return "Loja física";
  if (b.sales_channel === "site") return "Site";
  if (b.sales_channel === "whatsapp") return "Online · WhatsApp";
  return "Online · Link";
}

function gap(a: string, b: string): string {
  const h = (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min depois`;
  if (h < 48) return `${Math.round(h)} h depois`;
  return `${Math.round(h / 24)} dias depois`;
}

export function AutomationBuyersDialog({ open, onOpenChange, flowId, flowName, days }: Props) {
  const [rows, setRows] = useState<Buyer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<Buyer | null>(null);

  useEffect(() => {
    if (!open || !flowId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase
      .rpc("automation_sales_buyers" as any, { p_flow_id: flowId, p_days: days })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setError("Não foi possível carregar os compradores."); setRows([]); }
        else setRows((data as Buyer[]) || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, flowId, days]);

  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Compradores · {flowName} · até {days} dias</DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <p className="text-sm text-destructive py-6 text-center">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma venda nesse prazo.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{rows.length} vendas · {brl(total)}</p>
              {rows.map((b) => (
                <div key={b.sale_id} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">{b.customer_name || "Sem nome"}</span>
                      <Badge variant="secondary" className="text-[10px]">{channelLabel(b)}</Badge>
                      {b.store_name && <Badge variant="outline" className="text-[10px]">{b.store_name}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{b.customer_phone}</p>
                    {b.items && <p className="text-xs">{b.items}</p>}
                    <p className="text-[11px] text-muted-foreground">
                      Recebeu {dt(b.touch_at)} → comprou {dt(b.sale_at)} ({gap(b.touch_at, b.sale_at)})
                    </p>
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end gap-2">
                    <span className="font-semibold text-sm">{brl(b.total)}</span>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setChat(b)} disabled={!b.customer_phone}>
                      <MessageCircle className="h-3.5 w-3.5" />Conversa
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <CampaignChatViewerDialog
        open={!!chat}
        onOpenChange={(o) => !o && setChat(null)}
        phone={chat?.customer_phone || null}
        name={chat?.customer_name}
        whatsappNumberId={chat?.whatsapp_number_id}
      />
    </>
  );
}
