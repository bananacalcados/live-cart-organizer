import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerCpf?: string | null;
  shippingAddress?: any; // jsonb { cep, number, ... } or shopify-style
}

function pickCep(addr: any): string | null {
  if (!addr) return null;
  return addr.cep || addr.zip || addr.postal_code || addr.zipcode || null;
}
function pickNumber(addr: any): string | null {
  if (!addr) return null;
  return addr.number || addr.address_number || addr.address1_number || addr.numero || null;
}

export function ChargebackRiskBadge({ customerName, customerEmail, customerPhone, customerCpf, shippingAddress }: Props) {
  const [risk, setRisk] = useState<{ has_risk: boolean; direct_match: any[]; address_match: any[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const cep = pickCep(shippingAddress);
      const num = pickNumber(shippingAddress);
      if (!customerName && !customerCpf && !customerEmail && !customerPhone && !cep) return;
      const { data, error } = await supabase.rpc('check_chargeback_risk', {
        p_customer_name: customerName || '',
        p_customer_email: customerEmail || null,
        p_customer_phone: customerPhone || null,
        p_customer_cpf: customerCpf || null,
        p_address_cep: cep,
        p_address_number: num,
      });
      if (!cancelled && !error && data) setRisk(data as any);
    };
    check();
    return () => { cancelled = true; };
  }, [customerName, customerEmail, customerPhone, customerCpf, shippingAddress]);

  if (!risk?.has_risk) return null;

  const directCount = risk.direct_match?.length || 0;
  const addressCount = risk.address_match?.length || 0;
  const isDirect = directCount > 0;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="destructive"
            className="text-xs font-bold gap-1 animate-pulse cursor-help"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            {isDirect ? '⚠️ CHARGEBACK' : '⚠️ MESMO ENDEREÇO'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-1 text-xs">
            {isDirect && (
              <p className="font-bold text-destructive">
                🚨 Cliente com {directCount} chargeback{directCount > 1 ? 's' : ''} anterior{directCount > 1 ? 'es' : ''}
              </p>
            )}
            {addressCount > 0 && (
              <p className="font-bold text-amber-600">
                ⚠️ Endereço idêntico a {addressCount} chargeback{addressCount > 1 ? 's' : ''} (nome diferente — possível golpe)
              </p>
            )}
            <p className="text-muted-foreground mt-2">
              Verifique antes de despachar. Veja detalhes na aba Chargebacks.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
