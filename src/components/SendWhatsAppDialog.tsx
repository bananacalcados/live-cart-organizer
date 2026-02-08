import { useState } from "react";
import { MessageCircle, Send, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useZapi } from "@/hooks/useZapi";
import { Order } from "@/types/order";

interface SendWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order;
}

export function SendWhatsAppDialog({ open, onOpenChange, order }: SendWhatsAppDialogProps) {
  const { sendMessage, isLoading } = useZapi();
  
  const totalValue = order.products.reduce(
    (sum, p) => sum + p.price * p.quantity,
    0
  );

  const defaultMessage = order.products.length > 0
    ? `Olá! 👋\n\nSeu pedido na Live Cart está confirmado:\n\n${order.products
        .map((p) => `• ${p.quantity}x ${p.title} - R$ ${(p.price * p.quantity).toFixed(2)}`)
        .join("\n")}\n\n💰 Total: R$ ${totalValue.toFixed(2)}\n\nObrigado pela preferência!`
    : `Olá! 👋\n\nObrigado pelo interesse em nossos produtos. Como posso ajudar?`;

  const [message, setMessage] = useState(defaultMessage);

  const handleSend = async () => {
    if (!order.whatsapp) return;
    
    const result = await sendMessage(order.whatsapp, message);
    if (result.success) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-stage-paid" />
            Enviar Mensagem WhatsApp
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Para:</span>
            <span className="font-medium text-foreground">{order.whatsapp}</span>
            <span className="text-xs">({order.instagramHandle})</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Mensagem</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              placeholder="Digite sua mensagem..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            onClick={handleSend} 
            disabled={isLoading || !message.trim()}
            className="bg-stage-paid hover:bg-stage-paid/90"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
