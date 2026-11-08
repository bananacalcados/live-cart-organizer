import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { Loader2, ShieldCheck, ShoppingBag, Minus, Plus, Trash2, Sparkles, Clock } from "lucide-react";
import { toast } from "sonner";
import { SelfServicePrivacy } from "@/components/live/SelfServicePrivacy";
import { captureAttribution } from "@/lib/metaAttribution";
import { trackSelfservice } from "@/lib/selfServiceAdvertising";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const onlyDigits = (s: string) => s.replace(/\D/g, "");
const maskPhone = (s: string) => { const d = onlyDigits(s).slice(0, 11); return d.length <= 2 ? d : d.length <= 7 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`; };
const maskCpf = (s: string) => onlyDigits(s).slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
const maskCep = (s: string) => onlyDigits(s).slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");

interface Variant { variant_id: string; title: string; image: string | null; available: boolean }
interface Product { id: string; shopify_product_id: string; title: string; image_url: string | null; images: string[]; original_price: number; offer_price: number | null; allow_cashback: boolean; variants: Variant[]; sold_out: boolean }
interface Ev { name: string; product_notice: string | null; official_last4: string | null; google_rating: string | null; google_url: string | null }
interface Line { pid: string; vid: string; qty: number }

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("live-catalog-public", { body });
  if (error && !data) {
    const ctx: any = (error as any).context;
    try { return await ctx.json(); } catch { throw error; }
  }
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

function parseVariants(vs: Variant[]) {
  return vs.map((v) => {
    const parts = v.title.split("/").map((x) => x.trim()).filter(Boolean);
    const sizeIdx = parts.findIndex((x) => /^\d+([.,]\d+)?$/.test(x));
    const size = sizeIdx >= 0 ? parts[sizeIdx] : parts.length > 1 ? parts[parts.length - 1] : parts[0] || v.title;
    const colorParts = parts.filter((_, i) => i !== (sizeIdx >= 0 ? sizeIdx : parts.length > 1 ? parts.length - 1 : 0));
    return { ...v, color: colorParts.join(" / ") || null, size };
  });
}

export const normalizeCatalogColor = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[\s-]+/g, "-");

const EMPTY_FORM = { full_name: "", email: "", cep: "", address: "", address_number: "", complement: "", neighborhood: "", city: "", state: "" };

export default function LiveCatalogPublicPage() {
  const { eventSlug = "" } = useParams();
  const [params] = useSearchParams();
  const slug = eventSlug.toLowerCase();
  const attribution = useRef({
    utm_source: params.get("utm_source"), utm_campaign: params.get("utm_campaign"), g: params.get("g"), d: params.get("d"),
  });
  const focusId = params.get("p");
  const focusColor = params.get("cor");
  const autoOpened = useRef(false);
  const [ev, setEv] = useState<Ev | null>(null);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [error, setError] = useState<"expired" | "invalid" | null>(null);
  const [sel, setSel] = useState<Product | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const storeKey = `vitrine-cart:${slug}`;
  const [lines, setLines] = useState<Line[]>(() => { try { return JSON.parse(localStorage.getItem(storeKey) || "[]"); } catch { return []; } });
  const [cartOpen, setCartOpen] = useState(false);
  const [step, setStep] = useState<"cart" | "phone" | "data">("cart");
  const [phone, setPhone] = useState("");
  const [known, setKnown] = useState<{ first_name: string | null; city_hint: string | null } | null>(null);
  const [useSaved, setUseSaved] = useState(false);
  const [cpf, setCpf] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(lines)); } catch { /* armazenamento opcional */ } }, [lines, storeKey]);

  useEffect(() => {
    captureAttribution();
    call({ action: "open", slug, attribution: attribution.current }).then((d) => {
      if (!d?.ok) { setError(d?.error === "expired" ? "expired" : "invalid"); return; }
      setEv(d.event); setCatalog(d.catalog || []);
    }).catch(() => setError("invalid"));
  }, [slug]);

  const ordered = useMemo(() => {
    if (!focusId) return catalog;
    const f = catalog.find((p) => p.id === focusId || p.shopify_product_id === focusId || p.shopify_product_id?.endsWith(`/${focusId}`));
    return f ? [f, ...catalog.filter((p) => p !== f)] : catalog;
  }, [catalog, focusId]);
  const focused = focusId && ordered[0] && (ordered[0].id === focusId || ordered[0].shopify_product_id === focusId || ordered[0].shopify_product_id?.endsWith(`/${focusId}`)) ? ordered[0] : null;

  const openProduct = useCallback((p: Product, requestedColor?: string | null) => {
    const selectedColor = requestedColor ? parseVariants(p.variants).find((v) => v.color && normalizeCatalogColor(v.color) === normalizeCatalogColor(requestedColor))?.color ?? null : null;
    setSel(p); setColor(selectedColor); setQty(1);
    const avail = p.variants.filter((v) => v.available);
    setVariant(p.variants.length === 1 && avail.length === 1 ? avail[0].variant_id : null);
    call({ action: "view", slug, catalog_product_id: p.id, attribution: attribution.current }).catch(() => {});
    trackSelfservice("ViewContent", { content_ids: [p.shopify_product_id], content_type: "product", value: p.offer_price ?? p.original_price, currency: "BRL" });
  }, [slug]);

  useEffect(() => {
    if (!focused || autoOpened.current) return;
    autoOpened.current = true;
    openProduct(focused, focusColor);
  }, [focused, focusColor, openProduct]);

  const findLine = (l: Line) => {
    const p = catalog.find((x) => x.id === l.pid);
    const v = p?.variants.find((x) => x.variant_id === l.vid);
    return p && v ? { p, v } : null;
  };
  const validLines = lines.filter((l) => findLine(l));
  const subtotal = validLines.reduce((s, l) => { const r = findLine(l)!; return s + (r.p.offer_price ?? r.p.original_price) * l.qty; }, 0);
  const count = validLines.reduce((s, l) => s + l.qty, 0);

  const add = () => {
    if (!sel || !variant) return;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.pid === sel.id && l.vid === variant);
      if (i >= 0) { const n = [...ls]; n[i] = { ...n[i], qty: Math.min(10, n[i].qty + qty) }; return n; }
      return [...ls, { pid: sel.id, vid: variant, qty }];
    });
    setSel(null);
    if (focusId) { setStep("cart"); setCartOpen(true); }
    toast.success("Adicionado à sacola");
  };

  const goCheckout = () => { setStep("phone"); setCartOpen(true); trackSelfservice("InitiateCheckout", { value: subtotal, currency: "BRL" }); };

  const identify = async () => {
    if (onlyDigits(phone).length < 10) { setErrors({ phone: "Digite o WhatsApp com DDD." }); return; }
    setBusy(true); setErrors({});
    try {
      const d = await call({ action: "identify", slug, phone: onlyDigits(phone) });
      if (!d?.ok) { setErrors({ phone: d?.error || "Confira o número." }); return; }
      setKnown(d.known ? { first_name: d.first_name, city_hint: d.city_hint } : null);
      setUseSaved(!!d.known);
      setStep("data");
    } catch { toast.error("Não deu pra continuar, tenta de novo"); } finally { setBusy(false); }
  };

  const lookupCep = async (cep: string) => {
    if (cep.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json();
      if (!j?.erro) setForm((f) => ({ ...f, address: j.logradouro || f.address, neighborhood: j.bairro || f.neighborhood, city: j.localidade || f.city, state: j.uf || f.state }));
    } catch { /* preenchimento manual */ }
  };

  const submit = async () => {
    setBusy(true); setErrors({});
    try {
      const d = await call({
        action: "checkout", slug, phone: onlyDigits(phone), cpf: onlyDigits(cpf), use_saved: useSaved,
        form: useSaved ? undefined : { ...form, cep: onlyDigits(form.cep) },
        items: validLines.map((l) => ({ catalog_product_id: l.pid, variant_id: l.vid, quantity: l.qty })),
        attribution: attribution.current,
      });
      if (!d?.ok) {
        if (d?.errors) setErrors(d.errors); else if (d?.field) setErrors({ [d.field]: d.error });
        if (d?.field === "cpf" && useSaved && /não confere/.test(d.error || "")) setUseSaved(false);
        if (d?.sold_out?.length) {
          setCatalog((c) => c.map((p) => d.sold_out.includes(p.id) ? { ...p, sold_out: true, variants: p.variants.map((v) => ({ ...v, available: false })) } : p));
          setLines((ls) => ls.filter((l) => !d.sold_out.includes(l.pid)));
          setStep("cart");
        }
        toast.error(d?.error || "Confira os dados");
        return;
      }
      setLines([]);
      try { localStorage.removeItem(storeKey); } catch { /* opcional */ }
      window.location.href = d.cart_path;
    } catch { toast.error("Não deu pra concluir agora, tenta de novo"); } finally { setBusy(false); }
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div className="space-y-2">
          <Clock className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-bold">{error === "expired" ? "Essas ofertas já encerraram" : "Link indisponível"}</p>
          <p className="text-sm text-muted-foreground">Fique de olho no grupo que logo tem novidade 😊</p>
        </div>
      </div>
    );
  }
  if (!ev) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const card = (p: Product, big = false) => {
    const promo = p.offer_price != null;
    return (
        <button key={p.id} type="button" onClick={() => openProduct(p)}
        className={`group overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition active:scale-[0.98] ${big ? "col-span-2" : ""}`}>
        <div className="relative">
          <ProductImage src={p.image_url} alt={p.title} />
          {promo && <span className="absolute left-2 top-2 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-extrabold text-destructive-foreground">OFERTA</span>}
        </div>
        <div className="space-y-0.5 p-2.5">
          <p className={`line-clamp-2 font-medium leading-snug ${big ? "text-sm" : "text-xs"}`}>{p.title}</p>
          {promo && <p className="text-[11px] text-muted-foreground line-through">{brl(p.original_price)}</p>}
          <p className={`font-extrabold ${big ? "text-xl" : "text-base"}`}>{brl(promo ? p.offer_price! : p.original_price)}</p>
          <span className="mt-2 flex h-9 w-full items-center justify-center rounded-xl bg-foreground text-xs font-extrabold text-background">VER PRODUTO</span>
        </div>
      </button>
    );
  };

  const field = (k: keyof typeof EMPTY_FORM, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="text-xs font-semibold">{label}</label>
      <Input value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className={errors[k] ? "border-destructive" : ""} {...props} />
      {errors[k] && <p className="mt-0.5 text-xs text-destructive">{errors[k]}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="mx-auto max-w-md">
        <div className="relative overflow-hidden bg-gradient-to-br from-primary/20 via-primary/5 to-background px-4 pb-5 pt-6">
          <Sparkles className="absolute right-4 top-4 h-6 w-6 text-primary/40" />
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{ev.name}</p>
          <h1 className="mt-1 text-2xl font-extrabold leading-tight">Ofertas da live pra você 😊</h1>
          <p className="mt-1 text-sm text-muted-foreground">Escolha, coloque na sacola e pague sozinha por Pix ou cartão.</p>
        </div>

        {catalog.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Nenhum produto disponível agora.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4">
            {focused && card(focused, true)}
            {focused && <p className="col-span-2 pt-2 text-sm font-bold">Veja também</p>}
            {(focused ? ordered.slice(1) : ordered).map((p) => card(p))}
          </div>
        )}

        {ev.product_notice && <p className="px-4 text-center text-xs text-muted-foreground">{ev.product_notice}</p>}
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Banana Calçados · 10 anos · 2 lojas físicas em Gov. Valadares-MG</span>
            {ev.google_rating && ev.google_url && <a href={ev.google_url} target="_blank" rel="noreferrer" className="font-semibold text-foreground">{ev.google_rating} ★ no Google</a>}
          </div>
          <SelfServicePrivacy slug={eventSlug} />
          <p className="text-center text-xs text-muted-foreground">
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
            Único WhatsApp oficial da Banana: final <strong>{ev.official_last4 || "----"}</strong>. Qualquer outro número é golpe.
          </p>
        </div>
      </div>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-md items-center gap-3 p-3">
            <button type="button" onClick={() => { setStep("cart"); setCartOpen(true); }} className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border">
              <ShoppingBag className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{count}</span>
            </button>
            <p className="min-w-0 flex-1 text-xs font-bold">{count} {count === 1 ? "item" : "itens"} · {brl(subtotal)}</p>
            <Button className="h-12 font-extrabold" onClick={goCheckout}>FINALIZAR COMPRA</Button>
          </div>
        </div>
      )}

      <Drawer open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DrawerContent className="mx-auto max-h-[92vh] max-w-md">
          {sel && (() => {
            const promo = sel.offer_price != null;
            const baseImgs = sel.images.length ? sel.images : sel.image_url ? [sel.image_url] : [];
            const parsed = parseVariants(sel.variants.filter((v) => v.available));
            const colors = Array.from(new Set(parsed.map((v) => v.color).filter(Boolean))) as string[];
            const activeColor = colors.length ? (color && colors.includes(color) ? color : colors.length === 1 ? colors[0] : null) : null;
            const colorImg = activeColor ? parsed.find((v) => v.color === activeColor && v.image)?.image || null : null;
            const imgs = colorImg ? [colorImg, ...baseImgs.filter((x) => x !== colorImg)] : baseImgs;
            const sizes = parsed.filter((v) => !colors.length || v.color === activeColor)
              .sort((a, b) => parseFloat(a.size.replace(",", ".")) - parseFloat(b.size.replace(",", ".")) || a.size.localeCompare(b.size));
            return (
              <div className="overflow-y-auto pb-4">
                <Carousel key={colorImg || "base"} className="w-full">
                  <CarouselContent>
                    {imgs.map((src, i) => <CarouselItem key={i}><div className="px-4"><div className="overflow-hidden rounded-2xl"><ProductImage src={src} alt={sel.title} /></div></div></CarouselItem>)}
                  </CarouselContent>
                </Carousel>
                <DrawerHeader className="pb-2 text-left">
                  <DrawerTitle className="leading-snug">{sel.title}</DrawerTitle>
                  <div className="flex items-baseline gap-2">
                    {promo && <span className="text-sm text-muted-foreground line-through">{brl(sel.original_price)}</span>}
                    <span className="text-2xl font-extrabold">{brl(promo ? sel.offer_price! : sel.original_price)}</span>
                  </div>
                </DrawerHeader>
                <div className="space-y-4 px-4">
                  {colors.length > 0 && (
                    <div>
                      <p className="mb-2 text-sm font-semibold">Escolha a cor</p>
                      <div className="flex flex-wrap gap-2">
                        {colors.map((c) => {
                          const any = parsed.some((v) => v.color === c && v.available);
                          return (
                            <button key={c} type="button" disabled={!any} onClick={() => { setColor(c); setVariant(null); }}
                              className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold transition disabled:opacity-40 ${activeColor === c ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                              {c}{!any && " · esgotado"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {(!colors.length || activeColor) && (
                    <div>
                      <p className="mb-2 text-sm font-semibold">Escolha a numeração</p>
                      <div className="flex flex-wrap gap-2">
                        {sizes.map((v) => (
                          <button key={v.variant_id} type="button" disabled={!v.available} onClick={() => setVariant(v.variant_id)}
                            className={`min-w-12 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition disabled:line-through disabled:opacity-40 ${variant === v.variant_id ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                            {v.size}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">Quantidade</span>
                    <Button size="icon" variant="outline" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus className="h-4 w-4" /></Button>
                    <span className="w-6 text-center font-bold">{qty}</span>
                    <Button size="icon" variant="outline" onClick={() => setQty((q) => Math.min(10, q + 1))}><Plus className="h-4 w-4" /></Button>
                  </div>
                  <Button className="h-14 w-full text-base font-extrabold" disabled={!variant} onClick={add}>COLOCAR NA SACOLA</Button>
                </div>
              </div>
            );
          })()}
        </DrawerContent>
      </Drawer>

      <Drawer open={cartOpen} onOpenChange={setCartOpen}>
        <DrawerContent className="mx-auto max-h-[92vh] max-w-md">
          <DrawerHeader><DrawerTitle>{step === "cart" ? "Sua sacola" : step === "phone" ? "Seu WhatsApp" : "Seus dados para entrega"}</DrawerTitle></DrawerHeader>
          <div className="space-y-3 overflow-y-auto px-4 pb-6">
            {step === "cart" && (
              <>
                {validLines.map((l) => {
                  const { p, v } = findLine(l)!;
                  return (
                    <div key={`${l.pid}-${l.vid}`} className="flex items-center gap-3 rounded-xl border p-2">
                      {(v.image || p.image_url) && <img src={v.image || p.image_url!} alt={p.title} className="h-14 w-14 rounded-lg object-cover" />}
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="truncate font-medium">{p.title}</p>
                        <p className="text-xs text-muted-foreground">{v.title} · {l.qty}x {brl(p.offer_price ?? p.original_price)}</p>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x !== l))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  );
                })}
                <p className="flex justify-between text-sm font-bold"><span>Produtos</span><span>{brl(subtotal)}</span></p>
                <p className="text-xs text-muted-foreground">Frete e cashback são calculados na próxima tela.</p>
                {count > 0 && <Button className="h-12 w-full font-extrabold" onClick={goCheckout}>FINALIZAR COMPRA</Button>}
              </>
            )}
            {step === "phone" && (
              <>
                <p className="text-sm text-muted-foreground">Digite seu WhatsApp com DDD. Se você já comprou com a gente, a gente encontra seu cadastro.</p>
                <Input inputMode="tel" placeholder="(33) 99999-9999" value={maskPhone(phone)} onChange={(e) => setPhone(onlyDigits(e.target.value))} className={errors.phone ? "border-destructive" : ""} autoFocus />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
                <Button className="h-12 w-full font-extrabold" disabled={busy} onClick={identify}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "CONTINUAR"}</Button>
              </>
            )}
            {step === "data" && (
              <>
                {known && (
                  <div className="rounded-xl border bg-muted/40 p-3 text-sm">
                    <p className="font-bold">Oi{known.first_name ? `, ${known.first_name}` : ""}! Achamos seu cadastro {known.city_hint ? `(${known.city_hint})` : ""}.</p>
                    <label className="mt-2 flex items-center gap-2">
                      <input type="checkbox" checked={useSaved} onChange={(e) => setUseSaved(e.target.checked)} />
                      Usar meu endereço cadastrado
                    </label>
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold">CPF {useSaved && "(para confirmar que é você)"}</label>
                  <Input inputMode="numeric" value={maskCpf(cpf)} onChange={(e) => setCpf(onlyDigits(e.target.value))} className={errors.cpf ? "border-destructive" : ""} />
                  {errors.cpf && <p className="mt-0.5 text-xs text-destructive">{errors.cpf}</p>}
                </div>
                {!useSaved && (
                  <>
                    {field("full_name", "Nome completo", { autoComplete: "name" })}
                    {field("email", "E-mail", { type: "email", autoComplete: "email" })}
                    <div>
                      <label className="text-xs font-semibold">CEP</label>
                      <Input inputMode="numeric" value={maskCep(form.cep)} className={errors.cep ? "border-destructive" : ""}
                        onChange={(e) => { const c = onlyDigits(e.target.value).slice(0, 8); setForm((f) => ({ ...f, cep: c })); lookupCep(c); }} />
                      {errors.cep && <p className="mt-0.5 text-xs text-destructive">{errors.cep}</p>}
                    </div>
                    {field("address", "Rua")}
                    <div className="grid grid-cols-2 gap-2">{field("address_number", "Número")}{field("complement", "Complemento")}</div>
                    {field("neighborhood", "Bairro")}
                    <div className="grid grid-cols-[1fr_5rem] gap-2">{field("city", "Cidade")}{field("state", "UF", { maxLength: 2 })}</div>
                  </>
                )}
                <Button className="h-12 w-full font-extrabold" disabled={busy} onClick={submit}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "IR PARA O PAGAMENTO"}</Button>
                <button type="button" className="w-full text-center text-xs text-muted-foreground underline" onClick={() => setStep("phone")}>Trocar WhatsApp</button>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
