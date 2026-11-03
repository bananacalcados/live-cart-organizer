import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, RotateCcw, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ShownRow {
  id: string;
  code: string;
  shown_at: string;
  shown_by: string | null;
  source: string | null;
  is_current: boolean | null;
  product_name: string | null;
  color: string | null;
  sale_price: number | null;
}
interface CodeRow { code: string; product_name: string | null; color: string | null; sale_price: number | null }

const BRL = (v: number | null) => (v == null ? "—" : `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const db = supabase as any;

async function currentUserName(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  return (u?.user_metadata?.full_name || u?.user_metadata?.name || u?.email || "Equipe") as string;
}

export function LiveShownProductsPanel({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<ShownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CodeRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const lastKey = useRef("");

  const load = useCallback(async () => {
    const { data } = await db.from("v_live_shown_products")
      .select("id, code, shown_at, shown_by, source, is_current, product_name, color, sale_price")
      .eq("event_id", eventId).order("shown_at", { ascending: false }).limit(200);
    const list = (data || []) as ShownRow[];
    const key = list.map((r) => `${r.id}:${r.shown_at}:${r.is_current}`).join("|");
    if (key !== lastKey.current) { lastKey.current = key; setRows(list); }
    setLoading(false);
  }, [eventId]);

  // Tempo real: INSERT/UPDATE em live_shown_products desta live disparam load();
  // recarregamento de segurança a cada 60 s cobre qualquer evento perdido.
  useEffect(() => {
    load();
    const channel = supabase
      .channel(`live-shown-${eventId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_shown_products", filter: `event_id=eq.${eventId}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "live_shown_products", filter: `event_id=eq.${eventId}` },
        () => load(),
      )
      .subscribe();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => { clearInterval(t); supabase.removeChannel(channel); };
  }, [load]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const h = setTimeout(async () => {
      setSearching(true);
      const s = term.replace(/[%,()]/g, " ");
      const { data } = await db.from("v_product_color_codes")
        .select("code, product_name, color, sale_price")
        .or(`code.ilike.${s}%,product_name.ilike.%${s}%,color.ilike.%${s}%`)
        .order("code").limit(20);
      setResults((data || []) as CodeRow[]);
      setSearching(false);
    }, 300);
    return () => clearTimeout(h);
  }, [q]);

  const show = async (code: string) => {
    setBusy(code);
    const { error } = await db.rpc("set_live_shown_product", {
      p_event_id: eventId, p_code: code, p_shown_by: await currentUserName(), p_source: "manual",
    });
    setBusy(null);
    if (error) { toast.error("Não foi possível marcar: " + error.message); return; }
    toast.success(`${code} em exibição`);
    setQ(""); setResults([]);
    load();
  };

  const sorted = [...rows].sort((a, b) => Number(!!b.is_current) - Number(!!a.is_current));

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, cor ou código (ex.: T001)" className="pl-8" />
        {(searching || results.length > 0) && (
          <Card className="absolute z-20 mt-1 w-full max-h-80 overflow-auto p-1">
            {searching && <div className="p-2 text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Buscando…</div>}
            {results.map((r) => (
              <button key={r.code} disabled={!!busy} onClick={() => show(r.code)}
                className="w-full flex items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-muted">
                <span className="text-lg font-extrabold w-16">{r.code}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm">{r.product_name}</span>
                  <span className="block text-xs text-muted-foreground">{r.color || "—"}</span>
                </span>
                <span className="text-sm font-semibold">{BRL(r.sale_price)}</span>
              </button>
            ))}
          </Card>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center p-6">Nenhum produto exibido nesta live ainda.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((r) => (
            <Card key={r.id} className={cn("p-3 flex items-center gap-3", r.is_current && "border-primary ring-2 ring-primary/40 bg-primary/5")}>
              <div className="w-20 shrink-0">
                <div className="text-2xl font-extrabold leading-none">{r.code}</div>
                {r.is_current && <Badge className="mt-1 gap-1 text-[10px]"><Radio className="h-3 w-3" /> Agora</Badge>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.product_name || "—"}</p>
                <p className="text-xs text-muted-foreground">{r.color || "—"} · {BRL(r.sale_price)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {hhmm(r.shown_at)} · {r.shown_by || "—"}
                  {r.source === "comment" && <Badge variant="outline" className="ml-2 text-[10px] py-0">detectado pelo comentário</Badge>}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={busy === r.code} onClick={() => show(r.code)} className="gap-1">
                {busy === r.code ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Mostrar de novo
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
