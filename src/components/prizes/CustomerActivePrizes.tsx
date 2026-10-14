import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Trophy } from "lucide-react";

interface Prize { id: string; prize_label: string; prize_type: string; coupon_code: string | null; expires_at: string | null }

const TYPE: Record<string, string> = { discount_percent: "Desconto %", discount_fixed: "Desconto R$", free_shipping: "Frete grátis" };

/** Prêmios de roleta não físicos ainda válidos (desconto/frete) para usar numa próxima compra. */
function useActivePrizes(phone?: string | null) {
  const [list, setList] = useState<Prize[]>([]);
  const suf = String(phone || "").replace(/\D/g, "").slice(-8);
  useEffect(() => {
    if (suf.length < 8) { setList([]); return; }
    let alive = true;
    supabase
      .from("customer_prizes")
      .select("id, prize_label, prize_type, coupon_code, expires_at")
      .ilike("customer_phone", `%${suf}`)
      .in("prize_type", ["discount_percent", "discount_fixed", "free_shipping"])
      .eq("is_redeemed", false)
      .is("applied_order_id", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => { if (alive) setList((data as Prize[]) || []); });
    return () => { alive = false; };
  }, [suf]);
  return list;
}

export function CustomerActivePrizesBox({ phone }: { phone?: string | null }) {
  const list = useActivePrizes(phone);
  if (!list.length) return null;
  return (
    <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs space-y-1">
      <p className="font-semibold text-foreground flex items-center gap-1"><Trophy className="h-3.5 w-3.5" /> Prêmios da roleta (próxima compra)</p>
      {list.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-x-2">
          <span className="font-semibold">{p.prize_label}</span>
          <span className="text-muted-foreground">{TYPE[p.prize_type] || ""}</span>
          {p.coupon_code && <span className="font-mono">{p.coupon_code}</span>}
          {p.expires_at && <span className="text-muted-foreground">até {new Date(p.expires_at).toLocaleDateString("pt-BR")}</span>}
        </div>
      ))}
    </div>
  );
}

export function CustomerActivePrizesBadge({ phone }: { phone?: string | null }) {
  const list = useActivePrizes(phone);
  if (!list.length) return null;
  const title = list.map((p) => `${p.prize_label}${p.coupon_code ? ` (${p.coupon_code})` : ""}${p.expires_at ? ` até ${new Date(p.expires_at).toLocaleDateString("pt-BR")}` : ""}`).join("\n");
  return (
    <Badge variant="secondary" className="text-[10px] px-2 py-0.5 flex-shrink-0 gap-1 max-w-[200px] truncate" title={title}>
      🏆 {list.length === 1 ? list[0].prize_label : `${list.length} prêmios`}
    </Badge>
  );
}
