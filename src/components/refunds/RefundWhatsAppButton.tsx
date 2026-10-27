import { useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { POSTaskWhatsAppDialog } from "@/components/pos/POSTaskWhatsAppDialog";
import type { RefundListRow } from "@/lib/refunds";

/** Abre o mesmo WhatsApp do PDV na conversa da cliente do estorno. Telefone buscado só no clique. */
export function RefundWhatsAppButton({ r, storeId }: { r: RefundListRow; storeId?: string }) {
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<{ phone: string; storeId: string } | null>(null);

  const open = async () => {
    setLoading(true);
    try {
      let phone: string | null = null;
      let store: string | null = storeId || null;
      if (r.source === "pos_sale") {
        const { data } = await supabase.from("pos_sales").select("customer_phone, store_id").eq("id", r.source_id).maybeSingle();
        phone = (data as any)?.customer_phone || null;
        store = (data as any)?.store_id || store;
      } else {
        const { data } = await supabase.from("orders").select("customer:customers(whatsapp)").eq("id", r.source_id).maybeSingle();
        phone = (data as any)?.customer?.whatsapp || null;
      }
      if (!phone) return toast.error("Essa venda não tem WhatsApp cadastrado.");
      if (!store) return toast.error("Não achei a loja dessa venda.");
      setTarget({ phone: phone.replace(/\D/g, ""), storeId: store });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={open} disabled={loading}>
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageCircle className="h-3 w-3" />}
        WhatsApp
      </Button>
      {target && (
        <POSTaskWhatsAppDialog
          open={!!target}
          onOpenChange={(v) => !v && setTarget(null)}
          storeId={target.storeId}
          customerPhone={target.phone}
        />
      )}
    </>
  );
}
