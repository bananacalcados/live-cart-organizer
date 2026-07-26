import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, MessageSquare, Search } from "lucide-react";
import { toast } from "sonner";
import { LeadChatHistoryDialog } from "./LeadChatHistoryDialog";

export type ConvertedLead = {
  phone: string;
  name: string;
  instagram: string;
  capture_channel: string;
  captured_at: string | null;
  conversion_at: string;
  conversion_value: number;
  conversion_channel: string;
  purchases: number;
  total_revenue: number;
  was_customer_before: boolean;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: string;
  /** same params used by the dashboard so the list matches the table numbers */
  params: Record<string, unknown>;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ConvertedLeadsDialog({ open, onOpenChange, channel, params }: Props) {
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<ConvertedLead[]>([]);
  const [q, setQ] = useState("");
  const [chatLead, setChatLead] = useState<ConvertedLead | null>(null);

  useEffect(() => {
    if (!open || !channel) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setQ("");
      try {
        const { data, error } = await supabase.functions.invoke("marketing-leads-dashboard", {
          body: { ...params, list_channel: channel },
        });
        if (error) throw error;
        if (!cancelled) setLeads((data?.leads || []) as ConvertedLead[]);
      } catch (e: any) {
        if (!cancelled) toast.error("Erro ao carregar convertidos: " + (e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return leads;
    return leads.filter(l =>
      (l.name || "").toLowerCase().includes(term) ||
      (l.instagram || "").toLowerCase().includes(term) ||
      (l.phone || "").includes(term.replace(/\D/g, "")),
    );
  }, [leads, q]);

  const totals = useMemo(() => ({
    count: filtered.length,
    value: filtered.reduce((a, l) => a + (l.conversion_value || 0), 0),
  }), [filtered]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl w-[95vw] h-[85vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle className="text-base">
              Leads convertidos — <span className="text-primary">{channel}</span>
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {loading ? "Carregando..." : `${totals.count} leads · ${brl(totals.value)} em 1ª compra`}
            </p>
          </DialogHeader>

          <div className="px-4 py-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Buscar por nome, @ ou telefone"
                className="pl-7 h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-12">
                Nenhum lead convertido neste canal.
              </p>
            )}
            {!loading && filtered.map(l => (
              <div
                key={l.phone}
                className="px-4 py-2.5 border-b flex items-center gap-3 hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{l.name || "Sem nome"}</span>
                    {l.instagram && (
                      <Badge variant="outline" className="text-[10px]">@{l.instagram.replace(/^@/, "")}</Badge>
                    )}
                    {l.was_customer_before
                      ? <Badge variant="secondary" className="text-[10px]">Recorrente</Badge>
                      : <Badge className="text-[10px]">1ª compra</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {l.phone} · comprou em {new Date(l.conversion_at).toLocaleDateString("pt-BR")} via {l.conversion_channel}
                    {l.purchases > 1 && ` · ${l.purchases} compras (${brl(l.total_revenue)})`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{brl(l.conversion_value)}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] mt-1"
                    onClick={() => setChatLead(l)}
                  >
                    <MessageSquare className="h-3 w-3 mr-1" /> Conversas
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <LeadChatHistoryDialog
        open={!!chatLead}
        onOpenChange={(o) => !o && setChatLead(null)}
        phone={chatLead?.phone || ""}
        name={chatLead?.name || ""}
      />
    </>
  );
}
