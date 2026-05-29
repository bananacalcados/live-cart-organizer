import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface FailedDispatch {
  id: string;
  group_name: string | null;
  block_order: number | null;
  block_type: string | null;
  attempts: number | null;
  error_message: string | null;
  created_at: string;
}

const BLOCK_LABELS: Record<string, string> = {
  text: "Texto",
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
  sticker: "Figurinha",
  poll: "Enquete",
};

interface Props {
  campaignId: string;
  /** Muda este valor para forçar um recarregamento (ex.: após um disparo). */
  refreshKey?: number;
}

/**
 * Mostra os blocos/grupos que falharam (e foram pulados) nos disparos de
 * Grupos VIPs. Lê de `group_campaign_block_dispatches` (status = 'failed').
 */
export function GroupDispatchErrorsPanel({ campaignId, refreshKey = 0 }: Props) {
  const [rows, setRows] = useState<FailedDispatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);

  const fetchErrors = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("group_campaign_block_dispatches")
      .select("id, group_name, block_order, block_type, attempts, error_message, created_at")
      .eq("campaign_id", campaignId)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(100);
    setRows((data as FailedDispatch[]) || []);
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    fetchErrors();
  }, [fetchErrors, refreshKey]);

  // Realtime: atualiza quando novas falhas são registradas
  useEffect(() => {
    const channel = supabase
      .channel(`block-dispatches-${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_campaign_block_dispatches",
          filter: `campaign_id=eq.${campaignId}`,
        },
        () => fetchErrors(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId, fetchErrors]);

  if (rows.length === 0) return null;

  return (
    <Alert variant="destructive" className="py-2.5">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between gap-2 text-xs">
        <button
          type="button"
          className="flex items-center gap-1.5 font-semibold"
          onClick={() => setOpen((v) => !v)}
        >
          {rows.length} envio(s) com erro (grupos/blocos pulados)
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={fetchErrors}
          title="Atualizar"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </AlertTitle>
      {open && (
        <AlertDescription className="mt-1.5">
          <ScrollArea className="max-h-48">
            <div className="space-y-1.5 pr-2">
              {rows.map((r) => (
                <div key={r.id} className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">
                      {r.group_name || "Grupo"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      Bloco {(r.block_order ?? 0) + 1} · {BLOCK_LABELS[r.block_type || "text"] || r.block_type}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(r.created_at), "dd/MM HH:mm", { locale: ptBR })} · {r.attempts ?? 0} tentativa(s)
                    </span>
                  </div>
                  {r.error_message && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground break-words">
                      {r.error_message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </AlertDescription>
      )}
    </Alert>
  );
}
