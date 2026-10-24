import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface FailedMsg {
  id: string;
  kind: string;
  phone: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  cart_link: "Link do carrinho",
  pix_code: "Código Pix",
  payment_confirmation: "Confirmação de pagamento",
  register_confirm: "Confirmação de cadastro",
};

const mask = (p: string) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 11 ? `(${d.slice(-11, -9)}) ****-${d.slice(-4)}` : p;
};

/**
 * Alerta da Central da Live: mensagens automáticas que esgotaram as 5
 * tentativas da fila. O botão devolve a mensagem para a fila e acorda o worker.
 */
export function SelfServiceQueueAlerts({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<FailedMsg[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data } = await (supabase as any)
      .from("selfservice_message_queue")
      .select("id, kind, phone, attempts, last_error, created_at")
      .eq("event_id", eventId)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(20);
    setRows((data as FailedMsg[]) || []);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`ss-queue-failed-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "selfservice_message_queue", filter: `event_id=eq.${eventId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const resend = async (id: string) => {
    setBusy(id);
    const { data, error } = await (supabase as any).rpc("selfservice_queue_requeue", { p_id: id });
    if (error || !data) {
      setBusy(null);
      toast.error("Não foi possível reenviar");
      return;
    }
    // Acorda o worker para enviar já (sem esperar outra mensagem nova).
    await supabase.functions.invoke("live-selfservice", { body: { action: "kick" } }).catch(() => {});
    setBusy(null);
    toast.success("Mensagem voltou para a fila de envio");
    load();
  };

  if (!rows.length) return null;

  return (
    <div className="mx-3 mt-2 space-y-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4" />
        {rows.length === 1 ? "1 mensagem automática não entregue" : `${rows.length} mensagens automáticas não entregues`}
      </p>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
          <span>
            {KIND_LABEL[r.kind] || r.kind} → {mask(r.phone)} · {r.attempts} tentativas
          </span>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => resend(r.id)} disabled={!!busy}>
            {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Reenviar
          </Button>
        </div>
      ))}
    </div>
  );
}
