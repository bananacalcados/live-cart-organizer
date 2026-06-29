import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePixNotificationStore } from "@/stores/pixNotificationStore";

/**
 * Alerta global de pagamento confirmado. Mostra um modal quando um PIX/checkout
 * é pago e o operador NÃO está olhando aquela conversa. Montado uma única vez na
 * raiz do app — também é quem inicializa o store de notificações de PIX.
 */
export function PixPaidGlobalAlert() {
  const paidAlert = usePixNotificationStore((s) => s.paidAlert);
  const clearPaidAlert = usePixNotificationStore((s) => s.clearPaidAlert);
  const requestOpen = usePixNotificationStore((s) => s.requestOpen);
  const dismiss = usePixNotificationStore((s) => s.dismiss);

  // Beep curto pra chamar atenção quando abrir o alerta.
  useEffect(() => {
    if (!paidAlert) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      /* áudio é opcional */
    }
  }, [paidAlert]);

  if (!paidAlert) return null;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) clearPaidAlert(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
            Pagamento confirmado!
          </DialogTitle>
        </DialogHeader>
        <div className="text-center space-y-4 py-4">
          <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto animate-pix-blink">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          </div>
          <div>
            <p className="text-lg font-bold">{paidAlert.name}</p>
            {paidAlert.phone && (
              <p className="text-sm text-muted-foreground">{paidAlert.phone}</p>
            )}
            <p className="text-2xl font-extrabold text-emerald-600 mt-1">
              R$ {paidAlert.amount.toFixed(2)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={clearPaidAlert}>
            Fechar
          </Button>
          <Button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => {
              requestOpen(paidAlert.phone, paidAlert.numberId);
              dismiss(paidAlert.saleId);
              clearPaidAlert();
            }}
          >
            Abrir conversa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
