import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts } from "@/lib/shopify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Import, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ImportPromotionDialog } from "./ImportPromotionDialog";

const db = supabase as any;
const numId = (v?: string | null) => String(v || "").split("/").pop()?.replace(/\D/g, "") || "";
const CODE_RE = /^\s*([a-z])\s*[-\s]?\s*(\d{3})\s*$/i;

export interface LivePromotion {
  id: string; name: string; shopify_product_ids: string[] | null;
  tiers: { qty: number; price: number }[]; free_shipping: boolean; blocks_cashback: boolean; is_active: boolean;
}

/** Promoções da live (para os seletores do catálogo e cross-sell). */
export function useEventPromotions(eventId: string | null | undefined) {
  const [promos, setPromos] = useState<LivePromotion[]>([]);
  const load = useCallback(async () => {
    if (!eventId) return;
    const { data } = await db.from("event_promotions")
      .select("id,name,shopify_product_ids,tiers,free_shipping,blocks_cashback,is_active")
      .eq("event_id", eventId).order("created_at", { ascending: false }).limit(100);
    setPromos(((data || []) as any[]).map((p) => ({
      ...p,
      tiers: (Array.isArray(p.tiers) ? p.tiers : []).map((t: any) => ({ qty: Number(t.qty ?? t.quantity ?? 0), price: Number(t.price ?? 0) })),
    })));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);
  return { promos, reload: load };
}

interface Picked { id: string; title: string }

export function LivePromotionsManager({ eventId, onSaved }: { eventId: string; onSaved?: () => void }) {
  const { promos, reload } = useEventPromotions(eventId);
  const [editing, setEditing] = useState<LivePromotion | null>(null);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const toggle = async (p: LivePromotion, v: boolean) => {
    const { error } = await db.from("event_promotions").update({ is_active: v }).eq("id", p.id);
    if (error) toast.error(error.message); else reload();
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">Promoções progressivas</h3>
          <p className="text-xs text-muted-foreground">Qualquer cor dos produtos escolhidos conta no mesmo grupo. O preço da faixa é o total do grupo.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Import className="mr-1 h-4 w-4" />Importar de outra live</Button>
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="mr-1 h-4 w-4" />Nova promoção</Button>
        </div>
      </div>
      {promos.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma promoção.</p> : (
        <div className="space-y-2">
          {promos.map((p) => (
            <div key={p.id} className={`flex items-start justify-between gap-2 rounded-md border p-2 ${p.is_active ? "" : "opacity-60"}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{p.name}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {p.tiers.map((t, i) => <Badge key={i} variant="secondary" className="text-[10px]">{t.qty} un = R$ {t.price.toFixed(2)}</Badge>)}
                  {p.free_shipping && <Badge className="text-[10px]">frete grátis</Badge>}
                  {p.blocks_cashback && <Badge variant="outline" className="text-[10px]">bloqueia cashback</Badge>}
                  <Badge variant="outline" className="text-[10px]">{(p.shopify_product_ids || []).length} produto(s)</Badge>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Switch checked={p.is_active} onCheckedChange={(v) => toggle(p, v)} />
                <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {open && (
        <PromotionDialog eventId={eventId} promo={editing} onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); reload(); onSaved?.(); }} />
      )}
    </div>
  );
}

function PromotionDialog({ eventId, promo, onClose, onSaved }: { eventId: string; promo: LivePromotion | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(promo?.name || "");
  const [tiers, setTiers] = useState<{ qty: string; price: string }[]>(
    promo?.tiers.length ? promo.tiers.map((t) => ({ qty: String(t.qty), price: String(t.price) })) : [{ qty: "1", price: "" }],
  );
  const [freeShipping, setFreeShipping] = useState(promo?.free_shipping ?? false);
  const [blocksCashback, setBlocksCashback] = useState(promo?.blocks_cashback ?? true);
  const [picked, setPicked] = useState<Picked[]>((promo?.shopify_product_ids || []).map((id) => ({ id, title: id })));
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Picked[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  // Nomes dos produtos já escolhidos (uma busca só).
  useEffect(() => {
    const ids = (promo?.shopify_product_ids || []).filter(Boolean);
    if (!ids.length) return;
    fetchProducts(Math.min(ids.length, 50), ids.map((i) => `id:${i}`).join(" OR "))
      .then((ps) => setPicked((cur) => cur.map((c) => ({ ...c, title: ps.find((p) => numId(p.node.id) === c.id)?.node.title || c.title }))))
      .catch(() => {});
  }, [promo?.id]);

  const search = async () => {
    const term = q.trim();
    if (term.length < 2) return;
    setSearching(true);
    try {
      const m = term.match(CODE_RE);
      if (m) {
        const code = `${m[1].toUpperCase()}${m[2]}`;
        const { data: rows } = await db.from("v_product_color_codes").select("master_id, product_name").eq("code", code).limit(1);
        const mid = rows?.[0]?.master_id;
        if (mid) {
          const { data: master } = await db.from("products_master").select("shopify_product_id").eq("id", mid).maybeSingle();
          const pid = numId(master?.shopify_product_id);
          if (pid) { setResults([{ id: pid, title: `${code} · ${rows[0].product_name}` }]); return; }
          toast.warning(`${code}: produto sem vínculo com a Shopify`);
        }
        setResults([]); return;
      }
      const ps = await fetchProducts(20, `title:*${term}*`);
      setResults(ps.map((p) => ({ id: numId(p.node.id), title: p.node.title })));
    } catch (e: any) { toast.error(e?.message || "Erro na busca"); } finally { setSearching(false); }
  };

  const save = async () => {
    const t = tiers.map((x) => ({ qty: parseInt(x.qty, 10), price: Number(String(x.price).replace(",", ".")) }))
      .filter((x) => x.qty > 0 && x.price > 0).sort((a, b) => a.qty - b.qty);
    if (!name.trim() || t.length === 0 || picked.length === 0) { toast.error("Preencha nome, produtos e ao menos 1 faixa"); return; }
    setSaving(true);
    const ids = [...new Set(picked.map((p) => p.id))];
    const row = { event_id: eventId, name: name.trim(), shopify_product_ids: ids, tiers: t, free_shipping: freeShipping, blocks_cashback: blocksCashback, is_active: true };
    const res = promo
      ? await db.from("event_promotions").update(row).eq("id", promo.id).select("id").single()
      : await db.from("event_promotions").insert(row).select("id").single();
    if (res.error) { setSaving(false); toast.error(res.error.message); return; }
    const pid = res.data.id as string;
    // Vincula a promoção aos produtos do catálogo/cross-sell da live que estão na lista.
    const [cat, xs] = await Promise.all([
      db.from("event_catalog_products").select("id,shopify_product_id,promotion_id").eq("event_id", eventId).limit(200),
      db.from("event_crossell_offers").select("id,shopify_product_id,promotion_id").eq("event_id", eventId).limit(200),
    ]);
    const pick = (rows: any[]) => (rows || []).filter((r) => ids.includes(numId(r.shopify_product_id)) && r.promotion_id !== pid).map((r) => r.id);
    const unpick = (rows: any[]) => (rows || []).filter((r) => r.promotion_id === pid && !ids.includes(numId(r.shopify_product_id))).map((r) => r.id);
    const ops: Promise<any>[] = [];
    const catIds = pick(cat.data), xsIds = pick(xs.data), catOff = unpick(cat.data), xsOff = unpick(xs.data);
    if (catIds.length) ops.push(db.from("event_catalog_products").update({ promotion_id: pid }).in("id", catIds));
    if (xsIds.length) ops.push(db.from("event_crossell_offers").update({ promotion_id: pid }).in("id", xsIds));
    if (catOff.length) ops.push(db.from("event_catalog_products").update({ promotion_id: null }).in("id", catOff));
    if (xsOff.length) ops.push(db.from("event_crossell_offers").update({ promotion_id: null }).in("id", xsOff));
    await Promise.all(ops);
    setSaving(false);
    toast.success("Promoção salva");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{promo ? "Editar promoção" : "Nova promoção progressiva"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1"><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: 3 por 200" /></div>
          <div className="space-y-1">
            <Label>Produtos</Label>
            <div className="flex gap-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou código (ex.: A097)"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
              <Button type="button" variant="outline" onClick={search} disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            {results.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded border p-1">
                {results.map((r) => (
                  <button key={r.id} type="button" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                    onClick={() => setPicked((p) => (p.some((x) => x.id === r.id) ? p : [...p, r]))}>{r.title}</button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {picked.map((p) => (
                <Badge key={p.id} variant="secondary" className="gap-1">
                  {p.title}
                  <button type="button" onClick={() => setPicked((c) => c.filter((x) => x.id !== p.id))}><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Faixas (quantidade → preço total do grupo)</Label>
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input type="number" min={1} className="w-20" value={t.qty} onChange={(e) => setTiers((c) => c.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                <span className="text-sm text-muted-foreground">un por R$</span>
                <Input inputMode="decimal" className="w-28" value={t.price} onChange={(e) => setTiers((c) => c.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
                {tiers.length > 1 && <Button size="icon" variant="ghost" onClick={() => setTiers((c) => c.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => setTiers((c) => [...c, { qty: String(c.length + 1), price: "" }])}><Plus className="mr-1 h-3 w-3" />Faixa</Button>
          </div>
          <div className="flex items-center gap-2"><Switch checked={freeShipping} onCheckedChange={setFreeShipping} /><Label>Frete grátis</Label></div>
          <div className="flex items-center gap-2"><Switch checked={blocksCashback} onCheckedChange={setBlocksCashback} /><Label>Bloqueia cashback</Label></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Salvar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
