import { useEffect, useState } from "react";
import { fetchGroupSendRoutes, groupRoutingSummary, type GroupRoute } from "@/lib/marketing/groupSendRouting";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { toast } from "sonner";

const EMPTY: Record<string, string> = {};
export function GroupSendRoutingPanel({ groupIds, fallback, overrides = EMPTY, onChange }: {
  groupIds: string[]; fallback: string | null; overrides?: Record<string, string>; onChange?: (value: Record<string, string>) => void;
}) {
  const [routes, setRoutes] = useState<GroupRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const numbers = useWhatsAppNumberStore(s => s.numbers);
  const idsKey = groupIds.join(",");
  const overrideKey = JSON.stringify(overrides);
  useEffect(() => {
    let active = true;
    if (!idsKey) { setRoutes([]); return; }
    setLoading(true); setFailed(false);
    fetchGroupSendRoutes(idsKey.split(","), fallback, JSON.parse(overrideKey)).then(next => {
      if (active) setRoutes(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    }).catch(() => { if (active) { setFailed(true); toast.error("Não foi possível conferir as instâncias dos grupos"); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [idsKey, fallback, overrideKey]);
  return <section className="space-y-2 border-t border-border pt-3">
    <p className="text-xs font-medium">{loading ? "Conferindo instâncias…" : failed ? "Instâncias não conferidas" : groupRoutingSummary(routes, overrides)}</p>
    <div className="max-h-48 overflow-y-auto space-y-2">
      {routes.map(route => <div key={route.base} className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="min-w-0 flex-1"><p className="break-words">{route.name}</p><span className="text-muted-foreground">Responsável: {route.responsible_label || "sem responsável"}</span>{!route.online && <Badge variant="destructive" className="ml-2">aguardando conexão</Badge>}</div>
        {onChange ? <Select value={overrides[route.base] || "__auto__"} onValueChange={value => {
          const next = { ...overrides }; if (value === "__auto__") delete next[route.base]; else next[route.base] = value; onChange(next);
        }}><SelectTrigger aria-label={`Instância neste envio: ${route.name}`} className="w-56 h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="__auto__">Responsável (padrão)</SelectItem>
          {numbers.filter(n => n.is_active && ["uazapi", "wasender", "zapi"].includes(n.provider || "")).map(n => <SelectItem key={n.id} value={n.id}>{n.label} · só neste envio</SelectItem>)}
        </SelectContent></Select> : <Badge variant="outline">{route.label || "sem instância"}</Badge>}
      </div>)}
    </div>
  </section>;
}