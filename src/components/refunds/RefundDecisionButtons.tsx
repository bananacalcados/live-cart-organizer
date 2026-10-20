import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { reauthWithPassword, refundApi } from "@/lib/refunds";
import { useToast } from "@/hooks/use-toast";

/** Aprovar / Recusar (só admin). Os dois exigem a senha do sistema; recusar exige motivo. */
export function RefundDecisionButtons({ refundId, onDone }: { refundId: string; onDone?: () => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => { setMode(null); setPassword(""); setReason(""); };

  const confirm = async () => {
    if (!mode) return;
    if (mode === "reject" && !reason.trim()) return;
    setBusy(true);
    try {
      await reauthWithPassword(password);
      const res = mode === "approve" ? await refundApi.approve(refundId) : await refundApi.reject(refundId, reason.trim());
      toast({ title: res.message || (mode === "approve" ? "Estorno aprovado" : "Estorno recusado") });
      close();
      onDone?.();
    } catch (e: any) {
      toast({ title: "Não foi feito", description: e?.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="flex gap-1.5">
        <button onClick={() => setMode("approve")} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90">
          <Check className="h-3 w-3" /> Aprovar
        </button>
        <button onClick={() => setMode("reject")} className="inline-flex items-center gap-1 rounded-md bg-destructive px-2.5 py-1.5 text-xs font-bold text-destructive-foreground hover:bg-destructive/90">
          <X className="h-3 w-3" /> Recusar
        </button>
      </div>
      <Dialog open={!!mode} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{mode === "approve" ? "Aprovar estorno" : "Recusar estorno"}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            {mode === "reject" && (
              <div>
                <label className="text-xs text-muted-foreground">Motivo da recusa (obrigatório)</label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
              </div>
            )}
            {mode === "approve" && <p className="text-muted-foreground">Ao aprovar, o estorno é enviado ao Mercado Pago na hora.</p>}
            <div>
              <label className="text-xs text-muted-foreground">Confirme sua senha do sistema</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={close} className="rounded-md border border-border px-3 py-2 hover:bg-muted">Cancelar</button>
              <button
                onClick={() => void confirm()}
                disabled={busy || !password || (mode === "reject" && !reason.trim())}
                className={`inline-flex items-center gap-1 rounded-md px-3 py-2 font-bold disabled:opacity-50 ${mode === "approve" ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"}`}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
