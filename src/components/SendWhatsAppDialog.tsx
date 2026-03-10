import { useState, useEffect } from "react";
import { MessageCircle, Send, Loader2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
import { WhatsAppNumberSelector } from "./WhatsAppNumberSelector";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { useTemplateStore, applyTemplateVariables } from "@/stores/templateStore";

interface SendWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order;
}

export function SendWhatsAppDialog({ open, onOpenChange, order }: SendWhatsAppDialogProps) {
  const { sendMessage, isLoading } = useZapi();
  const { fetchNumbers, selectedNumberId } = useWhatsAppNumberStore();
  const { getTemplatesByStage, fetchTemplates, templates } = useTemplateStore();

  useEffect(() => {
    if (open) {
      fetchNumbers();
      if (templates.length === 0) fetchTemplates();
    }
  }, [open, fetchNumbers, fetchTemplates, templates.length]);

  const totalValue = order.products.reduce(
    (sum, p) => sum + p.price * p.quantity,
    0
  );

  const buildDefaultMessage = () => {
    // Try to use a saved template for this stage
    const stageTemplates = getTemplatesByStage(order.stage);
    if (stageTemplates.length > 0) {
      const firstName = order.instagramHandle?.replace('@', '') || '';
      const productsList = order.products.map(p => `${p.quantity}x ${p.title}`).join(', ');
      return applyTemplateVariables(stageTemplates[0].message, {
        nome: firstName,
        instagram: order.instagramHandle ? `@${order.instagramHandle.replace('@', '')}` : '',
        whatsapp: order.whatsapp || '',
        total: `R$ ${totalValue.toFixed(2)}`,
        produtos: productsList,
      });
    }

    // Fallback to hardcoded message
    return order.products.length > 0
      ? `Olá! 👋\n\nSeu pedido na Live Cart está confirmado:\n\n${order.products
          .map((p) => `• ${p.quantity}x ${p.title} - R$ ${(p.price * p.quantity).toFixed(2)}`)
          .join("\n")}\n\n💰 Total: R$ ${totalValue.toFixed(2)}\n\nObrigado pela preferência!`
      : `Olá! 👋\n\nObrigado pelo interesse em nossos produtos. Como posso ajudar?`;
  };

  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) {
      setMessage(buildDefaultMessage());
    }
  }, [open, templates]);

  const handleSend = async () => {
    if (!order.whatsapp) return;
    
    const phone = order.whatsapp.replace(/\D/g, "");
    const result = await sendMessage(phone, message, selectedNumberId || undefined);
    if (result.success) {
      // Persist message to whatsapp_messages so it appears in the chat
      await supabase.from('whatsapp_messages').insert({
        phone,
        message,
        direction: 'outgoing',
        status: 'sent',
        whatsapp_number_id: selectedNumberId || null,
      });
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

          <WhatsAppNumberSelector className="h-9 text-xs" />

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

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => {
              const phone = order.whatsapp?.replace(/\D/g, "") || "";
              window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
            }}
            disabled={!order.whatsapp || !message.trim()}
            className="gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            WhatsApp Web
          </Button>
          <div className="flex gap-2 ml-auto">
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
              Enviar via Z-API
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
