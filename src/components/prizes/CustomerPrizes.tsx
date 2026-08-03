import { useEffect, useState } from "react";
import { Gift, Ticket, Truck, Percent, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

export interface ActivePrize {
  id: string;
  prize_label: string;
  prize_type: string;
  prize_value: number;
  coupon_code: string;
  expires_at: string;
  created_at: string;
  applied_order_id: string | null;
  days_left: number;
}

/** Prêmios ativos (não usados e dentro da validade) da cliente, pelo telefone. */
export function useCustomerPrizes(phone?: string | null, enabled = true) {
  const [prizes, setPrizes] = useState<ActivePrize[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!enabled || digits.length < 8) {
      setPrizes([]);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc("get_customer_active_prizes", {
          p_phone: digits,
        });
        if (error) throw error;
        if (alive) setPrizes((data as any[]) || []);
      } catch (e) {
        console.error("[useCustomerPrizes]", e);
        if (alive) setPrizes([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [phone, enabled]);

  return { prizes, loading };
}

export function prizeIcon(type: string) {
  if (type === "free_shipping") return Truck;
  if (type === "discount_percent") return Percent;
  if (type === "discount_fixed") return Ticket;
  if (type === "product") return Gift;
  return Sparkles;
}

export function prizeExpiryText(daysLeft: number) {
  if (daysLeft <= 0) return "expira hoje";
  if (daysLeft === 1) return "expira em 1 dia";
  return `expira em ${daysLeft} dias`;
}

/** Badges compactas para o card do pedido. */
export function CustomerPrizeBadges({ phone }: { phone?: string | null }) {
  const { prizes } = useCustomerPrizes(phone);
  if (!prizes.length) return null;

  return (
    <>
      {prizes.map((p) => {
        const Icon = prizeIcon(p.prize_type);
        return (
          <Badge
            key={p.id}
            variant="secondary"
            className="text-[10px] bg-accent/20 text-accent border-accent/30"
            title={`${p.prize_label} — cupom ${p.coupon_code} (${prizeExpiryText(p.days_left)})`}
          >
            <Icon className="h-3 w-3 mr-1" />
            🎡 {p.prize_label} · {prizeExpiryText(p.days_left)}
          </Badge>
        );
      })}
    </>
  );
}

/** Lista detalhada para o modal "Ver pedido". */
export function CustomerPrizeList({ phone }: { phone?: string | null }) {
  const { prizes, loading } = useCustomerPrizes(phone);

  if (loading) return <p className="text-sm text-muted-foreground py-1">Carregando prêmios…</p>;
  if (!prizes.length)
    return <p className="text-sm text-muted-foreground py-1">Nenhum prêmio ativo.</p>;

  return (
    <div className="space-y-2">
      {prizes.map((p) => {
        const Icon = prizeIcon(p.prize_type);
        const physical = p.prize_type === "product";
        return (
          <div
            key={p.id}
            className={`flex items-center gap-3 rounded-md p-2 ${
              physical ? "bg-accent/15 border border-accent/40" : "bg-secondary/40"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0 text-accent" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{p.prize_label}</p>
              <p className="text-xs text-muted-foreground">
                {physical ? "Prêmio físico (expedir junto)" : `Cupom ${p.coupon_code}`} ·{" "}
                {prizeExpiryText(p.days_left)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
