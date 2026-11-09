import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { CentralType } from '@/lib/centralApi';
export function CentralLinkButtons({ saleId }: { saleId: string }) {
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  async function generate(type: CentralType) {
    setBusy(true);
    try {
      const { data,error }=await supabase.rpc('create_support_link',{ p_order_ref:saleId,p_request_type:type,p_created_by_kind:'agent' });
      if (error) throw error;
      const link=data as { token?: string };
      if (!link?.token) throw new Error('Link indisponível');
      const text=`Olá! Para solicitar sua ${type==='troca' ? 'troca' : 'devolução'}, acesse: https://checkout.bananacalcados.com.br/central/${type}/${link.token}`;
      setMessage(text);
      try { await navigator.clipboard.writeText(text); toast.success('Mensagem com link copiada.'); }
      catch { toast.info('Selecione e copie a mensagem abaixo.'); }
    } catch { toast.error('Não foi possível gerar o link. Confira sua permissão e o pedido.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2"><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={()=>generate('troca')}><Copy className="mr-2 h-4 w-4"/>Gerar link de troca</Button><Button variant="outline" size="sm" disabled={busy} onClick={()=>generate('devolucao')}><Copy className="mr-2 h-4 w-4"/>Gerar link de devolução</Button></div>{message && <Textarea readOnly aria-label="Mensagem pronta com link" value={message} className="break-all"/>}<p className="text-xs text-muted-foreground">Central em preparação: não envie os links às clientes ainda.</p></div>;
}