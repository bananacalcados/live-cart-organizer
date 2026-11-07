import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Instagram, Plus, Hash, X, Check, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OrderDialogDb } from "@/components/OrderDialogDb";
import { toast } from "sonner";
import type { DbOrderProduct } from "@/types/database";
import { fetchProducts, getVariantImage } from "@/lib/shopify";
import type { DbOrder } from "@/types/database";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { codeIntentDirectConfirmBlocked, computeLiveConditions, conditionsSummary, confirmCodeIntentOrder, mergeProducts, type LiveConditions } from "@/lib/liveCodeOrder";

const db = supabase as any;
const brl = (v?: number | null) => (v == null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export interface CodeIntentItem {
  code: string; quantity?: number; product_name?: string; color?: string; size?: string | null; price?: number;
  sku?: string; shopify_variant_id?: string | null; master_id?: string | null; stock?: number; status?: string; warnings?: string[];
}
export interface CodeIntent {
  id: string; username: string; items: CodeIntentItem[]; phone_last4: string | null; phone: string | null;
  status: string; warnings: string[] | null; last_comment_text: string | null; updated_at: string;
  kind: string | null; target_order_id: string | null;
}
interface CatalogRow { shopify_product_id: string; title: string; image_url: string | null; offer_price: number | null; original_price?: number | null; variants: any[] }

const COLS = "id,username,items,phone_last4,phone,status,warnings,last_comment_text,updated_at,kind,target_order_id";
const numId = (v?: string | null) => String(v || "").split("/").pop() || "";

async function currentUserName(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  return (u?.user_metadata?.full_name || u?.user_metadata?.name || u?.email || "Equipe") as string;
}

/** Localiza o item no catálogo da live pelo shopify_variant_id (ou SKU). */
export function matchCatalogItem(item: CodeIntentItem, catalog: CatalogRow[]): DbOrderProduct | null {
  const vid = numId(item.shopify_variant_id);
  for (const p of catalog) {
    for (const v of p.variants || []) {
      const hit = (vid && numId(v.variant_id) === vid) || (!vid && item.sku && v.sku === item.sku);
      if (!hit) continue;
      return {
        id: `${p.shopify_product_id}-${v.variant_id}`,
        shopifyId: v.variant_id,
        sku: v.sku || undefined,
        title: p.title,
        variant: v.title || [v.color, v.size].filter(Boolean).join(" / "),
        // Oferta da live vale quando menor que o preço original.
        basePrice: Number(p.original_price ?? item.price ?? v.price ?? 0) || undefined,
        price: p.offer_price != null && p.original_price != null && Number(p.offer_price) < Number(p.original_price)
          ? Number(p.offer_price)
          : Number(item.price ?? p.offer_price ?? v.price ?? 0),
        quantity: Number(item.quantity) || 1,
        image: v.image || p.image_url || undefined,
      };
    }
  }
  return null;
}

async function lookupShopifyHits(intent: CodeIntent, catalog: CatalogRow[]): Promise<Record<string, DbOrderProduct>> {
  const pending = (intent.items || []).filter((it) => it.shopify_variant_id && it.master_id && !matchCatalogItem(it, catalog));
  const hits: Record<string, DbOrderProduct> = {};
  if (pending.length === 0) return hits;
  try {
    const masterIds = [...new Set(pending.map((it) => it.master_id as string))];
    const { data: masters } = await db.from("products_master").select("id, shopify_product_id").in("id", masterIds);
    const pidByMaster = new Map<string, string>((masters || []).filter((m: any) => m.shopify_product_id).map((m: any) => [m.id, numId(m.shopify_product_id)]));
    const pids = [...new Set([...pidByMaster.values()])];
    const prods = pids.length ? await fetchProducts(Math.min(pids.length, 50), pids.map((id) => `id:${id}`).join(" OR ")) : [];
    for (const it of pending) {
      const pid = pidByMaster.get(it.master_id as string);
      const product = prods.find((p) => numId(p.node.id) === pid);
      const variant = product?.node.variants.edges.find((e) => numId(e.node.id) === numId(it.shopify_variant_id))?.node;
      if (!product || !variant) continue;
      const price = parseFloat(variant.price.amount);
      hits[numId(it.shopify_variant_id)] = {
        id: `${product.node.id}-${variant.id}`,
        shopifyId: variant.id,
        sku: variant.sku || undefined,
        title: product.node.title,
        variant: variant.title !== "Default Title" ? variant.title : "",
        price: Number(it.price ?? price),
        quantity: Number(it.quantity) || 1,
        image: getVariantImage(product, variant),
      };
    }
  } catch (e) { console.error("code-intent shopify lookup", e); }
  return hits;
}

function resolveIntent(intent: CodeIntent, catalog: CatalogRow[], hits: Record<string, DbOrderProduct> | null) {
  const products: DbOrderProduct[] = []; const missing: CodeIntentItem[] = [];
  for (const it of intent.items || []) {
    const m = (it.shopify_variant_id || it.sku ? matchCatalogItem(it, catalog) : null)
      || (it.shopify_variant_id ? hits?.[numId(it.shopify_variant_id)] : null) || null;
    if (m) products.push(m); else missing.push(it);
  }
  return { products, missing };
}

export function LiveCodeIntentCards({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<CodeIntent[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogRow[] | null>(null);
  const [comments, setComments] = useState<{ id: string; comment_text: string; created_at: string }[]>([]);
  // Itens fora do catálogo: localizados na Shopify (mesma busca do montar pedido). null = ainda buscando.
  const [shopifyHits, setShopifyHits] = useState<Record<string, DbOrderProduct> | null>(null);
  const [sizeDraft, setSizeDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await db.from("live_order_intents").select(COLS).eq("event_id", eventId)
      .in("status", ["incomplete", "ready"]).order("updated_at", { ascending: false }).limit(100);
    const next = (data || []) as CodeIntent[];
    setRows((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [eventId]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`live-code-intents-${eventId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_order_intents", filter: `event_id=eq.${eventId}` }, () => load())
      .subscribe();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => { clearInterval(t); supabase.removeChannel(ch); };
  }, [eventId, load]);

  const active = rows.find((r) => r.id === openId) || null;

  useEffect(() => {
    if (!active) return;
    let stop = false;
    db.from("live_comments").select("id, comment_text, created_at").eq("event_id", eventId)
      .ilike("username", active.username).order("created_at", { ascending: true }).limit(200)
      .then(({ data }: any) => { if (!stop) setComments(data || []); });
    if (!catalog) {
      db.from("event_catalog_products").select("shopify_product_id,title,image_url,offer_price,original_price,variants")
        .eq("event_id", eventId).limit(200).then(({ data }: any) => { if (!stop) setCatalog(data || []); });
    }
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, eventId]);

  // b) itens não achados no catálogo: products_master.shopify_product_id → Shopify, variação pelo shopify_variant_id.
  useEffect(() => {
    if (!active || !catalog) { setShopifyHits(null); return; }
    let stop = false;
    setShopifyHits(null);
    lookupShopifyHits(active, catalog).then((h) => { if (!stop) setShopifyHits(h); });
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.updated_at, catalog]);

  const resolved = useMemo(() => {
    if (!active) return { products: [] as DbOrderProduct[], missing: [] as CodeIntentItem[] };
    return resolveIntent(active, catalog || [], shopifyHits);
  }, [active, catalog, shopifyHits]);

  // Condições (compute) por card: 1 chamada por card, refeita só quando o card muda.
  const [conds, setConds] = useState<Record<string, { key: string; cond: LiveConditions | null }>>({});
  const [masterPid, setMasterPid] = useState<Record<string, string>>({});
  useEffect(() => {
    const need = [...new Set(rows.flatMap((r) => (r.items || []).map((i) => i.master_id).filter(Boolean) as string[]))].filter((m) => !(m in masterPid));
    if (need.length === 0) return;
    db.from("products_master").select("id, shopify_product_id").in("id", need.slice(0, 200)).then(({ data }: any) => {
      setMasterPid((prev) => {
        const next = { ...prev };
        need.forEach((m) => { next[m] = ""; });
        (data || []).forEach((m: any) => { next[m.id] = numId(m.shopify_product_id); });
        return next;
      });
    });
  }, [rows, masterPid]);
  useEffect(() => {
    let stop = false;
    for (const r of rows) {
      const key = `${r.updated_at}|${(r.items || []).map((i) => masterPid[i.master_id || ""] ?? "?").join(",")}`;
      if (conds[r.id]?.key === key) continue;
      if ((r.items || []).some((i) => i.master_id && masterPid[i.master_id] === undefined)) continue;
      const fake: DbOrderProduct[] = (r.items || []).map((i, idx) => ({
        id: `${masterPid[i.master_id || ""] || "x"}-${i.shopify_variant_id || idx}`, shopifyId: String(i.shopify_variant_id || ""),
        title: i.product_name || i.code, variant: "", price: Number(i.price || 0), quantity: 1,
      }));
      setConds((c) => ({ ...c, [r.id]: { key, cond: c[r.id]?.cond ?? null } }));
      computeLiveConditions(eventId, r.username, r.phone, fake)
        .then(({ cond }) => { if (!stop) setConds((c) => ({ ...c, [r.id]: { key, cond } })); })
        .catch((e) => console.error("compute conditions", e));
    }
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, masterPid, eventId]);

  // Modal: condições sobre os itens resolvidos (+ carrinho existente quando é ADD).
  const [modalCond, setModalCond] = useState<{ cond: LiveConditions; products: DbOrderProduct[]; target: DbOrder | null } | null>(null);
  useEffect(() => {
    setModalCond(null);
    if (!active || !orderOpen || !catalog || !shopifyHits) return;
    let stop = false;
    (async () => {
      try {
        const pre = await computeLiveConditions(eventId, active.username, active.phone, resolved.products);
        const targetId = active.target_order_id || pre.cond.open_order_id;
        let target: DbOrder | null = null;
        if (targetId) {
          const store = useDbOrderStore.getState();
          target = store.orders.find((o) => o.id === targetId) || null;
          if (!target) { await store.fetchOrdersByEvent(eventId); target = useDbOrderStore.getState().orders.find((o) => o.id === targetId) || null; }
        }
        if (target) {
          const full = await computeLiveConditions(eventId, active.username, active.phone, mergeProducts(target.products, resolved.products));
          if (!stop) setModalCond({ ...full, target });
        } else if (!stop) setModalCond({ ...pre, target: null });
      } catch (e) {
        console.error("compute modal", e);
        if (!stop) setModalCond({ cond: null as any, products: resolved.products, target: null });
      }
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, orderOpen, catalog, shopifyHits]);

  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmDirect = async (r: CodeIntent) => {
    if (confirming) return;
    setConfirming(r.id);
    try {
      let cat = catalog;
      if (!cat) {
        const { data } = await db.from("event_catalog_products").select("shopify_product_id,title,image_url,offer_price,original_price,variants").eq("event_id", eventId).limit(200);
        cat = (data || []) as CatalogRow[]; setCatalog(cat);
      }
      const hits = await lookupShopifyHits(r, cat);
      const { products, missing } = resolveIntent(r, cat, hits);
      if (missing.length > 0 || products.length === 0) {
        toast.warning("Algum item não foi localizado — confira no carrinho.");
        setOpenId(r.id); setOrderOpen(true);
        return;
      }
      const orderId = await confirmCodeIntentOrder(eventId, r, products, await currentUserName());
      toast.success(r.kind === "add" ? `Itens adicionados ao carrinho #${orderId.slice(-4)}` : "Pedido criado");
      load();
    } catch (e: any) {
      toast.error(`Não foi possível confirmar: ${e?.message || e}`);
    } finally { setConfirming(null); }
  };

  const setSize = async (intentId: string, index: number) => {
    const key = `${intentId}:${index}`;
    const size = (sizeDraft[key] || "").trim();
    if (!size) return;
    const { error } = await db.rpc("update_live_order_intent_item", { p_intent_id: intentId, p_index: index, p_size: size });
    if (error) toast.error(`Não foi possível salvar o tamanho: ${error.message}`);
    else { setSizeDraft((d) => ({ ...d, [key]: "" })); load(); }
  };

  const resolve = async (id: string, action: "confirm" | "dismiss", orderId?: string) => {
    const { error } = await db.rpc("resolve_live_order_intent", { p_intent_id: id, p_action: action, p_by: await currentUserName(), p_order_id: orderId ?? null });
    if (error) { toast.error(`Erro: ${error.message}`); return; }
    if (action === "dismiss") toast.success("Card descartado");
    setOpenId(null); setOrderOpen(false); load();
  };

  if (rows.length === 0) return null;

  const shopifyBlocked = (r: CodeIntent) => (r.items || []).some((i) => (i.warnings || []).some((w) => /não disponível na shopify/i.test(w)));
  const allWarnings = (r: CodeIntent) => [...(r.warnings || []), ...(r.items || []).flatMap((i) => i.warnings || [])];
  const phoneLabel = (r: CodeIntent) => (r.phone ? r.phone : r.phone_last4 ? `final ${r.phone_last4}` : "sem WhatsApp");

  return (
    <>
      <div className="flex items-stretch gap-2 overflow-x-auto pb-2 scrollbar-thin">
        {rows.map((r) => (
          <div
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => { setOpenId(r.id); setOrderOpen(false); }}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpenId(r.id)}
            className="relative flex min-h-[104px] w-[250px] shrink-0 cursor-pointer flex-col gap-1 rounded-lg border border-l-4 border-l-sky-500 bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
          >
            <div className="-mx-3 -mt-2 mb-1 flex items-center justify-between rounded-t-md bg-sky-500/15 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-sky-700 dark:text-sky-300">
              <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" /> Por código</span>
              <span>{r.status === "ready" ? "pronto" : "incompleto"}</span>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <Instagram className="h-4 w-4 shrink-0 text-pink-500" />
              <span className="truncate text-xs font-semibold">@{r.username}</span>
            </div>
            {(r.items || []).map((it, i) => (
              <div key={i} className={cn("rounded border px-1.5 py-1 text-[11px]", (it.warnings || []).some((w) => /não disponível na shopify/i.test(w)) ? "border-destructive bg-destructive/15 text-destructive" : "bg-muted/40")}>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-sm font-black tracking-wide">{it.code}</span>
                  <span className="truncate">{it.product_name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                  {it.color && <span>{it.color}</span>}
                  {it.size ? <span className="font-semibold text-foreground">nº {it.size}</span> : (
                    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <span className="rounded bg-destructive/15 px-1 font-extrabold text-destructive">tamanho?</span>
                      <Input
                        value={sizeDraft[`${r.id}:${i}`] || ""}
                        onChange={(e) => setSizeDraft((d) => ({ ...d, [`${r.id}:${i}`]: e.target.value }))}
                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") setSize(r.id, i); }}
                        onBlur={() => setSize(r.id, i)}
                        placeholder="nº"
                        className="h-6 w-12 px-1 text-[11px]"
                      />
                    </span>
                  )}
                  {it.price != null && <span>{brl(it.price)}</span>}
                  {it.stock != null && <span>est. {it.stock}</span>}
                </div>
              </div>
            ))}
            <span className="text-[11px] text-muted-foreground">📱 {phoneLabel(r)}</span>
            {r.kind === "add" && (
              <span className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-fuchsia-700 dark:text-fuchsia-300">
                Novo ADD → carrinho #{(r.target_order_id || conds[r.id]?.cond?.open_order_id || "????").slice(-4)}
              </span>
            )}
            {conds[r.id]?.cond && (() => { const sm = conditionsSummary(conds[r.id]!.cond!); return (
              <div className="text-[10px] leading-tight">
                <b>{sm.subtotal}</b> · {sm.shipping}{sm.cashback ? <> · <span className={conds[r.id]!.cond!.cashback_blocked ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}>{sm.cashback}</span></> : null}
              </div>
            ); })()}
            <Button
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={r.status !== "ready" || confirming === r.id || shopifyBlocked(r)}
              title={shopifyBlocked(r) ? "Item fora da Shopify: abra o card e resolva manualmente" : undefined}
              onClick={(e) => { e.stopPropagation(); confirmDirect(r); }}
            >
              {confirming === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Confirmar
            </Button>
            {allWarnings(r).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {allWarnings(r).map((w, i) => (
                  <span key={i} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", /não disponível na shopify/i.test(w) ? "bg-destructive/20 text-destructive" : "bg-amber-400/25 text-amber-800 dark:text-amber-200")}>{w}</span>
                ))}
              </div>
            )}
            {r.last_comment_text && <span className="mt-auto line-clamp-2 text-[10px] text-muted-foreground">"{r.last_comment_text}"</span>}
          </div>
        ))}
      </div>

      <Dialog open={!!active} onOpenChange={(v) => { if (!v) { setOpenId(null); setOrderOpen(false); } }}>
        <DialogContent className={cn("max-h-[92vh] p-0", orderOpen ? "max-w-[1200px]" : "max-w-lg")}>
          {active && (
            <div className="flex h-[85vh]">
              <div className={cn("flex min-w-0 flex-col", orderOpen ? "w-[420px] shrink-0 border-r" : "flex-1")}>
                <DialogHeader className="border-b p-4">
                  <DialogTitle className="flex items-center gap-2">
                    <Instagram className="h-5 w-5 text-pink-500" /> @{active.username}
                    <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-sky-700 dark:text-sky-300">Por código</span>
                  </DialogTitle>
                  <p className="text-xs text-muted-foreground">Comentários na live</p>
                </DialogHeader>
                <ScrollArea className="flex-1 p-3">
                  <div className="space-y-1.5">
                    {comments.map((m) => (
                      <div key={m.id} className="rounded-md border px-3 py-2 text-sm">
                        <div className="text-[10px] text-muted-foreground">{format(new Date(m.created_at), "HH:mm:ss")}</div>
                        <div className="break-words">{m.comment_text}</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                {resolved.missing.length > 0 && (
                  <div className="space-y-1 border-t bg-amber-400/10 p-3 text-xs">
                    {resolved.missing.map((it, i) => (
                      <div key={i}><b>{it.code}</b> {it.product_name} {it.color} {it.size ? `nº ${it.size}` : ""} — não localizado, adicione manualmente</div>
                    ))}
                  </div>
                )}
                {active.status === "incomplete" && (
                  <div className="border-t bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                    Falta tamanho em algum item. Dá pra criar mesmo assim.
                  </div>
                )}
                <div className="flex gap-2 border-t p-3">
                  <Button className="flex-1 gap-1.5" onClick={() => setOrderOpen((v) => !v)}>
                    <Plus className="h-4 w-4" /> {orderOpen ? "Fechar carrinho" : (active.kind === "add" || active.target_order_id) ? "Adicionar ao carrinho" : "Criar carrinho"}
                  </Button>
                  <Button variant="outline" className="gap-1.5" onClick={() => resolve(active.id, "dismiss")}>
                    <X className="h-4 w-4" /> Descartar
                  </Button>
                </div>
              </div>
              {orderOpen && catalog && shopifyHits && !modalCond && (
                <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
              )}
              {orderOpen && catalog && shopifyHits && modalCond && (
                <div className="min-w-0 flex-1 overflow-y-auto">
                  <OrderDialogDb
                    key={`${active.id}-${modalCond.target?.id || "new"}`}
                    editingOrder={modalCond.target}
                    liveConditions={modalCond.cond}
                    embedded
                    open
                    onOpenChange={(v) => { if (!v) setOrderOpen(false); }}
                    eventId={eventId}
                    prefillInstagram={active.username}
                    prefillWhatsapp={active.phone || undefined}
                    prefillPhoneLast4={active.phone ? undefined : active.phone_last4 || undefined}
                    prefillProducts={modalCond.products}
                    onCreated={(orderId) => resolve(active.id, "confirm", orderId)}
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
