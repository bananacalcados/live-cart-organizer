import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Faixa somente leitura: "Veio do grupo X" (Link de Atendimento VIP, últimos 7 dias). */
function phoneKey(p: string): string | null {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  return d.slice(0, 2) + d.slice(-8);
}

export function VipOriginBanner({ phone }: { phone: string }) {
  const [row, setRow] = useState<any>(null);
  useEffect(() => {
    setRow(null);
    const key = phoneKey(phone || "");
    if (!key) return;
    let cancelled = false;
    supabase.from("vip_link_conversations")
      .select("group_name, product_title, product")
      .eq("phone_key", key)
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => { if (!cancelled) setRow(data?.[0] || null); });
    return () => { cancelled = true; };
  }, [phone]);

  if (!row) return null;
  const img = row.product?.image_url;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/50 text-xs">
      {img && <img src={img} alt="" className="h-7 w-7 rounded object-cover" />}
      <span>Veio do grupo <b>{row.group_name || "VIP"}</b>{row.product_title ? <> · {row.product_title}</> : null}</span>
    </div>
  );
}
