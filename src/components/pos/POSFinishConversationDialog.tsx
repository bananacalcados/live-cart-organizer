import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PhoneOff, Headphones, HelpCircle, ShoppingBag } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinish: (reason: 'suporte' | 'duvida' | 'compra') => void;
}

const REASONS = [
  { value: 'suporte' as const, label: 'Suporte', icon: Headphones, color: 'text-orange-500 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/20' },
  { value: 'duvida' as const, label: 'Dúvida', icon: HelpCircle, color: 'text-blue-500 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/20' },
  { value: 'compra' as const, label: 'Compra', icon: ShoppingBag, color: 'text-emerald-500 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/20' },
];

export function POSFinishConversationDialog({ open, onOpenChange, onFinish }: Props) {
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
          {REASONS.map(r => (
            <button
              key={r.value}
              onClick={() => onFinish(r.value)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${r.color}`}
            >
              <r.icon className="h-5 w-5" />
              <span className="font-medium text-sm">{r.label}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
