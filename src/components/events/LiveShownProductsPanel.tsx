import { LiveCodeSettingsSection } from "./LiveCodeSettingsSection";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, Radio, Play, Square, Pencil, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { printProductCodeLabels } from "@/lib/productCodeLabels";
import { buildCodeImageMap, type MirrorImageRow } from "@/lib/productCodeImages";

interface PreparedRow {
  id: string;
  code: string;
  offer_price: number | null;
  free_shipping: boolean;
  interest_free_installments: number | null;
  created_at: string;
}
interface ShownRow {
  id: string;
  code: string;
  shown_at: string;
  shown_by: string | null;
  source: string | null;
  is_current: boolean | null;
  stopped_at: string | null;
  product_name: string | null;
  color: string | null;
  sale_price: number | null;
  shopify_ok?: boolean;
}
interface CodeRow {
  code: string;
  product_name: string | null;
  color: string | null;
  sale_price: number | null;
  shopify_ok?: boolean;
  shopify_product_id?: string | null;
  image?: string | null;
}
interface BoardRow extends CodeRow {
  id: string;
  preparedId: string | null;
  preparedAt: string | null;
  offer_price: number | null;
  free_shipping: boolean;
  interest_free_installments: number | null;
  shown_at: string | null;
  shown_by: string | null;
  source: string | null;
  is_current: boolean;
}

const BRL = (value: number | null) => value == null
  ? "—"
  : `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hhmm = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  : "Ainda não apresentado";
const db = supabase as any;
const HIDDEN = "__excluido__";

async function currentUserName(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  return (u?.user_metadata?.full_name || u?.user_metadata?.name || u?.email || "Equipe") as string;
}

export function LiveShownProductsPanel({ eventId, compact = false }: { eventId: string; compact?: boolean }) {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CodeRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<BoardRow | null>(null);
  const [offerPrice, setOfferPrice] = useState("");
  const [freeShipping, setFreeShipping] = useState(false);
  const [installments, setInstallments] = useState("default");
  const [savingOffer, setSavingOffer] = useState(false);
  const lastKey = useRef("");
  const imageCache = useRef(new Map<string, string | null>());

  const load = useCallback(async () => {
    const [preparedRes, shownRes] = await Promise.all([
      db.from("live_presenter_products")
        .select("id,code,offer_price,free_shipping,interest_free_installments,created_at")
        .eq("event_id", eventId).order("created_at").limit(200),
      db.from("v_live_shown_products")
        .select("id,code,shown_at,shown_by,source,is_current,stopped_at,product_name,color,sale_price,shopify_ok")
        .eq("event_id", eventId).order("shown_at", { ascending: false }).limit(200),
    ]);
    if (preparedRes.error || shownRes.error) {
      setLoading(false);
      return;
    }
    const prepared = (preparedRes.data || []) as PreparedRow[];
    const shown = (shownRes.data || []) as ShownRow[];
    const codes = [...new Set([...prepared.map((r) => r.code), ...shown.map((r) => r.code)])];
    let products: CodeRow[] = [];
    if (codes.length) {
      const { data } = await db.from("v_product_color_codes")
        .select("code,product_name,color,sale_price,shopify_ok,shopify_product_id").in("code", codes);
      products = (data || []) as CodeRow[];
      // Fotos: só busca códigos ainda não conhecidos (cache), uma consulta em lote.
      const missing = products.filter((r) => !imageCache.current.has(r.code));
      const ids = [...new Set(missing.map((r) => r.shopify_product_id).filter(Boolean))] as string[];
      if (missing.length) {
        const { data: mirror } = ids.length
          ? await db.from("shopify_variant_mirror").select("shopify_product_id,option_color,image_url")
            .in("shopify_product_id", ids).neq("image_url", "").limit(600)
          : { data: [] };
        const imgs = buildCodeImageMap(missing, (mirror || []) as MirrorImageRow[]);
        missing.forEach((r) => imageCache.current.set(r.code, imgs.get(r.code) || null));
      }
    }
    const productMap = new Map(products.map((r) => [r.code, r]));
    const shownMap = new Map(shown.map((r) => [r.code, r]));
    const preparedCodes = new Set(prepared.map((r) => r.code));
    const merged: BoardRow[] = prepared.map((p) => {
      const s = shownMap.get(p.code);
      const product = productMap.get(p.code) || s;
      return {
        id: p.id,
        preparedId: p.id,
        preparedAt: p.created_at,
        code: p.code,
        product_name: product?.product_name || null,
        color: product?.color || null,
        sale_price: product?.sale_price ?? null,
        shopify_ok: product?.shopify_ok ?? s?.shopify_ok ?? false,
        offer_price: p.offer_price,
        free_shipping: !!p.free_shipping,
        interest_free_installments: p.interest_free_installments,
        shown_at: s?.shown_at || null,
        shown_by: s?.shown_by || null,
        source: s?.source || null,
        is_current: !!s?.is_current && !s?.stopped_at,
      };
    });
    shown.filter((s) => !preparedCodes.has(s.code) && s.shown_by !== HIDDEN).forEach((s) => {
      const product = productMap.get(s.code) || s;
      merged.push({
        id: s.id,
        preparedId: null,
        preparedAt: null,
        code: s.code,
        product_name: product.product_name,
        color: product.color,
        sale_price: product.sale_price,
        shopify_ok: product.shopify_ok ?? s.shopify_ok ?? false,
        offer_price: null,
        free_shipping: false,
        interest_free_installments: null,
        shown_at: s.shown_at,
        shown_by: s.shown_by,
        source: s.source,
        is_current: !!s.is_current && !s.stopped_at,
      });
    });
    merged.sort((a, b) => Number(b.is_current) - Number(a.is_current)
      || Number(!!b.preparedId) - Number(!!a.preparedId)
      || (a.preparedAt || a.shown_at || "").localeCompare(b.preparedAt || b.shown_at || ""));
    const key = merged.map((r) => [r.id, r.is_current, r.offer_price, r.free_shipping,
      r.interest_free_installments, r.shown_at, r.shopify_ok, imageCache.current.get(r.code) || ""].join(":")).join("|");
    merged.forEach((r) => { r.image = imageCache.current.get(r.code) || null; });
    if (key !== lastKey.current) { lastKey.current = key; setRows(merged); }
    setLoading(false);
  }, [eventId]);

  // Duas consultas em paralelo + uma em lote para os dados dos códigos; sem consulta por produto.
  useEffect(() => {
    load();
    const channel = supabase
      .channel(`live-shown-${eventId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_shown_products", filter: `event_id=eq.${eventId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "live_presenter_products", filter: `event_id=eq.${eventId}` }, () => load())
      .subscribe();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => { clearInterval(timer); supabase.removeChannel(channel); };
  }, [load]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const timeout = setTimeout(async () => {
      setSearching(true);
      const { data } = await db.rpc("search_product_code_keys", { p_query: term, p_limit: 20 });
      const codes = ((data || []) as any[]).map((r) => typeof r === "string" ? r : r.search_product_code_keys).filter(Boolean);
      const { data: products } = codes.length
        ? await db.from("v_product_color_codes").select("code,product_name,color,sale_price,shopify_ok,shopify_product_id")
          .in("code", codes).eq("shopify_ok", true).order("code").limit(20)
        : { data: [] };
      const found = (products || []) as CodeRow[];
      // Uma única consulta em lote para as fotos dos códigos encontrados (máx. 20).
      const productIds = [...new Set(found.map((r) => r.shopify_product_id).filter(Boolean))] as string[];
      const { data: mirror } = productIds.length
        ? await db.from("shopify_variant_mirror")
          .select("shopify_product_id,option_color,image_url")
          .in("shopify_product_id", productIds).neq("image_url", "").limit(600)
        : { data: [] };
      const images = buildCodeImageMap(found, (mirror || []) as MirrorImageRow[]);
      setResults(found.map((r) => ({ ...r, image: images.get(r.code) || null })));
      setSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [q]);

  const add = async (code: string) => {
    setBusy(`add:${code}`);
    const { error } = await db.from("live_presenter_products")
      .upsert({ event_id: eventId, code }, { onConflict: "event_id,code", ignoreDuplicates: true });
    setBusy(null);
    if (error) { toast.error("Não foi possível preparar: " + error.message); return; }
    toast.success(`${code} pronto para apresentar`);
    setQ(""); setResults([]);
    load();
  };

  const show = async (row: BoardRow) => {
    if (!row.shopify_ok) return;
    setBusy(row.code);
    if (!row.preparedId) {
      const { error } = await db.from("live_presenter_products")
        .upsert({ event_id: eventId, code: row.code }, { onConflict: "event_id,code", ignoreDuplicates: true });
      if (error) { setBusy(null); toast.error("Não foi possível preparar: " + error.message); return; }
    }
    const { error } = await db.rpc("set_live_shown_product", {
      p_event_id: eventId, p_code: row.code, p_shown_by: await currentUserName(), p_source: "manual",
    });
    setBusy(null);
    if (error) { toast.error("Não foi possível apresentar: " + error.message); return; }
    toast.success(`${row.code} no overlay`);
    load();
  };

  const stop = async (row: BoardRow) => {
    setBusy(row.code);
    const { error } = await db.rpc("stop_live_shown_product", { p_event_id: eventId });
    setBusy(null);
    if (error) { toast.error("Não foi possível parar: " + error.message); return; }
    toast.success(`${row.code} saiu do overlay e continua na lista`);
    load();
  };

  const openOffer = (row: BoardRow) => {
    setEditing(row);
    setOfferPrice(row.offer_price == null ? "" : String(row.offer_price).replace(".", ","));
    setFreeShipping(row.free_shipping);
    setInstallments(row.interest_free_installments ? String(row.interest_free_installments) : "default");
  };

  const saveOffer = async () => {
    if (!editing) return;
    const parsed = offerPrice.trim() ? Number(offerPrice.replace(/\./g, "").replace(",", ".")) : null;
    if (parsed != null && (!Number.isFinite(parsed) || parsed <= 0)) {
      toast.error("Informe um preço de oferta válido"); return;
    }
    if (parsed != null && editing.sale_price != null && parsed >= Number(editing.sale_price)) {
      toast.error("A oferta precisa ser menor que o preço cheio"); return;
    }
    setSavingOffer(true);
    const payload = {
      offer_price: parsed,
      free_shipping: freeShipping,
      interest_free_installments: installments === "default" ? null : Number(installments),
      updated_at: new Date().toISOString(),
    };
    const response = editing.preparedId
      ? await db.from("live_presenter_products").update(payload).eq("id", editing.preparedId)
      : await db.from("live_presenter_products").insert({ event_id: eventId, code: editing.code, ...payload });
    setSavingOffer(false);
    if (response.error) { toast.error("Não foi possível salvar: " + response.error.message); return; }
    toast.success(`Condições de ${editing.code} salvas`);
    setEditing(null);
    load();
  };

  const printable = rows.filter((r) => r.preparedId && r.shopify_ok);
  const print = () => {
    try {
      printProductCodeLabels(printable.map((r) => ({
        code: r.code, product_name: r.product_name, color: r.color,
        sale_price: r.sale_price, offer_price: r.offer_price,
      })));
    } catch (error: any) { toast.error(error?.message || "Nenhum código para imprimir"); }
  };

  const searchBox = (
    <div className={cn("relative", compact && "w-72 shrink-0")}>
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Adicionar por nome, cor ou código" className={cn("pl-8", compact && "h-9 text-sm")} />
      {(searching || results.length > 0) && (
        <Card className={cn("absolute z-30 mt-1 max-h-80 overflow-auto p-1", compact ? "w-96" : "w-full")}>
          {searching && <div className="flex items-center gap-1 p-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Buscando…</div>}
          {results.map((r) => {
            const already = rows.some((x) => x.code === r.code && x.preparedId);
            return (
              <button key={r.code} disabled={!!busy || already} onClick={() => add(r.code)}
                className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50">
                <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded bg-muted" aria-hidden>
                  {r.image && <img src={r.image} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </span>
                <span className="w-14 shrink-0 text-lg font-extrabold">{r.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{r.product_name}</span>
                  <span className="mt-0.5 inline-block max-w-full truncate rounded bg-accent px-1.5 text-xs font-bold uppercase text-accent-foreground">{r.color || "sem cor"}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-sm font-semibold">{already ? "Na lista" : BRL(r.sale_price)}</span>
              </button>
            );
          })}
        </Card>
      )}
    </div>
  );

  return (
    <>
      {!compact && <LiveCodeSettingsSection eventId={eventId} />}
      <Card className={cn("space-y-3", compact ? "mt-2 p-2" : "mt-3 p-3")}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="shrink-0">
            <span className="text-xs font-semibold">Produtos preparados ({rows.filter((r) => r.preparedId).length})</span>
            {!compact && <p className="text-xs text-muted-foreground">Adicione antes da live e clique em Apresentar quando chegar a vez.</p>}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {searchBox}
            {!compact && <Button size="sm" variant="outline" disabled={!printable.length} onClick={print} className="gap-1"><Printer className="h-4 w-4" /> Imprimir etiquetas</Button>}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Busque os modelos acima para deixar a apresentação pronta.</p>
        ) : (
          <div className={cn(compact ? "flex gap-2 overflow-x-auto pb-1" : "grid gap-2 sm:grid-cols-2 xl:grid-cols-3")}>
            {rows.map((r) => {
              const hasOffer = r.offer_price != null && r.sale_price != null && r.offer_price < r.sale_price;
              return (
                <Card key={r.id} className={cn("p-2", compact && "w-64 shrink-0", r.is_current && "border-primary bg-primary/5 ring-2 ring-primary/40")}>
                  <div className="flex items-start gap-2">
                    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded bg-muted" aria-hidden>
                      {r.image && <img src={r.image} alt="" loading="lazy" className="h-full w-full object-cover" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-lg font-extrabold leading-none">{r.code}</span>
                        {r.is_current && <Badge className="gap-1 px-1 text-[10px]"><Radio className="h-3 w-3" /> No overlay</Badge>}
                        {!r.shopify_ok && <Badge variant="destructive" className="px-1 text-[10px]">fora Shopify</Badge>}
                      </div>
                      <p className="truncate text-xs" title={r.product_name || ""}>{r.product_name || "—"}</p>
                      <span className="inline-block max-w-full truncate rounded bg-accent px-1.5 text-xs font-bold uppercase text-accent-foreground" title={r.color || ""}>{r.color || "sem cor"}</span>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        {hasOffer ? (
                          <><span className="text-[11px] text-muted-foreground line-through">{BRL(r.sale_price)}</span><span className="text-sm font-extrabold text-primary">{BRL(r.offer_price)}</span></>
                        ) : <span className="text-sm font-semibold">{BRL(r.sale_price)}</span>}
                        {r.free_shipping && <Badge variant="secondary" className="px-1 text-[10px]">frete grátis</Badge>}
                        {r.interest_free_installments && <Badge variant="secondary" className="px-1 text-[10px]">{r.interest_free_installments}x s/ juros</Badge>}
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={`Configurar ${r.code}`} onClick={() => openOffer(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                  </div>
                  <div className="mt-1.5 flex gap-2">
                    {r.is_current ? (
                      <Button size="sm" variant="outline" className="h-7 flex-1 gap-1 text-xs" disabled={busy === r.code} onClick={() => stop(r)} aria-label={`Parar apresentação ${r.code}`}>
                        {busy === r.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} Parar apresentação
                      </Button>
                    ) : (
                      <Button size="sm" className="h-7 flex-1 gap-1 text-xs" disabled={busy === r.code || !r.shopify_ok} onClick={() => show(r)} aria-label={`Apresentar ${r.code}`}>
                        {busy === r.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Apresentar
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open && !savingOffer) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Condições de {editing?.code}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{editing.product_name} · {editing.color || "sem cor"}<br />Preço cheio: <strong>{BRL(editing.sale_price)}</strong></p>
              <div className="space-y-1">
                <Label htmlFor="presenter-offer">Preço promocional (opcional)</Label>
                <Input id="presenter-offer" inputMode="decimal" placeholder="Ex.: 149,90" value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} />
                <p className="text-xs text-muted-foreground">Vazio mantém o preço cheio. Vale nos próximos carrinhos anotados.</p>
              </div>
              <div className="space-y-1">
                <Label>Parcelamento no cartão</Label>
                <Select value={installments} onValueChange={setInstallments}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Padrão da live</SelectItem>
                    {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => <SelectItem key={n} value={String(n)}>Até {n}x sem juros</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2"><Switch id="presenter-free-shipping" checked={freeShipping} onCheckedChange={setFreeShipping} /><Label htmlFor="presenter-free-shipping">Frete grátis para este produto</Label></div>
              <Button className="w-full" onClick={saveOffer} disabled={savingOffer}>{savingOffer && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar condições</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
