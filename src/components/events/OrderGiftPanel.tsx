import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { X, Gift, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OrderGiftPanelProps {
  orderId: string;
  customerLabel?: string;
  onClose: () => void;
}

/**
 * Painel "BRINDE" da lateral do chat da Live.
 * Grava em orders.has_gift/gift_description — o trigger `propagate_order_gift_to_pos_sale`
 * replica para a venda do PDV (expedição) mesmo depois do pedido pago/concluído,
 * marcando `gift_after_completion` quando a expedição já estava concluída.
 */
export function OrderGiftPanel({ orderId, customerLabel, onClose }: OrderGiftPanelProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("orders")
        .select("has_gift, gift_description")
        .eq("id", orderId)
        .maybeSingle();
      if (!alive) return;
      setText(data?.has_gift ? (data?.gift_description || "") : "");
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [orderId]);

  const save = async (clear = false) => {
    const value = clear ? "" : text.trim();
    if (!clear && !value) {
      toast.error("Escreva qual é o brinde da cliente.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("orders")
      .update({
        has_gift: !clear,
        gift_description: clear ? null : value,
      })
      .eq("id", orderId);
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar o brinde: " + error.message);
      return;
    }
    if (clear) setText("");
    toast.success(clear ? "Brinde removido do pedido." : "Brinde salvo e enviado para a Expedição.");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-accent" />
          <div>
            <p className="text-sm font-semibold leading-none">Brinde / Prêmio</p>
            {customerLabel && (
              <p className="mt-1 text-xs text-muted-foreground">{customerLabel}</p>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar brinde">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <Label htmlFor="gift-text">O que a cliente ganhou?</Label>
        <Textarea
          id="gift-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex.: Chinelo 37 preto (prêmio da roleta da live)"
          rows={5}
          disabled={loading || saving}
        />
        <p className="text-xs text-muted-foreground">
          Ao salvar, o brinde aparece na aba Expedição do PDV — inclusive se o pedido já estiver
          pago ou já tiver sido concluído (nesse caso ele fica destacado como brinde adicionado
          depois).
        </p>
      </div>

      <div className="space-y-2 border-t border-border/60 p-4">
        <Button className="w-full" onClick={() => save(false)} disabled={loading || saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
          Salvar brinde
        </Button>
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={() => save(true)}
          disabled={loading || saving}
        >
          Remover brinde
        </Button>
      </div>
    </div>
  );
}
