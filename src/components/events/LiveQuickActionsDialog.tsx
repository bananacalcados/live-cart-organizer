import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { CustomerFichaDialog } from "@/components/CustomerFichaDialog";
import { MarkOrderPaidDialog } from "@/components/MarkOrderPaidDialog";
import { DbOrder } from "@/types/database";
import { Stage, STAGES } from "@/types/order";
import {
  BadgeCheck,
  ClipboardList,
  Copy,
  CreditCard,
  KeyRound,
  Loader2,
  Move,
  Shuffle,
} from "lucide-react";
import { useEventStore } from "@/stores/eventStore";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  name?: string;
  order?: DbOrder | null;
  stages?: Stage[];
}

const CHECKOUT_BASE = "https://checkout.bananacalcados.com.br";

/**
 * Ações rápidas do atendimento da live: link autenticado da Área de Membros,
 * link de checkout, ficha do cliente, mudança de etapa e pagamento manual.
 */
export function LiveQuickActionsDialog({
  open,
  onOpenChange,
  phone,
  name,
  order,
  stages = STAGES,
}: Props) {
  const { updateOrder } = useDbOrderStore();
  const [loadingLink, setLoadingLink] = useState(false);
  const [memberLink, setMemberLink] = useState<string | null>(null);
  const [fichaOpen, setFichaOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [savingStage, setSavingStage] = useState(false);
  const [sendingWaInitial, setSendingWaInitial] = useState(false);
  const orderEvent = useEventStore((st) => st.events.find((ev) => ev.id === order?.event_id));
  const waInitialReady =
    Boolean((orderEvent as any)?.wa_initial_enabled) &&
    Array.isArray((orderEvent as any)?.wa_initial_variants) &&
    ((orderEvent as any).wa_initial_variants as any[]).length > 0;

  const sendWaInitial = async () => {
    if (!order) return;
    setSendingWaInitial(true);
    try {
      const { data, error } = await supabase.functions.invoke("event-order-wa-initial-send", {
        body: { orderId: order.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Mensagem inicial enviada (variação ${((data as any)?.variant_index ?? 0) + 1}/${(data as any)?.variants ?? "?"})`);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao enviar mensagem inicial");
    } finally {
      setSendingWaInitial(false);
    }
  };

  const checkoutLink = order
    ? (order as any).cart_link || `${CHECKOUT_BASE}/checkout/order/${order.id}`
    : null;

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const generateMemberLink = async () => {
    setLoadingLink(true);
    try {
      const { data, error } = await supabase.functions.invoke("issue-member-magic-link", {
        body: { phone },
      });
      if (error) throw error;
      const url = (data as any)?.url as string;
      setMemberLink(url);
      await copy(url, "Link da Área de Membros");
    } catch (e: any) {
      toast.error("Erro ao gerar link: " + (e?.message || "desconhecido"));
    } finally {
      setLoadingLink(false);
    }
  };

  const changeStage = async (stage: string) => {
    if (!order) return;
    setSavingStage(true);
    try {
      await updateOrder(order.id, { stage } as any);
      toast.success("Etapa atualizada");
    } catch {
      toast.error("Não foi possível mudar a etapa");
    } finally {
      setSavingStage(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ações rápidas</DialogTitle>
            <DialogDescription>
              {name ? `${name} · ` : ""}
              {phone}
              {order ? ` · pedido #${String(order.id).slice(0, 6)}` : " · sem pedido nesta live"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={generateMemberLink}
              disabled={loadingLink}
            >
              {loadingLink ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Link da Área de Membros (autenticado)
            </Button>
            {memberLink && (
              <p className="break-all rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                {memberLink}
              </p>
            )}

            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              disabled={!checkoutLink}
              onClick={() => checkoutLink && copy(checkoutLink, "Link do checkout")}
            >
              <Copy className="h-4 w-4" />
              Copiar link do checkout
            </Button>

            {waInitialReady && (
              <Button
                variant="outline"
                className="w-full justify-start gap-2 border-sky-500/50 text-sky-700 hover:bg-sky-500/10"
                disabled={!order || sendingWaInitial}
                onClick={sendWaInitial}
              >
                {sendingWaInitial ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
                Enviar mensagem inicial (uazapi, em rodízio)
              </Button>
            )}

            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              disabled={!order}
              onClick={() => setFichaOpen(true)}
            >
              <ClipboardList className="h-4 w-4" />
              Preencher dados pessoais e de envio
            </Button>

            <div className="space-y-1 rounded-lg border border-border p-2">
              <span className="flex items-center gap-2 text-xs font-semibold">
                <Move className="h-3.5 w-3.5" /> Mudar etapa no Kanban
              </span>
              <Select
                value={order?.stage || undefined}
                onValueChange={changeStage}
                disabled={!order || savingStage}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={order ? "Selecione a etapa" : "Sem pedido"} />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full justify-start gap-2 bg-stage-paid text-white hover:opacity-90"
              disabled={!order}
              onClick={() => setPaidOpen(true)}
            >
              <BadgeCheck className="h-4 w-4" />
              Marcar como PAGO manualmente
            </Button>

            {!order && (
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <CreditCard className="h-3 w-3" /> Crie o pedido para liberar checkout, ficha,
                etapa e pagamento.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {order && (
        <CustomerFichaDialog open={fichaOpen} onOpenChange={setFichaOpen} order={order} />
      )}
      {order && (
        <MarkOrderPaidDialog
          open={paidOpen}
          onOpenChange={setPaidOpen}
          orderId={order.id}
          customerLabel={name || phone}
        />
      )}
    </>
  );
}
