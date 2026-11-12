import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { POSWhatsApp } from "./POSWhatsApp";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  customerPhone?: string;
  /** Instância exata da conversa; sem isso o chat escolhe a última usada pela cliente. */
  customerWhatsappNumberId?: string | null;
}

/** O mesmo WhatsApp completo do PDV, aberto diretamente na cliente e instância escolhidas. */
export function POSTaskWhatsAppDialog({ open, onOpenChange, storeId, customerPhone, customerWhatsappNumberId }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[90vh] min-w-0 p-0 overflow-hidden gap-0 border-0 bg-pos-black shadow-2xl">
        <Button variant="secondary" size="icon" className="absolute right-2 top-2 z-[100] h-8 w-8 shadow-md" onClick={() => onOpenChange(false)} aria-label="Fechar conversa">
          <X className="h-4 w-4" />
        </Button>
        <div className="h-full w-full min-w-0 overflow-hidden">
          <POSWhatsApp embeddedInDialog storeId={storeId} initialPhone={customerPhone} initialWhatsappNumberId={customerWhatsappNumberId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
