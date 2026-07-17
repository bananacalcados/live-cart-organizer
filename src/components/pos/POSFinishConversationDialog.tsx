import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  PhoneOff, Headphones, HelpCircle, ShoppingBag, Send, Circle,
  ArrowLeft, DollarSign, Check, X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export interface FinishExtras {
  saleValue?: number;
  saleCurrency?: string;
  triggerId?: string | null;
  purchased?: boolean;
  supportReason?: string;
  supportSatisfactory?: boolean;
  duvidaText?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinish: (reason: string, extras?: FinishExtras) => void;
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

type Step =
  | 'reason'
  | 'purchase_outcome'
  | 'sale_value'
  | 'support_details'
  | 'duvida_text';

export function POSFinishConversationDialog({ open, onOpenChange, onFinish }: Props) {
  const [reasons, setReasons] = useState<FinishReason[]>([]);
  const [triggers, setTriggers] = useState<SalesTrigger[]>([]);
  const [step, setStep] = useState<Step>('reason');
  const [saleValue, setSaleValue] = useState('');
  const [triggerId, setTriggerId] = useState<string>('none');
  const [supportReason, setSupportReason] = useState('');
  const [supportSatisfactory, setSupportSatisfactory] = useState<boolean | null>(null);
  const [duvidaText, setDuvidaText] = useState('');

  useEffect(() => {
    if (!open) {
      setStep('reason');
      setSaleValue('');
      setTriggerId('none');
      setSupportReason('');
      setSupportSatisfactory(null);
      setDuvidaText('');
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
      setStep('purchase_outcome');
      return;
    }
    if (value === 'suporte') {
      setStep('support_details');
      return;
    }
    if (value === 'duvida') {
      setStep('duvida_text');
      return;
    }
    onFinish(value);
  };

  const handleConfirmSale = () => {
    const numeric = parseFloat(saleValue.replace(',', '.'));
    onFinish('compra', {
      purchased: true,
      saleValue: isFinite(numeric) && numeric > 0 ? numeric : undefined,
      saleCurrency: 'BRL',
      triggerId: triggerId === 'none' ? null : triggerId,
    });
  };

  const handleNotPurchased = () => {
    onFinish('compra', { purchased: false });
  };

  const handleConfirmSupport = () => {
    if (!supportReason.trim() || supportSatisfactory === null) return;
    onFinish('suporte', {
      supportReason: supportReason.trim(),
      supportSatisfactory,
    });
  };

  const handleConfirmDuvida = () => {
    if (!duvidaText.trim()) return;
    onFinish('duvida', { duvidaText: duvidaText.trim() });
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

        {step === 'purchase_outcome' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 justify-center text-base">
                <ShoppingBag className="h-4 w-4 text-green-600" />
                Compra concluída?
              </DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground text-center">
              A cliente finalizou a compra neste atendimento?
            </p>
            <div className="space-y-2">
              <button
                onClick={() => setStep('sale_value')}
                className="w-full flex items-center gap-3 p-3 rounded-lg border-2 border-green-500/40 bg-green-500/10 hover:bg-green-500/20 transition-all"
              >
                <Check className="h-5 w-5 text-green-600" />
                <span className="font-medium text-sm">Sim, comprou</span>
              </button>
              <button
                onClick={handleNotPurchased}
                className="w-full flex items-center gap-3 p-3 rounded-lg border-2 border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 transition-all"
              >
                <X className="h-5 w-5 text-orange-600" />
                <span className="font-medium text-sm">Não comprou</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => setStep('reason')}
              className="w-full text-xs text-muted-foreground hover:text-foreground underline pt-1"
            >
              <ArrowLeft className="inline h-3 w-3 mr-1" /> Voltar
            </button>
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
                  onClick={() => setStep('purchase_outcome')}
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
                onClick={() => onFinish('compra', { purchased: true })}
                className="w-full text-xs text-muted-foreground hover:text-foreground underline"
              >
                Pular (finalizar sem registrar valor)
              </button>
            </div>
          </>
        )}

        {step === 'support_details' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 justify-center text-base">
                <Headphones className="h-4 w-4 text-primary" />
                Detalhes do Suporte
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="support-reason" className="text-xs">Motivo do suporte</Label>
                <Textarea
                  id="support-reason"
                  placeholder="Ex: cliente teve dificuldade no rastreio..."
                  value={supportReason}
                  onChange={(e) => setSupportReason(e.target.value)}
                  rows={3}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Foi realizado de forma satisfatória?</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSupportSatisfactory(true)}
                    className={`flex items-center justify-center gap-1 p-2 rounded-md border-2 text-sm transition-all ${
                      supportSatisfactory === true
                        ? 'border-green-500 bg-green-500/10 text-green-700'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <Check className="h-4 w-4" /> Sim
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupportSatisfactory(false)}
                    className={`flex items-center justify-center gap-1 p-2 rounded-md border-2 text-sm transition-all ${
                      supportSatisfactory === false
                        ? 'border-red-500 bg-red-500/10 text-red-700'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <X className="h-4 w-4" /> Não
                  </button>
                </div>
              </div>
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
                  onClick={handleConfirmSupport}
                  disabled={!supportReason.trim() || supportSatisfactory === null}
                >
                  Confirmar
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 'duvida_text' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 justify-center text-base">
                <HelpCircle className="h-4 w-4 text-primary" />
                Dúvida da cliente
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="duvida-text" className="text-xs">Qual foi a dúvida?</Label>
                <Textarea
                  id="duvida-text"
                  placeholder="Descreva a dúvida da cliente..."
                  value={duvidaText}
                  onChange={(e) => setDuvidaText(e.target.value)}
                  rows={4}
                  autoFocus
                />
              </div>
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
                  onClick={handleConfirmDuvida}
                  disabled={!duvidaText.trim()}
                >
                  Confirmar
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
