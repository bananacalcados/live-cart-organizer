import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { Loader2, ShieldCheck, ShoppingBag, Minus, Plus, Trash2, Sparkles, Gift, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { SelfServicePrivacy } from "@/components/live/SelfServicePrivacy";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Variant { variant_id: string; title: string; image: string | null }
interface Product { id: string; title: string; image_url: string | null; images: string[]; original_price: number; offer_price: number | null; allow_cashback: boolean; variants: Variant[] }
interface CartItem { id: string; title: string; variant: string; price: number; quantity: number; image: string | null; promo: boolean }
interface Cart { order_id: string; cart_url: string; items: CartItem[]; subtotal: number; cashback_applied: number; shipping: { free_shipping: boolean; shipping_cost: number }; total: number; pix_total: number }
interface Price { id: string; your_price: number; cashback_discount: number }
interface State {
  event?: { name: string; product_notice: string | null; official_last4: string | null; google_rating: string | null; google_url: string | null };
  customer?: { greet: string | null };
  catalog?: Product[];
  prices?: Price[];
  cashback: { amount: number; min_purchase: number; expires_at: string } | null;
  cashback_pending: boolean;
  min_purchase_hint: number | null;
  cart: Cart | null;
  last_paid_order_id: string | null;
}

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("live-catalog", { body });
  if (error && !data) throw error;
  return data as any;
}

function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted">
      {!loaded && <Skeleton className="absolute inset-0" />}
      {src && <img src={src} alt={alt} loading="lazy" onLoad={() => setLoaded(true)} className={`h-full w-full object-cover transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`} />}
    </div>
  );
}

export default function LiveCatalogPage() {
  const { eventSlug = "", token = "" } = useParams();
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState<"expired" | "invalid" | null>(null);
  const [sel, setSel] = useState<Product | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bump, setBump] = useState(false);
  const base = useRef({ slug: eventSlug.toLowerCase(), token: token.toLowerCase() });

  const merge = useCallback((d: any) => setSt((prev) => ({ ...(prev || {}), ...d } as State)), []);

  useEffect(() => {
    call({ action: "open", ...base.current }).then((d) => {
      if (!d?.ok) setError(d?.error === "expired" ? "expired" : "invalid"); else merge(d);
    }).catch(() => setError("invalid"));
  }, [merge]);

  // Atualiza cashback/pagamento a cada 30 s só com a aba visível.
  useEffect(() => {
    if (!st || error) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      call({ action: "state", ...base.current }).then((d) => {
        if (d?.ok) merge(d); else if (d?.error === "expired") setError("expired");
      }).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [!!st, error, merge]); // eslint-disable-line react-hooks/exhaustive-deps

  const openProduct = (p: Product) => { setSel(p); setVariant(p.variants.length === 1 ? p.variants[0].variant_id : null); setQty(1); };

  const add = async () => {
    if (!sel || !variant) return;
    setBusy(true);
    try {
      const d = await call({ action: "add", ...base.current, catalog_product_id: sel.id, variant_id: variant, quantity: qty });
      if (!d?.ok) { toast.error(d?.error === "unavailable" ? "Essa numeração não está mais disponível" : "Não deu pra adicionar agora, tenta de novo"); return; }
      merge(d);
      setConfirmOpen(false); setSel(null);
      toast.success("Adicionado ao seu carrinho");
      setBump(true); setTimeout(() => setBump(false), 700);
    } catch { toast.error("Não deu pra adicionar agora, tenta de novo"); }
    finally { setBusy(false); }
  };

  const remove = async (itemId: string) => {
    setBusy(true);
    try { const d = await call({ action: "remove", ...base.current, item_id: itemId }); if (d?.ok) merge(d); }
    finally { setBusy(false); }
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div className="space-y-2">
          <Clock className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-bold">{error === "expired" ? "Esse link venceu" : "Link inválido"}</p>
          <p className="text-sm text-muted-foreground">{error === "expired" ? "Fale com a gente no WhatsApp que a gente te ajuda 😊" : "Confira se abriu o link certinho que mandamos no WhatsApp."}</p>
        </div>
      </div>
    );
  }
  if (!st?.event) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const ev = st.event;
  const catalog = st.catalog || [];
  const priceOf = (id: string) => st.prices?.find((p) => p.id === id);
  const cart = st.cart;
  const itemsCount = cart?.items.reduce((s, i) => s + i.quantity, 0) || 0;

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="mx-auto max-w-md">
        {/* Cabeçalho */}
        <div className="relative overflow-hidden bg-gradient-to-br from-primary/20 via-primary/5 to-background px-4 pb-5 pt-6">
          <Sparkles className="absolute right-4 top-4 h-6 w-6 text-primary/40" />
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{ev.name}</p>
          <h1 className="mt-1 text-2xl font-extrabold leading-tight">Ofertas pra quem já comprou hoje 😊</h1>
          {st.customer?.greet && <p className="mt-1 text-sm text-muted-foreground">Separamos pra você, {st.customer.greet}</p>}

          {st.cashback ? (
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-background/80 p-3 shadow-sm backdrop-blur">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Gift className="h-5 w-5" /></div>
              <div className="text-sm">
                <p className="font-bold">Você tem {brl(st.cashback.amount)} de cashback</p>
                <p className="text-xs text-muted-foreground">
                  Válido até {new Date(st.cashback.expires_at).toLocaleDateString("pt-BR")}
                  {st.cashback.min_purchase > 0 && ` · compras acima de ${brl(st.cashback.min_purchase)}`}
                </p>
              </div>
            </div>
          ) : st.cashback_pending ? (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border bg-background/80 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> Seu cashback está sendo liberado…
            </div>
          ) : null}
          {st.min_purchase_hint && st.cashback && (
            <p className="mt-2 text-xs text-muted-foreground">Use seu cashback em compras acima de {brl(st.min_purchase_hint)} em produtos de preço normal.</p>
          )}
        </div>

        {st.last_paid_order_id && !cart && (
          <div className="mx-4 mt-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-primary" />
            <div><p className="font-bold">Pedido pago ✅ Obrigada!</p><p className="text-muted-foreground">Quer mais alguma coisa? É só adicionar 😊</p></div>
          </div>
        )}

        {/* Grade */}
        {catalog.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Nenhum produto disponível agora.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4">
            {catalog.map((p) => {
              const promo = p.offer_price != null;
              const price = promo ? p.offer_price! : p.original_price;
              const pr = priceOf(p.id);
              return (
                <button key={p.id} type="button" onClick={() => openProduct(p)}
                  className="group overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition active:scale-[0.98]">
                  <div className="relative">
                    <ProductImage src={p.image_url} alt={p.title} />
                    {promo && <span className="absolute left-2 top-2 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-extrabold text-destructive-foreground">OFERTA</span>}
                  </div>
                  <div className="space-y-0.5 p-2.5">
                    <p className="line-clamp-2 text-xs font-medium leading-snug">{p.title}</p>
                    {promo && <p className="text-[11px] text-muted-foreground line-through">{brl(p.original_price)}</p>}
                    <p className="text-base font-extrabold">{brl(price)}</p>
                    {!promo && pr && pr.cashback_discount > 0 && <p className="text-[11px] font-semibold text-primary">com seu cashback: {brl(pr.your_price)}</p>}
                    {(promo || !p.allow_cashback) && <p className="text-[10px] text-muted-foreground">não aceita cashback</p>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {ev.product_notice && <p className="px-4 text-center text-xs text-muted-foreground">{ev.product_notice}</p>}

        {/* Confiança */}
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Banana Calçados · 10 anos · 2 lojas físicas em Gov. Valadares-MG</span>
            {ev.google_rating && ev.google_url && (
              <a href={ev.google_url} target="_blank" rel="noreferrer" className="font-semibold text-foreground underline-offset-2 hover:underline">{ev.google_rating} ★ no Google</a>
            )}
          </div>
          <SelfServicePrivacy slug={eventSlug} />
          <p className="text-center text-xs text-muted-foreground">
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
            Único WhatsApp oficial da Banana: final <strong>{ev.official_last4 || "----"}</strong>. Qualquer outro número é golpe.
          </p>
        </div>
      </div>

      {/* Barra do carrinho */}
      {cart && cart.items.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-md items-center gap-3 p-3">
            <button type="button" onClick={() => setCartOpen(true)} className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition ${bump ? "scale-125 border-primary" : ""}`}>
              <ShoppingBag className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{itemsCount}</span>
            </button>
            <div className="min-w-0 flex-1 text-xs leading-tight">
              <p className="font-bold">{itemsCount} {itemsCount === 1 ? "item" : "itens"} · {brl(cart.total)}</p>
              {cart.cashback_applied > 0 && <p className="text-primary">−{brl(cart.cashback_applied)} de cashback</p>}
              {cart.pix_total < cart.total && <p className="text-muted-foreground">{brl(cart.pix_total)} no Pix</p>}
            </div>
            <Button className="h-12 font-extrabold" onClick={() => { window.location.href = cart.cart_url; }}>FINALIZAR COMPRA</Button>
          </div>
        </div>
      )}

      {/* Produto */}
      <Drawer open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DrawerContent className="mx-auto max-h-[92vh] max-w-md">
          {sel && (() => {
            const promo = sel.offer_price != null;
            const pr = priceOf(sel.id);
            const imgs = sel.images.length ? sel.images : sel.image_url ? [sel.image_url] : [];
            return (
              <div className="overflow-y-auto pb-4">
                <Carousel className="w-full">
                  <CarouselContent>
                    {imgs.map((src, i) => (
                      <CarouselItem key={i}><div className="px-4"><div className="overflow-hidden rounded-2xl"><ProductImage src={src} alt={sel.title} /></div></div></CarouselItem>
                    ))}
                  </CarouselContent>
                </Carousel>
                {imgs.length > 1 && <p className="mt-1 text-center text-[11px] text-muted-foreground">Arraste pro lado pra ver mais fotos</p>}
                <DrawerHeader className="pb-2 text-left">
                  <DrawerTitle className="leading-snug">{sel.title}</DrawerTitle>
                  <div className="flex items-baseline gap-2">
                    {promo && <span className="text-sm text-muted-foreground line-through">{brl(sel.original_price)}</span>}
                    <span className="text-2xl font-extrabold">{brl(promo ? sel.offer_price! : sel.original_price)}</span>
                  </div>
                  {!promo && pr && pr.cashback_discount > 0 && <p className="text-sm font-semibold text-primary">com seu cashback: {brl(pr.your_price)}</p>}
                  {(promo || !sel.allow_cashback) && <p className="text-xs text-muted-foreground">Produto em oferta — não aceita cashback</p>}
                </DrawerHeader>
                <div className="space-y-4 px-4">
                  <div>
                    <p className="mb-2 text-sm font-semibold">Escolha a numeração</p>
                    <div className="flex flex-wrap gap-2">
                      {sel.variants.map((v) => (
                        <button key={v.variant_id} type="button" onClick={() => setVariant(v.variant_id)}
                          className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold transition ${variant === v.variant_id ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                          {v.title}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">Quantidade</span>
                    <Button size="icon" variant="outline" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus className="h-4 w-4" /></Button>
                    <span className="w-6 text-center font-bold">{qty}</span>
                    <Button size="icon" variant="outline" onClick={() => setQty((q) => Math.min(10, q + 1))}><Plus className="h-4 w-4" /></Button>
                  </div>
                  <Button className="h-14 w-full text-base font-extrabold" disabled={!variant || busy} onClick={() => setConfirmOpen(true)}>ADICIONAR AO CARRINHO</Button>
                  {!variant && <p className="text-center text-xs text-muted-foreground">Escolha a numeração pra adicionar</p>}
                </div>
              </div>
            );
          })()}
        </DrawerContent>
      </Drawer>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center">Atenção</AlertDialogTitle>
            <AlertDialogDescription className="text-center text-base font-bold text-foreground">
              TEMOS POUCOS PARES, PEDIMOS QUE POR FAVOR, SÓ ADICIONE SE REALMENTE FOR FICAR COM ELE
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); add(); }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "CONFIRMAR"}
            </AlertDialogAction>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resumo do carrinho */}
      <Drawer open={cartOpen} onOpenChange={setCartOpen}>
        <DrawerContent className="mx-auto max-w-md">
          <DrawerHeader><DrawerTitle>Seu carrinho</DrawerTitle></DrawerHeader>
          <div className="space-y-2 px-4 pb-4">
            {cart?.items.map((i) => (
              <div key={i.id} className="flex items-center gap-3 rounded-xl border p-2">
                {i.image && <img src={i.image} alt={i.title} className="h-14 w-14 rounded-lg object-cover" />}
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium">{i.title}</p>
                  <p className="text-xs text-muted-foreground">{i.variant} · {i.quantity}x {brl(i.price)}</p>
                </div>
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => remove(i.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
            {cart && (
              <div className="space-y-1 rounded-xl bg-muted/40 p-3 text-sm">
                <p className="flex justify-between"><span>Produtos</span><span>{brl(cart.subtotal)}</span></p>
                {cart.cashback_applied > 0 && <p className="flex justify-between text-primary"><span>Cashback</span><span>−{brl(cart.cashback_applied)}</span></p>}
                <p className="flex justify-between"><span>Frete</span><span>{cart.shipping.free_shipping ? "Grátis" : brl(cart.shipping.shipping_cost)}</span></p>
                <p className="flex justify-between font-bold"><span>Total</span><span>{brl(cart.total)}</span></p>
                {cart.pix_total < cart.total && <p className="text-right text-xs text-muted-foreground">{brl(cart.pix_total)} no Pix</p>}
              </div>
            )}
            {cart && cart.items.length > 0 && (
              <Button className="h-12 w-full font-extrabold" onClick={() => { window.location.href = cart.cart_url; }}>FINALIZAR COMPRA</Button>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
