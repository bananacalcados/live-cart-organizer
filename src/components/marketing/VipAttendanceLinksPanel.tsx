import { useEffect, useState } from "react";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

interface GroupRow { gid: string; group_name: string | null; links: number; clicks: number; convs: number }
interface ProductRow { product_title: string; clicks: number; convs: number }

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");

export function VipAttendanceLinksPanel() {
  const [from, setFrom] = useState(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [today, setToday] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const day = format(new Date(), "yyyy-MM-dd");
      const { data } = await supabase.from("vip_link_daily_destination").select("whatsapp_number_id").eq("day", day).maybeSingle();
      if (!data?.whatsapp_number_id) { setToday(null); return; }
      const { data: n } = await supabase.from("whatsapp_numbers_safe").select("label, provider").eq("id", data.whatsapp_number_id).maybeSingle();
      setToday(n ? `${n.label} (${n.provider})` : data.whatsapp_number_id);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const end = new Date(`${to}T00:00:00-03:00`); end.setDate(end.getDate() + 1);
      const { data } = await supabase.rpc("vip_link_stats", {
        p_from: new Date(`${from}T00:00:00-03:00`).toISOString(), p_to: end.toISOString(),
      });
      const d = (data || {}) as any;
      setGroups(d.groups || []);
      setProducts(d.products || []);
      setLoading(false);
    })();
  }, [from, to]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>De</span><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 h-8" />
        <span>até</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 h-8" />
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        <span className="ml-auto text-muted-foreground">Instância de hoje: <b className="text-foreground">{today || "não definida"}</b></span>
      </div>
      <Card><CardContent className="p-3 overflow-x-auto">
        <h3 className="font-semibold text-sm mb-2">Por grupo</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground"><th>Grupo</th><th className="text-right">Mensagens c/ link</th><th className="text-right">Cliques</th><th className="text-right">Conversas</th><th className="text-right">Conversa/clique</th></tr></thead>
          <tbody>
            {groups.length === 0 && <tr><td colSpan={5} className="py-3 text-muted-foreground">Sem dados no período.</td></tr>}
            {groups.map((g) => (
              <tr key={g.gid} className="border-t border-border">
                <td className="py-1">{g.group_name || "—"}</td><td className="text-right">{g.links}</td>
                <td className="text-right">{g.clicks}</td><td className="text-right">{g.convs}</td><td className="text-right">{pct(g.convs, g.clicks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
      <Card><CardContent className="p-3 overflow-x-auto">
        <h3 className="font-semibold text-sm mb-2">Por produto</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground"><th>Produto</th><th className="text-right">Cliques</th><th className="text-right">Conversas</th></tr></thead>
          <tbody>
            {products.length === 0 && <tr><td colSpan={3} className="py-3 text-muted-foreground">Sem dados no período.</td></tr>}
            {products.map((p) => (
              <tr key={p.product_title} className="border-t border-border">
                <td className="py-1">{p.product_title}</td><td className="text-right">{p.clicks}</td><td className="text-right">{p.convs}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-muted-foreground mt-2">Cliques sem robôs de prévia. Conversas contam pessoas distintas.</p>
      </CardContent></Card>
    </div>
  );
}
