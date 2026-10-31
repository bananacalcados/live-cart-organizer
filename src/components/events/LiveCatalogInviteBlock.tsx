import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

const db = supabase as any;
const hhmm = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "";
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Info {
  url: string; open_count: number; opened_at: string | null;
  invite_sent_at: string | null; invite_kind: "auto" | "manual" | null;
  invite_status: string | null; invite_error: string | null;
  cart: { total: number; paid: boolean } | null;
}

/** Bloco "Catálogo cross-sell" no painel de WhatsApp da cliente (modo WhatsApp + Cadastro online). */
export function LiveCatalogInviteBlock({ eventId, phone, customerId, orderId }: { eventId: string; phone: string; customerId?: string | null; orderId?: string | null }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db.rpc("live_catalog_staff_link", { p_event_id: eventId, p_phone: phone, p_customer_id: customerId || null, p_order_id: orderId || null });
    if (error) { setErr(error.message); return; }
    setErr(null); setInfo(data as Info);
  }, [eventId, phone, customerId, orderId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    setSending(true);
    const { error } = await db.rpc("live_catalog_staff_send", { p_event_id: eventId, p_phone: phone, p_customer_id: customerId || null, p_order_id: orderId || null });
    if (error) { setSending(false); toast.error(error.message); return; }
    const { error: fe } = await supabase.functions.invoke("live-catalog-invite", { body: {} });
    if (fe) toast.error("Convite agendado, mas o envio não foi acordado agora (sai no próximo minuto)");
    else toast.success("Convite enviado para a fila do WhatsApp");
    await load();
    setSending(false);
  };

  if (err) return <div className="p-4 text-sm text-destructive">{err}</div>;
  if (!info) return <div className="p-4"><Loader2 className="h-4 w-4 animate-spin" /></div>;

  const inviteLine = info.invite_status === "scheduled" ? "Convite agendado"
    : info.invite_status === "failed" ? `Convite falhou: ${info.invite_error || ""}`
    : info.invite_sent_at ? `Convite enviado às ${hhmm(info.invite_sent_at)} (${info.invite_kind === "auto" ? "auto" : "manual"})`
    : "Ainda não enviado";

  return (
    <div className="space-y-3 p-4">
      <h3 className="font-semibold">Catálogo cross-sell</h3>
      <div className="break-all rounded-md border bg-muted/40 p-2 text-xs">{info.url}</div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(info.url); toast.success("Link copiado"); }}><Copy className="mr-1 h-4 w-4" />Copiar link</Button>
        <Button size="sm" variant="outline" onClick={() => window.open(info.url, "_blank", "noopener")}><ExternalLink className="mr-1 h-4 w-4" />Abrir</Button>
        <Button size="sm" onClick={send} disabled={sending}>{sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}Enviar no WhatsApp</Button>
      </div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        <li>{inviteLine}</li>
        <li>{info.open_count > 0 ? `Aberto ${info.open_count}x, última vez ${hhmm(info.opened_at)}` : "Não aberto"}</li>
        <li>{info.cart ? `Carrinho do catálogo: ${brl(Number(info.cart.total))} ${info.cart.paid ? "pago" : "em aberto"}` : "Sem carrinho do catálogo"}</li>
      </ul>
      <Button size="sm" variant="ghost" onClick={load}>Atualizar</Button>
    </div>
  );
}
