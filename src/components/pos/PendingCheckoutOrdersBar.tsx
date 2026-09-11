import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BadgeCheck, Check, Copy, Loader2, Pencil, Send, ShoppingCart, X } from "lucide-react";
import { EditPendingCheckoutDialog } from "./EditPendingCheckoutDialog";
import { MarkCheckoutPaidDialog } from "./MarkCheckoutPaidDialog";
import { posSendText, type PosSendProvider } from "@/lib/pos/posWhatsappSend";

interface PendingSale {
  id: string;
  store_id: string;
  total: number;
  created_at: string;
  payment_details: any;
}

interface PaidSale {
  id: string;
  total: number;
  created_at: string;
  status: string;
  sale_type: string | null;
  payment_method: string | null;
  payment_details: any;
  expedition_stage: string | null;
  expedition_finished_at: string | null;
  tracking_code: string | null;
}

const STAGE_LABEL: Record<string, string> = {
  novo: "Na expedição — aguardando separação",
  preparacao: "Na expedição — em preparação",
  separacao: "Na expedição — em separação",
  conferencia: "Na expedição — em conferência",
  finalizado: "Expedido",
};

interface Props {
  phone: string;
  sendVia: PosSendProvider;
  selectedNumberId: string | null;
  /** Recarrega quando um link novo é gerado. */
  refreshKey?: number;
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const linkOf = (s: PendingSale) => `https://checkout.bananacalcados.com.br/checkout-loja/${s.store_id}/${s.id}`;

/**
 * Faixa no topo da conversa com os pedidos que já têm link de checkout
 * mas ainda não foram pagos. Permite editar o pedido (dados da cliente,
 * frete, endereço, itens) sem precisar gerar um link novo.
 */
export function PendingCheckoutOrdersBar({ phone, sendVia, selectedNumberId, refreshKey }: Props) {
  const [sales, setSales] = useState<PendingSale[]>([]);
  const [paidSales, setPaidSales] = useState<PaidSale[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const digits = (phone || "").replace(/\D/g, "");
    if (digits.length < 8) { setSales([]); setPaidSales([]); return; }
    const suffix = digits.slice(-8);
    // Alguns cadastros antigos gravaram o telefone truncado (11 dígitos).
    const truncated = digits.length > 11 ? digits.slice(0, 11) : null;
    const phoneOr = [
      `phone_suffix8.eq.${suffix}`,
      `customer_phone.eq.${digits}`,
      ...(truncated ? [`customer_phone.eq.${truncated}`, `phone_suffix8.eq.${truncated.slice(-8)}`] : []),
    ].join(",");
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [pending, paid] = await Promise.all([
      supabase
        .from("pos_sales")
        .select("id, store_id, total, created_at, payment_details")
        .or(phoneOr)
        .eq("status", "online_pending")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("pos_sales")
        .select("id, total, created_at, status, sale_type, payment_method, expedition_stage, expedition_finished_at, tracking_code")
        .or(phoneOr)
        .in("status", ["paid", "completed"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    setSales((pending.data || []) as PendingSale[]);
    setPaidSales((paid.data || []) as PaidSale[]);
  }, [phone]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const cancelSale = async (id: string) => {
    if (!window.confirm("Cancelar este pedido sem pagamento? O link deixa de valer.")) return;
    await supabase.from("pos_sales").update({ status: "cancelled" }).eq("id", id);
    await supabase.from("chat_awaiting_payment").delete().eq("sale_id", id);
    toast.success("Pedido cancelado");
    load();
  };

  const resend = async (s: PendingSale) => {
    setSendingId(s.id);
    try {
      const link = linkOf(s);
      const message = `Oi! 🛍️ Atualizei seu pedido (${fmt(Number(s.total || 0))}).\n\nÉ só finalizar por aqui:\n${link}`;
      const messageId = await posSendText({ provider: sendVia, phone, message, numberId: selectedNumberId });
      await supabase.from("whatsapp_messages").insert({
        phone, message, direction: "outgoing", status: "sent",
        message_id: messageId, whatsapp_number_id: selectedNumberId || null,
      });
      toast.success("Link enviado!");
    } catch {
      toast.error("Erro ao enviar o link");
    } finally {
      setSendingId(null);
    }
  };

  if (sales.length === 0 && paidSales.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-b px-2 py-1.5 space-y-1.5">
      {paidSales.map((p) => {
        const stage = p.expedition_finished_at ? "finalizado" : (p.expedition_stage || "");
        const info = STAGE_LABEL[stage] || (p.status === "completed" ? "Pedido concluído" : "Pagamento confirmado");
        return (
          <div key={p.id} className="flex flex-wrap items-center gap-1.5 rounded-md bg-emerald-500/10 px-1.5 py-1">
            <Badge className="gap-1 bg-emerald-600 text-white text-[10px]">
              <Check className="h-3 w-3" /> PAGO
            </Badge>
            <span className="text-xs font-semibold">{fmt(Number(p.total || 0))}</span>
            <span className="text-[11px] text-emerald-800 dark:text-emerald-300 font-medium">{info}</span>
            {p.payment_method && (
              <span className="text-[10px] text-muted-foreground uppercase">{p.payment_method}</span>
            )}
            {p.tracking_code && (
              <span className="text-[10px] text-muted-foreground">Rastreio: {p.tracking_code}</span>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto">
              {new Date(p.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        );
      })}
      {sales.length > 0 && (
        <div className="rounded-md bg-amber-500/10 px-1.5 py-1 space-y-1.5">
      {sales.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-1.5">
          <Badge className="gap-1 bg-amber-500 text-white text-[10px]">
            <ShoppingCart className="h-3 w-3" /> Sem pagamento
          </Badge>
          <span className="text-xs font-semibold">{fmt(Number(s.total || 0))}</span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(s.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px] gap-1" onClick={() => setEditing(s.id)}>
              <Pencil className="h-3 w-3" /> Editar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px] gap-1"
              onClick={async () => {
                await navigator.clipboard.writeText(linkOf(s));
                setCopiedId(s.id);
                setTimeout(() => setCopiedId(null), 1500);
              }}
            >
              {copiedId === s.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              Copiar
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] gap-1 text-[#00a884]" onClick={() => resend(s)} disabled={sendingId === s.id}>
              {sendingId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Reenviar
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-destructive" onClick={() => cancelSale(s.id)} title="Cancelar pedido">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
        </div>
      )}


      {editing && (
        <EditPendingCheckoutDialog
          open={!!editing}
          onOpenChange={(v) => { if (!v) setEditing(null); }}
          saleId={editing}
          onSaved={load}
        />
      )}
    </div>
  );
}
