import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** "Converter em troca" — RPC exchange_convert_return_to_exchange: mesmo registro e mesma nota de devolução. */
export function ConvertReturnToExchangeDialog({ troca, onClose, onDone }: {
  troca: { id: string; codigo_devolucao: string | null } | null; onClose: () => void; onDone: () => void;
}) {
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const code = troca?.codigo_devolucao || "";
  const submit = async () => {
    if (!troca) return;
    setSaving(true);
    const { error } = await (supabase.rpc as any)("exchange_convert_return_to_exchange", { p_troca_id: troca.id, p_motivo: obs.trim() || null });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${code} agora é uma troca. Gere a reversa nova e adicione o produto.`);
    setObs(""); onClose(); onDone();
  };
  return (
    <Dialog open={!!troca} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Converter a devolução {code} em troca?</DialogTitle>
          <DialogDescription>
            A cliente vai trocar em vez de devolver. O registro e a nota de devolução continuam os mesmos (nenhuma nota nova). Depois gere a reversa nova, se o prazo venceu, e adicione o produto da troca. Não manda mensagem para a cliente.
          </DialogDescription>
        </DialogHeader>
        <Textarea aria-label="Observação" placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Voltar</Button>
          <Button variant="secondary" onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Converter em devolução</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
