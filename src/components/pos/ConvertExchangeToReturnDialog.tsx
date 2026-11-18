import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** Confirmação de "Converter em devolução" — chama só a RPC exchange_convert_to_return (mesmo registro, nota e reversa). */
export function ConvertExchangeToReturnDialog({ troca, onClose, onDone }: {
  troca: { id: string; codigo_devolucao: string | null } | null; onClose: () => void; onDone: () => void;
}) {
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const code = troca?.codigo_devolucao || "";
  const submit = async () => {
    if (!troca) return;
    setSaving(true);
    const { error } = await (supabase.rpc as any)("exchange_convert_to_return", { p_troca_id: troca.id, p_motivo: obs.trim() || null });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${code} agora é uma devolução.`);
    setObs(""); onClose(); onDone();
  };
  return (
    <Dialog open={!!troca} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Converter a troca {code} em devolução?</DialogTitle>
          <DialogDescription>
            A cliente desistiu da troca e quer o dinheiro de volta. O registro continua o mesmo (mesma nota de devolução e mesmo código de postagem). O produto de troca reservado é liberado. Depois é só receber o produto e registrar o estorno normalmente. Não manda mensagem para a cliente.
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
