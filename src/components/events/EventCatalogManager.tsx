import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { mergeVariants, pricingFromShopify, variantsFromShopify, type CatalogVariant } from "@/lib/liveCatalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LivePromotionsManager, useEventPromotions, type LivePromotion } from "./LivePromotionsManager";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CatalogRow {
  id: string;
  shopify_product_id: string;
  product_handle: string | null;
  title: string;
  image_url: string | null;
  original_price: number;
  offer_price: number | null;
  allow_cashback: boolean;
  variants: CatalogVariant[];
  position: number;
  is_active: boolean;
  free_shipping: boolean;
  promotion_id: string | null;
}

const COLS = "id,shopify_product_id,product_handle,title,image_url,original_price,offer_price,allow_cashback,variants,position,is_active,free_shipping,promotion_id";
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const db = supabase as any;

export function EventCatalogManager({ eventId }: { eventId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [hours, setHours] = useState("48");
  const [autoInvite, setAutoInvite] = useState(false);
  const [delayMin, setDelayMin] = useState("2");
  const [delayMax, setDelayMax] = useState("5");
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { promos, reload: reloadPromos } = useEventPromotions(eventId);

  const load = useCallback(async () => {
    const [ev, cp] = await Promise.all([
      db.from("events").select("catalog_enabled,catalog_link_hours,catalog_auto_invite,catalog_invite_delay_min,catalog_invite_delay_max").eq("id", eventId).maybeSingle(),
      db.from("event_catalog_products").select(COLS).eq("event_id", eventId).order("position").limit(200),
    ]);
    if (ev.data) {
      setEnabled(!!ev.data.catalog_enabled); setHours(String(ev.data.catalog_link_hours ?? 48));
      setAutoInvite(!!ev.data.catalog_auto_invite);
      setDelayMin(String(ev.data.catalog_invite_delay_min ?? 2)); setDelayMax(String(ev.data.catalog_invite_delay_max ?? 5));
    }
    if (cp.error) toast.error("Erro ao carregar o catálogo"); else setRows(cp.data || []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const saveEvent = async (patch: Record<string, unknown>) => {
    const { error } = await db.from("events").update(patch).eq("id", eventId);
    if (error) toast.error("Erro ao salvar: " + error.message); else toast.success("Salvo");
  };
  const saveDelay = () => {
    const a = parseInt(delayMin, 10), b = parseInt(delayMax, 10);
    if (!(a >= 0) || !(b >= 0)) { toast.error("Informe minutos válidos"); return; }
    const lo = Math.min(a, b), hi = Math.max(a, b);
    setDelayMin(String(lo)); setDelayMax(String(hi));
    saveEvent({ catalog_invite_delay_min: lo, catalog_invite_delay_max: hi });
  };

  const patchRow = async (id: string, patch: Partial<CatalogRow>, ok = "Salvo") => {
    const { data, error } = await db.from("event_catalog_products").update(patch).eq("id", id).select(COLS).single();
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    setRows((r) => r.map((x) => (x.id === id ? data : x)));
    toast.success(ok);
  };

  const addProduct = async (p: ShopifyProduct) => {
    if (rows.some((r) => r.shopify_product_id === p.node.id)) { toast.info("Produto já está no catálogo"); return; }
    setBusy(p.node.id);
    const images = p.node.images.edges.map((e) => e.node.url);
    const { data, error } = await db.from("event_catalog_products").insert({
      event_id: eventId,
      shopify_product_id: p.node.id,
      product_handle: p.node.handle,
      title: p.node.title,
      image_url: images[0] ?? null,
      images,
      ...pricingFromShopify(p),
      variants: variantsFromShopify(p),
      position: rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0,
    }).select(COLS).single();
    setBusy(null);
    if (error) { toast.error("Erro ao adicionar: " + error.message); return; }
    setRows((r) => [...r, data]);
    toast.success("Produto adicionado ao catálogo");
  };

  const refreshFromShopify = async (row: CatalogRow) => {
    setBusy(row.id);
    let found = (await fetchProducts(20, row.product_handle ? `handle:${row.product_handle}` : row.title)).find((p) => p.node.id === row.shopify_product_id);
    if (!found) found = (await fetchProducts(50, row.title)).find((p) => p.node.id === row.shopify_product_id);
    if (!found) { setBusy(null); toast.error("Produto não encontrado na Shopify"); return; }
    const images = found.node.images.edges.map((e) => e.node.url);
    await patchRow(row.id, {
      title: found.node.title,
      product_handle: found.node.handle,
      image_url: images[0] ?? null,
      images,
      original_price: pricingFromShopify(found).original_price,
      variants: mergeVariants(row.variants, variantsFromShopify(found)),
    } as any, "Atualizado da Shopify");
    setBusy(null);
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const a = rows[idx], b = rows[idx + dir];
    if (!a || !b) return;
    const pa = a.position === b.position ? idx : a.position;
    const pb = a.position === b.position ? idx + dir : b.position;
    const [r1, r2] = await Promise.all([
      db.from("event_catalog_products").update({ position: pb }).eq("id", a.id),
      db.from("event_catalog_products").update({ position: pa }).eq("id", b.id),
    ]);
    if (r1.error || r2.error) { toast.error("Erro ao reordenar"); return; }
    const next = [...rows];
    next[idx] = { ...b, position: pa };
    next[idx + dir] = { ...a, position: pb };
    setRows(next);
  };

  const moveTo = async (idx: number, target: number) => {
    const to = Math.min(rows.length, Math.max(1, Math.round(target))) - 1;
    if (to === idx || !isFinite(to)) return;
    const next = [...rows];
    const [it] = next.splice(idx, 1);
    next.splice(to, 0, it);
    const changed = next.map((r, i) => ({ ...r, position: i })).filter((r, i) => r.position !== rows.find((x) => x.id === r.id)?.position || false);
    const results = await Promise.all(changed.map((r) => db.from("event_catalog_products").update({ position: r.position }).eq("id", r.id)));
    if (results.some((r: any) => r.error)) { toast.error("Erro ao reordenar"); return; }
    setRows(next.map((r, i) => ({ ...r, position: i })));
  };

  const remove = async (row: CatalogRow) => {
    if (!confirm(`Remover "${row.title}" do catálogo?`)) return;
    const { error } = await db.from("event_catalog_products").delete().eq("id", row.id);
    if (error) { toast.error("Erro ao remover"); return; }
    setRows((r) => r.filter((x) => x.id !== row.id));
    toast.success("Produto removido");
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="font-semibold">Catálogo cross-sell</h3>
        <p className="text-xs text-muted-foreground">Produtos oferecidos à cliente depois que ela paga o primeiro pedido.</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); saveEvent({ catalog_enabled: v }); }} />
          <Label>Catálogo ativo</Label>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Validade do link após a live (horas)</Label>
          <Input type="number" min={1} className="w-28" value={hours} onChange={(e) => setHours(e.target.value)}
            onBlur={() => { const n = parseInt(hours, 10); if (n > 0) saveEvent({ catalog_link_hours: n }); else setHours("48"); }} />
        </div>
        <Button type="button" size="sm" onClick={() => setPickerOpen(true)}><Plus className="mr-1 h-4 w-4" />Adicionar produto</Button>
      </div>

      <PublicCatalogLinkPanel eventId={eventId} products={rows.map((r: any) => ({ id: r.id, title: r.title }))} />

      <div className="space-y-2 rounded-md border border-dashed p-3">
        <div className="flex items-center gap-2">
          <Switch disabled={!enabled} checked={enabled && autoInvite}
            onCheckedChange={(v) => { setAutoInvite(v); saveEvent({ catalog_auto_invite: v }); }} />
          <Label>Enviar convite automático após o pagamento</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          {enabled ? "Teste o link manualmente antes de ligar." : "Ligue “Catálogo ativo” para poder enviar convites."}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Enviar entre</span>
          <Input type="number" min={0} className="w-20" value={delayMin} disabled={!enabled} onChange={(e) => setDelayMin(e.target.value)} onBlur={saveDelay} />
          <span>e</span>
          <Input type="number" min={0} className="w-20" value={delayMax} disabled={!enabled} onChange={(e) => setDelayMax(e.target.value)} onBlur={saveDelay} />
          <span>minutos após o pagamento</span>
        </div>
      </div>

      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum produto no catálogo.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, idx) => (
            <CatalogCard key={row.id} row={row} promos={promos} busy={busy === row.id} first={idx === 0} last={idx === rows.length - 1}
              index={idx} total={rows.length} onMoveTo={(n) => moveTo(idx, n)}
              onPatch={(p) => patchRow(row.id, p)} onUp={() => move(idx, -1)} onDown={() => move(idx, 1)}
              onRefresh={() => refreshFromShopify(row)} onRemove={() => remove(row)} />
          ))}
        </div>
      )}

      <LivePromotionsManager eventId={eventId} onSaved={() => { reloadPromos(); load(); }} />

      <ShopifyPicker open={pickerOpen} onOpenChange={setPickerOpen} busyId={busy}
        existing={new Set(rows.map((r) => r.shopify_product_id))} onPick={addProduct} />
    </div>
  );
}

function CatalogCard({ row, promos, busy, first, last, index, total, onMoveTo, onPatch, onUp, onDown, onRefresh, onRemove }: {
  row: CatalogRow; promos: LivePromotion[]; busy: boolean; first: boolean; last: boolean; index: number; total: number; onMoveTo: (n: number) => void;
  onPatch: (p: Partial<CatalogRow>) => void; onUp: () => void; onDown: () => void; onRefresh: () => void; onRemove: () => void;
}) {
  const [offer, setOffer] = useState(row.offer_price != null ? String(row.offer_price) : "");
  useEffect(() => { setOffer(row.offer_price != null ? String(row.offer_price) : ""); }, [row.offer_price]);

  const [pos, setPos] = useState(String(index + 1));
  useEffect(() => { setPos(String(index + 1)); }, [index]);
  const commitPos = () => { const n = parseInt(pos, 10); if (n > 0 && n !== index + 1) onMoveTo(n); else setPos(String(index + 1)); };

  const commitOffer = () => {
    const raw = offer.trim().replace(",", ".");
    const val = raw === "" ? null : Number(raw);
    if (val !== null && (!isFinite(val) || val <= 0)) { toast.error("Preço de oferta inválido"); return; }
    if (val === row.offer_price) return;
    onPatch(val === null ? { offer_price: null, allow_cashback: true } : { offer_price: val });
  };

  return (
    <div className={`rounded-md border p-3 ${row.is_active ? "" : "opacity-60"}`}>
      <div className="flex gap-3">
        {row.image_url && <img src={row.image_url} alt={row.title} className="h-16 w-16 rounded object-cover" />}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate font-medium">{row.title}</p>
          <p className="text-sm text-muted-foreground">Preço original: {brl(Number(row.original_price))}</p>
          {row.offer_price != null
            ? <Badge variant="destructive">Oferta — não aceita cashback</Badge>
            : <Badge variant="secondary">Preço normal — aceita cashback</Badge>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <Switch checked={row.is_active} onCheckedChange={(v) => onPatch({ is_active: v })} />
            <span className="text-xs">{row.is_active ? "Ativo" : "Inativo"}</span>
          </div>
          <div className="flex gap-1">
            <Button type="button" size="icon" variant="ghost" disabled={first} onClick={onUp}><ArrowUp className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="ghost" disabled={last} onClick={onDown}><ArrowDown className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="ghost" disabled={busy} onClick={onRefresh} title="Atualizar da Shopify">
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            </Button>
            <Button type="button" size="icon" variant="ghost" onClick={onRemove}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Posição no catálogo (1 a {total})</Label>
          <Input type="number" min={1} max={total} className="w-24" value={pos} onChange={(e) => setPos(e.target.value)}
            onBlur={commitPos} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitPos(); } }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Preço de oferta (opcional)</Label>
          <Input className="w-32" inputMode="decimal" placeholder="—" value={offer} onChange={(e) => setOffer(e.target.value)}
            onBlur={commitOffer} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitOffer(); } }} />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch checked={!!row.free_shipping} onCheckedChange={(v) => onPatch({ free_shipping: v })} />
          <Label className="text-xs">Frete grátis</Label>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Promoção</Label>
          <Select value={row.promotion_id || "none"} onValueChange={(v) => onPatch({ promotion_id: v === "none" ? null : v })}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhuma</SelectItem>
              {promos.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.is_active ? "" : " (inativa)"}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-3">
        <Label className="text-xs">Numerações disponíveis</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {row.variants.map((v) => (
            <button key={v.variant_id} type="button"
              onClick={() => onPatch({ variants: row.variants.map((x) => x.variant_id === v.variant_id ? { ...x, enabled: !x.enabled } : x) })}
              className={`rounded-full border px-2 py-0.5 text-xs transition ${v.enabled ? "border-primary bg-primary/10 text-foreground" : "border-border bg-muted text-muted-foreground line-through"}`}>
              {v.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShopifyPicker({ open, onOpenChange, onPick, existing, busyId }: {
  open: boolean; onOpenChange: (o: boolean) => void; onPick: (p: ShopifyProduct) => void; existing: Set<string>; busyId: string | null;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      setItems(await fetchProducts(50, q.trim() || undefined, q.trim() ? undefined : { newestFirst: true }));
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Adicionar produto da Shopify</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar produto..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
          <div className="space-y-2">
            {items.map((p) => {
              const added = existing.has(p.node.id);
              return (
                <div key={p.node.id} className="flex items-center gap-3 rounded border p-2">
                  {p.node.images.edges[0] && <img src={p.node.images.edges[0].node.url} alt="" className="h-12 w-12 rounded object-cover" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.node.title}</p>
                    <p className="text-xs text-muted-foreground">{brl(parseFloat(p.node.priceRange.minVariantPrice.amount))} · {p.node.variants.edges.length} variantes</p>
                  </div>
                  <Button type="button" size="sm" variant={added ? "secondary" : "default"} disabled={added || busyId === p.node.id} onClick={() => onPick(p)}>
                    {added ? "Adicionado" : busyId === p.node.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Adicionar"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
