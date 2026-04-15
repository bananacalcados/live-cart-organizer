import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Users } from 'lucide-react';

interface Seller {
  id: string;
  name: string;
  linked_user_id: string | null;
}

interface Props {
  storeId: string;
  open: boolean;
  onSellerSelected: (sellerId: string, sellerName: string, linkedUserId: string | null) => void;
  onSkip: () => void;
}

export function POSWhatsAppSellerGate({ storeId, open, onSellerSelected, onSkip }: Props) {
  const [sellers, setSellers] = useState<Seller[]>([]);

  useEffect(() => {
    if (!open || !storeId) return;
    supabase.from('pos_sellers').select('id, name, linked_user_id').eq('store_id', storeId).eq('is_active', true)
      .then(({ data }) => { if (data) setSellers(data as Seller[]); });
  }, [open, storeId]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onSkip(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 justify-center">
            <Users className="h-5 w-5 text-[#00a884]" />
            Quem está atendendo?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground text-center">
          Selecione a vendedora para rastrear o atendimento
        </p>
        <div className="grid grid-cols-2 gap-2">
          {sellers.map(s => (
            <button
              key={s.id}
              onClick={() => onSellerSelected(s.id, s.name, s.linked_user_id)}
              className="p-3 rounded-lg border-2 border-muted hover:border-[#00a884] hover:bg-[#00a884]/5 transition-all text-center"
            >
              <div className="h-9 w-9 mx-auto rounded-full bg-[#00a884]/20 flex items-center justify-center mb-1.5 text-[#00a884] font-bold text-sm">
                {s.name.charAt(0)}
              </div>
              <p className="font-medium text-sm">{s.name}</p>
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={onSkip}>
          Pular (sem vendedor)
        </Button>
      </DialogContent>
    </Dialog>
  );
}
