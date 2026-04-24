import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PhoneOff, Headphones, HelpCircle, ShoppingBag, Send, Circle, ArrowLeft, DollarSign } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinish: (
    reason: string,
    extras?: { saleValue?: number; saleCurrency?: string; triggerId?: string | null }
  ) => void;
}

interface FinishReason {
  id: string;
  value: string;
  label: string;
  icon: string;
  color: string;
}

interface SalesTrigger {
  id: string;
  name: string;
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
  const [triggers, setTriggers] = useState<SalesTrigger[]>([]);
  const [step, setStep] = useState<'reason' | 'sale_value'>('reason');
  const [saleValue, setSaleValue] = useState('');
  const [triggerId, setTriggerId] = useState<string>('none');

  useEffect(() => {
    if (!open) {
      setStep('reason');
      setSaleValue('');
      setTriggerId('none');
      return;
    }
    supabase
      .from('chat_finish_reasons')
      .select('id, value, label, icon, color')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setReasons(data as FinishReason[]);
      });

    supabase
      .from('sales_triggers' as any)
      .select('id, name, color')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setTriggers(data as unknown as SalesTrigger[]);
      });
  }, [open]);

  const handleReason = (value: string) => {
    if (value === 'compra') {
      setStep('sale_value');
      return;
    }
    onFinish(value);
  };

  const handleConfirmSale = () => {
    const numeric = parseFloat(saleValue.replace(',', '.'));
    onFinish('compra', {
      saleValue: isFinite(numeric) && numeric > 0 ? numeric : undefined,
      saleCurrency: 'BRL',
      triggerId: triggerId === 'none' ? null : triggerId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        {step === 'reason' && (
          <>
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
                    onClick={() => handleReason(r.value)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${r.color}`}
                  >
                    <IconComponent className="h-5 w-5" />
                    <span className="font-medium text-sm">{r.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === 'sale_value' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 justify-center text-base">
                <DollarSign className="h-4 w-4 text-green-600" />
                Registrar Venda
              </DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground text-center">
              Informe o valor da venda concluída para tracking de conversão.
            </p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="sale-value" className="text-xs">Valor da venda (R$)</Label>
                <Input
                  id="sale-value"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex: 199,90"
                  value={saleValue}
                  onChange={(e) => setSaleValue(e.target.value.replace(/[^0-9.,]/g, ''))}
                  autoFocus
                />
              </div>

              {triggers.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Trigger atribuído (opcional)</Label>
                  <Select value={triggerId} onValueChange={setTriggerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sem trigger" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem trigger</SelectItem>
                      {triggers.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ background: t.color }}
                            />
                            {t.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setStep('reason')}
                >
                  <ArrowLeft className="h-3 w-3 mr-1" /> Voltar
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleConfirmSale}
                  disabled={!saleValue || parseFloat(saleValue.replace(',', '.')) <= 0}
                >
                  Confirmar
                </Button>
              </div>
              <button
                type="button"
                onClick={() => onFinish('compra')}
                className="w-full text-xs text-muted-foreground hover:text-foreground underline"
              >
                Pular (finalizar sem registrar valor)
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
