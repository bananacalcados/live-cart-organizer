import { LiveCodeSettingsSection } from "./LiveCodeSettingsSection";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, RotateCcw, Radio, X } from "lucide-react";
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
  shopify_ok?: boolean;
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

// Marcador de "excluído da exibição" sem mudar o banco: marcar de novo grava o nome de quem marcou e o item volta.
const HIDDEN = "__excluido__";

export function LiveShownProductsPanel({ eventId, compact = false }: { eventId: string; compact?: boolean }) {
  const [tab, setTab] = useState<"shown" | "hidden">("shown");
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
    // Uma consulta para saber quais códigos marcados seguem ok na Shopify.
    const codes = [...new Set(list.map((r) => r.code))];
    if (codes.length) {
      const { data: st } = await db.from("v_product_color_codes").select("code, shopify_ok").in("code", codes);
      const ok = new Map<string, boolean>((st || []).map((x: any) => [x.code, !!x.shopify_ok]));
      list.forEach((r) => { r.shopify_ok = ok.get(r.code) ?? false; });
    }
    const key = list.map((r) => `${r.id}:${r.shown_at}:${r.is_current}:${r.shopify_ok}`).join("|");
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
        .eq("shopify_ok", true)
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

  const hide = async (r: ShownRow) => {
    setBusy(r.code);
    const { error } = await db.from("live_shown_products").update({ shown_by: HIDDEN, is_current: false }).eq("id", r.id);
    setBusy(null);
    if (error) { toast.error("Não foi possível excluir: " + error.message); return; }
    toast.success(`${r.code} saiu da exibição`);
    load();
  };

  const visible = rows.filter((r) => r.shown_by !== HIDDEN);
  const hidden = rows.filter((r) => r.shown_by === HIDDEN);
  const sorted = [...(tab === "shown" ? visible : hidden)].sort((a, b) => Number(!!b.is_current) - Number(!!a.is_current));

  const tabs = (
    <div className="flex gap-1 shrink-0">
      <Button size="sm" variant={tab === "shown" ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setTab("shown")}>Em exibição ({visible.length})</Button>
      <Button size="sm" variant={tab === "hidden" ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setTab("hidden")}>Excluídos ({hidden.length})</Button>
    </div>
  );

  const searchBox = (
      <div className={cn("relative", compact && "w-72 shrink-0")}>
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, cor ou código (ex.: T001)" className={cn("pl-8", compact && "h-9 text-sm")} />
        {(searching || results.length > 0) && (
          <Card className={cn("absolute z-30 mt-1 max-h-80 overflow-auto p-1", compact ? "w-96" : "w-full")}>
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
  );

  if (compact) {
    return (
      <Card className="p-2 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold shrink-0">Produtos em exibição</span>
          {searchBox}
          {tabs}
        </div>
        {loading ? (
          <div className="flex justify-center p-2"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">{tab === "shown" ? "Nenhum produto em exibição." : "Nenhum produto excluído."}</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sorted.map((r) => (
              <div key={r.id} className={cn("relative w-44 shrink-0 rounded-md border bg-card p-2", r.is_current && "border-primary ring-2 ring-primary/40 bg-primary/5")}>
                {tab === "shown" && (
                  <button aria-label={`Excluir ${r.code}`} disabled={busy === r.code} onClick={() => hide(r)}
                    className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <div className="flex items-center gap-1 pr-4">
                  <span className="text-sm font-extrabold">{r.code}</span>
                  {r.is_current && <Badge className="h-4 px-1 text-[9px]">Agora</Badge>}
                  {!r.shopify_ok && <Badge variant="destructive" className="h-4 px-1 text-[9px]">fora Shopify</Badge>}
                </div>
                <p className="text-xs font-medium truncate" title={r.product_name || ""}>{r.product_name || "—"}</p>
                <p className="text-[11px] text-muted-foreground truncate">{r.color || "—"}</p>
                <p className="text-xs font-semibold">{BRL(r.sale_price)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <LiveCodeSettingsSection eventId={eventId} />
      {searchBox}
      {tabs}

      {loading ? (
        <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center p-6">{tab === "shown" ? "Nenhum produto exibido nesta live ainda." : "Nenhum produto excluído."}</p>
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
                  {hhmm(r.shown_at)} · {r.shown_by === HIDDEN ? "excluído" : r.shown_by || "—"}
                  {r.source === "comment" && <Badge variant="outline" className="ml-2 text-[10px] py-0">detectado pelo comentário</Badge>}
                  {!r.shopify_ok && <Badge variant="destructive" className="ml-2 text-[10px] py-0">não está na Shopify</Badge>}
                </p>
              </div>
              {tab === "shown" && <Button size="sm" variant="ghost" disabled={busy === r.code} onClick={() => hide(r)} className="gap-1 text-muted-foreground"><X className="h-3 w-3" /> Excluir</Button>}
              {r.shopify_ok && <Button size="sm" variant="outline" disabled={busy === r.code} onClick={() => show(r.code)} className="gap-1">
                {busy === r.code ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Mostrar de novo
              </Button>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
