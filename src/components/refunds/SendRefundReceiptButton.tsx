import { useState } from "react";
import { FileText, Loader2, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { refundApi, type ReceiptSendPreview } from "@/lib/refunds";
import { useToast } from "@/hooks/use-toast";

/**
 * Fase 4 — "Enviar comprovante à cliente": abre prévia (destino, instância, texto
 * editável, PDF) e só envia no clique final. Reenvio pede confirmação extra.
 */
export function SendRefundReceiptButton({
  refundId, sentAt, whatsappNumberId, onSent,
}: { refundId: string; sentAt?: string | null; whatsappNumberId?: string | null; onSent?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<ReceiptSendPreview | null>(null);
  const [text, setText] = useState("");
  const [confirmResend, setConfirmResend] = useState(false);
  const [localSentAt, setLocalSentAt] = useState<string | null>(sentAt || null);

  const already = preview?.already_sent_at || localSentAt;
  const fmt = (d: string) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  const openPreview = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(true); setLoading(true); setPreview(null); setConfirmResend(false);
    try {
      const p = await refundApi.receiptSendPreview(refundId, whatsappNumberId);
      setPreview(p); setText(p.message);
    } catch (err: any) {
      toast({ title: "Não consegui montar a prévia", description: err?.message, variant: "destructive" });
      setOpen(false);
    } finally { setLoading(false); }
  };

  const send = async () => {
    if (!preview || preview.blocked) return;
    if (already && !confirmResend) return;
    setSending(true);
    try {
      const r = await refundApi.sendReceipt({ id: refundId, message: text, confirm_resend: !!already, whatsapp_number_id: preview.instance?.id });
      setLocalSentAt(r.sent_at);
      toast({ title: "Comprovante enviado à cliente" });
      setOpen(false);
      onSent?.();
    } catch (err: any) {
      toast({ title: "Não enviado", description: err?.message, variant: "destructive" });
    } finally { setSending(false); }
  };

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-primary-foreground hover:bg-primary/90"
      >
        <Send className="h-3 w-3" />
        {localSentAt ? `Enviado em ${fmt(localSentAt)} — reenviar?` : "Enviar comprovante à cliente"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader><DialogTitle>Enviar comprovante de estorno</DialogTitle></DialogHeader>
          {loading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          {preview && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border p-3 space-y-1">
                <p><span className="text-muted-foreground">Cliente:</span> <b>{preview.customer_name || "—"}</b></p>
                <p><span className="text-muted-foreground">Destino:</span> <b>{preview.phone_masked || "sem WhatsApp"}</b></p>
                <p><span className="text-muted-foreground">Vai sair por:</span> <b>{preview.instance?.label || "—"}</b></p>
                <p className="flex items-center gap-1"><FileText className="h-4 w-4 text-muted-foreground" /> {preview.file_name}</p>
              </div>
              {preview.blocked && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive">{preview.blocked}</p>
              )}
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} disabled={!!preview.blocked} />
              {already && !preview.blocked && (
                <label className="flex items-start gap-2 rounded-md border border-border bg-muted p-2 text-xs">
                  <input type="checkbox" checked={confirmResend} onChange={(e) => setConfirmResend(e.target.checked)} className="mt-0.5" />
                  Já enviado em {fmt(already)}{preview.already_sent_to ? ` para ${preview.already_sent_to}` : ""}. Confirmo que quero enviar de novo.
                </label>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Cancelar</button>
                <button
                  onClick={() => void send()}
                  disabled={sending || !!preview.blocked || !text.trim() || (!!already && !confirmResend)}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
