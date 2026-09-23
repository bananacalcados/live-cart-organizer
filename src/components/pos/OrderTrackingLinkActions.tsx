import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, Loader2, Send, Truck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConversationInstance } from "@/hooks/useConversationInstance";
import { sendTrackingWhatsApp } from "@/lib/pos/trackingSend";
import {
  INCIDENT_OPTIONS,
  type IncidentType,
  getShipmentTracking,
  publicTrackingUrl,
  setShipmentIncident,
} from "@/lib/shipmentTracking";

interface Props {
  saleId: string;
  customerName?: string | null;
  customerPhone?: string | null;
}

/**
 * Link de acompanhamento do pedido dentro do modal do cliente (chat do PDV):
 * copiar, enviar no WhatsApp da conversa e marcar avisos (extraviado, atraso...).
 */
export function OrderTrackingLinkActions({ saleId, customerName, customerPhone }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [incident, setIncident] = useState<IncidentType | null>(null);
  const [sending, setSending] = useState(false);
  const { effectiveNumberId } = useConversationInstance(customerPhone || null);

  useEffect(() => {
    let alive = true;
    getShipmentTracking(saleId)
      .then((info) => {
        if (!alive || !info) return;
        setCode(info.trackingCode);
        setIncident(info.incidentType);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [saleId]);

  if (!code) return null;

  const url = publicTrackingUrl(code);
  const incidentLabel = INCIDENT_OPTIONS.find((o) => o.value === incident)?.label;

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    toast.success("Link de acompanhamento copiado");
  };

  const send = async () => {
    if (!customerPhone) return toast.error("Cliente sem WhatsApp");
    if (!effectiveNumberId) return toast.error("Nenhuma instância de WhatsApp disponível");
    setSending(true);
    try {
      const first = String(customerName || "").trim().split(/\s+/)[0];
      const message = `${first ? `Oi, ${first}! ` : ""}Acompanhe o preparo e o envio do seu pedido por aqui:\n\n${url}`;
      const id = await sendTrackingWhatsApp({ phone: customerPhone, message, numberId: effectiveNumberId });
      if (!id) throw new Error("O provedor não confirmou o envio");
      toast.success("Link enviado no WhatsApp");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao enviar o link", { duration: 8000 });
    } finally {
      setSending(false);
    }
  };

  const mark = async (type: IncidentType | null) => {
    try {
      await setShipmentIncident(saleId, type);
      setIncident(type);
      toast.success(type ? "Aviso publicado no acompanhamento" : "Aviso removido");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar o aviso");
    }
  };

  const btn =
    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors";

  return (
    <>
      <span className="inline-flex items-center gap-1 rounded-md border border-sky-400/50 bg-sky-500/10 px-2 py-1 font-mono text-[11px] font-bold text-sky-700 dark:text-sky-300">
        <Truck className="h-3 w-3" /> {code}
      </span>

      <button type="button" onClick={copy} className={`${btn} border-sky-400/50 bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300`} title="Copiar o link de acompanhamento">
        <Copy className="h-3 w-3" /> Copiar link
      </button>

      <button type="button" onClick={send} disabled={sending} className={`${btn} border-emerald-400/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-60 dark:text-emerald-300`} title="Enviar o link no WhatsApp da conversa">
        {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Enviar link
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`${btn} ${incident ? "border-amber-500 bg-amber-500/20 text-amber-800 dark:text-amber-300" : "border-amber-400/50 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"}`}
            title="Mostrar um aviso no acompanhamento do cliente"
          >
            <AlertTriangle className="h-3 w-3" /> {incidentLabel || "Aviso"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[100]">
          <DropdownMenuLabel>Mostrar no acompanhamento</DropdownMenuLabel>
          {INCIDENT_OPTIONS.map((o) => (
            <DropdownMenuItem key={o.value} onSelect={() => mark(o.value)}>
              {o.label}
            </DropdownMenuItem>
          ))}
          {incident ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => mark(null)}>Remover aviso</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
