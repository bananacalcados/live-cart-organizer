import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fiscalDocumentId: string;
  modelo: number; // 65 NFC-e | 55 NF-e
  numero?: number | string;
  onCancelled?: () => void;
}

export function CancelFiscalDocDialog({ open, onOpenChange, fiscalDocumentId, modelo, numero, onCancelled }: Props) {
  const [justificativa, setJustificativa] = useState("");
  const [loading, setLoading] = useState(false);

  const limiteMin = modelo === 65 ? 30 : 24 * 60;
  const tipoLabel = modelo === 65 ? "NFC-e" : "NF-e";

  const handleCancel = async () => {
    const j = justificativa.trim();
    if (j.length < 15) return toast.error("Justificativa precisa de no mínimo 15 caracteres");
    if (j.length > 255) return toast.error("Justificativa máxima de 255 caracteres");

    setLoading(true);
    const { data, error } = await supabase.functions.invoke("nfce-cancelar", {
      body: { fiscal_document_id: fiscalDocumentId, justificativa: j },
    });
    setLoading(false);

    if (error) return toast.error(error.message);
    if ((data as any)?.ok) {
      toast.success(`${tipoLabel} cancelada com sucesso`);
      onOpenChange(false);
      setJustificativa("");
      onCancelled?.();
    } else {
      toast.error((data as any)?.error || "Falha no cancelamento");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Cancelar {tipoLabel} {numero && `nº ${numero}`}
          </DialogTitle>
          <DialogDescription>
            O cancelamento é irreversível e enviado à SEFAZ. Prazo legal: {limiteMin >= 60 ? `${limiteMin / 60}h` : `${limiteMin} min`} após autorização.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Justificativa (15-255 caracteres) *</Label>
          <Textarea
            rows={4}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            placeholder="Ex: Cliente desistiu da compra antes da entrega da mercadoria."
            maxLength={255}
          />
          <p className="text-xs text-muted-foreground">{justificativa.length}/255</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Voltar</Button>
          <Button variant="destructive" onClick={handleCancel} disabled={loading || justificativa.trim().length < 15}>
            {loading ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Cancelando…</> : "Cancelar nota"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
