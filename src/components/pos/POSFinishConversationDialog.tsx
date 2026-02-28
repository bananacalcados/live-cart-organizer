import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PhoneOff, Headphones, HelpCircle, ShoppingBag, Send, Circle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinish: (reason: string) => void;
}

interface FinishReason {
  id: string;
  value: string;
  label: string;
  icon: string;
  color: string;
}

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  'headphones': Headphones,
  'help-circle': HelpCircle,
  'shopping-bag': ShoppingBag,
  'send': Send,
  'circle': Circle,
};

export function POSFinishConversationDialog({ open, onOpenChange, onFinish }: Props) {
  const [reasons, setReasons] = useState<FinishReason[]>([]);

  useEffect(() => {
    if (!open) return;
    supabase
      .from('chat_finish_reasons')
      .select('id, value, label, icon, color')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setReasons(data as FinishReason[]);
      });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 justify-center text-base">
            <PhoneOff className="h-4 w-4 text-destructive" />
            Finalizar Conversa
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground text-center">
          Qual foi o motivo do atendimento?
        </p>
        <div className="space-y-2">
          {reasons.map(r => {
            const IconComponent = ICON_MAP[r.icon] || Circle;
            return (
              <button
                key={r.value}
                onClick={() => onFinish(r.value)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${r.color}`}
              >
                <IconComponent className="h-5 w-5" />
                <span className="font-medium text-sm">{r.label}</span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
