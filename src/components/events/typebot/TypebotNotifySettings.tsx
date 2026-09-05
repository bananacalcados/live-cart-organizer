import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageSquare } from 'lucide-react';
import { useLeadFieldDefinitions } from '@/hooks/useLeadFieldDefinitions';

export interface NotifyConfig {
  notify_enabled: boolean;
  notify_wa_number_id: string | null;
  notify_store_id: string | null;
  notify_message: string | null;
}

export const DEFAULT_NOTIFY_MESSAGE =
  'Oi {nome}! 👋 Recebemos seu cadastro para o crediário da Banana Calçados. Em instantes uma vendedora fala com você por aqui.';

interface WaNumber { id: string; label: string; phone_display: string | null; provider: string | null; is_default: boolean }
interface Store { id: string; name: string }

/** Configuração do aviso no WhatsApp do PDV ao captar lead qualificado. */
export function TypebotNotifySettings({ value, onChange }: { value: NotifyConfig; onChange: (patch: Partial<NotifyConfig>) => void }) {
  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const { fields } = useLeadFieldDefinitions({ activeOnly: true });

  useEffect(() => {
    (async () => {
      const [{ data: nums }, { data: st }] = await Promise.all([
        supabase.from('whatsapp_numbers_safe' as any).select('id, label, phone_display, provider, is_default, is_active')
          .eq('is_active', true).in('provider', ['uazapi', 'wasender', 'zapi']).order('is_default', { ascending: false }),
        supabase.from('pos_stores').select('id, name').eq('is_active', true).order('name'),
      ]);
      setNumbers((nums || []) as any);
      setStores((st || []) as any);
    })();
  }, []);

  return (
    <Card className="p-4 space-y-3 border-dashed">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <h4 className="font-bold text-sm">Avisar no WhatsApp do PDV ao captar lead</h4>
        </div>
        <Switch checked={!!value.notify_enabled} onCheckedChange={(v) => onChange({ notify_enabled: v })} />
      </div>
      <p className="text-xs text-muted-foreground">
        Leads qualificados recebem a primeira mensagem pela instância escolhida — isso abre a conversa no chat do PDV
        com a etiqueta "Lead Crediário" e o resumo dos campos captados. Respeita bloqueios, "PARAR" e horário de silêncio.
      </p>
      {value.notify_enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Instância de WhatsApp (PDV)</Label>
              <select
                value={value.notify_wa_number_id || ''}
                onChange={(e) => onChange({ notify_wa_number_id: e.target.value || null })}
                className="w-full text-sm bg-background border rounded px-2 py-2"
              >
                <option value="">— escolha —</option>
                {numbers.map((n) => (
                  <option key={n.id} value={n.id}>{n.label}{n.phone_display ? ` · ${n.phone_display}` : ''} ({n.provider})</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Loja responsável</Label>
              <select
                value={value.notify_store_id || ''}
                onChange={(e) => onChange({ notify_store_id: e.target.value || null })}
                className="w-full text-sm bg-background border rounded px-2 py-2"
              >
                <option value="">— opcional —</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Primeira mensagem enviada ao lead</Label>
            <Textarea
              rows={3}
              value={value.notify_message ?? DEFAULT_NOTIFY_MESSAGE}
              onChange={(e) => onChange({ notify_message: e.target.value })}
            />
            <div className="flex flex-wrap gap-1 mt-1">
              <Badge variant="outline" className="text-[10px] cursor-pointer" onClick={() => onChange({ notify_message: `${value.notify_message ?? DEFAULT_NOTIFY_MESSAGE} {nome}` })}>{'{nome}'}</Badge>
              <Badge variant="outline" className="text-[10px] cursor-pointer" onClick={() => onChange({ notify_message: `${value.notify_message ?? DEFAULT_NOTIFY_MESSAGE} {primeiro_nome}` })}>{'{primeiro_nome}'}</Badge>
              {fields.map((f) => (
                <Badge
                  key={f.id}
                  variant="outline"
                  className="text-[10px] cursor-pointer"
                  onClick={() => onChange({ notify_message: `${value.notify_message ?? DEFAULT_NOTIFY_MESSAGE} {${f.key}}` })}
                >
                  {`{${f.key}}`}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
