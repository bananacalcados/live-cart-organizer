import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { toast } from "sonner";
import { ShoppingBag, X, ChevronLeft, Instagram, Phone, Loader2, Check, Trash2, Plus, Minus, Sparkles } from "lucide-react";

// ─── Types ───
interface PageConfig {
  id: string;
  title: string;
  subtitle: string | null;
  theme_config: { primaryColor: string; secondaryColor: string; backgroundGradient: string };
  selected_product_ids: string[];
  require_registration: boolean;
  whatsapp_numbers: Array<{ name: string; number: string }>;
  shipping_cost: number;
}

interface CatalogProduct {
  id: string;
  title: string;
  handle: string;
  imageUrl: string;
  price: string;
  compareAtPrice: string | null;
  variants: CatalogVariant[];
}

interface CatalogVariant {
  id: string;
  gid: string;
  color: string | null;
  size: string | null;
  label: string;
  price: string;
  compareAtPrice: string | null;
  imageUrl: string;
  available: boolean;
  sku: string | null;
}

interface CartItem {
  productId: string;
  productTitle: string;
  variant: CatalogVariant;
  quantity: number;
  imageUrl: string;
}

// ─── Helpers ───
function buildProductMap(raw: ShopifyProduct[]): Map<string, CatalogProduct> {
  const map = new Map<string, CatalogProduct>();
  for (const sp of raw) {
    const fallbackImg = sp.node.images.edges[0]?.node.url || "";
    const variants: CatalogVariant[] = [];
    for (const ve of sp.node.variants.edges) {
      const v = ve.node;
      if (!v.availableForSale) continue;
      let color: string | null = null;
      let size: string | null = null;
      for (const opt of v.selectedOptions) {
        const n = opt.name.toLowerCase();
        if (n === "cor" || n === "color" || n === "colour") color = opt.value;
        if (n === "tamanho" || n === "size") size = opt.value;
      }
      const parts = v.selectedOptions.filter(o => o.value !== "Default Title").map(o => o.value);
      variants.push({
        id: v.id.split("/").pop() || v.id,
        gid: v.id,
        color, size,
        label: parts.join(" / "),
        price: v.price.amount,
        compareAtPrice: v.compareAtPrice?.amount || null,
        imageUrl: v.image?.url || fallbackImg,
        available: v.availableForSale,
        sku: v.sku || null,
      });
    }
    if (variants.length === 0) continue;
    const defaultV = variants[0];
    map.set(sp.node.id, {
      id: sp.node.id,
      title: sp.node.title,
      handle: sp.node.handle,
      imageUrl: defaultV.imageUrl || fallbackImg,
      price: sp.node.priceRange.minVariantPrice.amount,
      compareAtPrice: variants[0].compareAtPrice,
      variants,
    });
  }
  return map;
}

const fmt = (v: string | number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatPhone = (value: string) => {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

const DEFAULT_STORE_ID = "4ade7b44-5043-4ab1-a124-7a6ab5468e29";
const CHECKOUT_BASE_URL = "https://checkout.bananacalcados.com.br";

// ─── Component ───
export default function CatalogLeadPage() {
  const { slug } = useParams<{ slug: string }>();
  const [config, setConfig] = useState<PageConfig | null>(null);
  const [productMap, setProductMap] = useState<Map<string, CatalogProduct>>(new Map());
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);

  // Track newly added/boosted products for highlight animation
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<string[]>([]);

  // Registration
  const [registered, setRegistered] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [instagram, setInstagram] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [registrationId, setRegistrationId] = useState<string | null>(null);

  // Product detail
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<CatalogVariant | null>(null);

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [cartBounce, setCartBounce] = useState(false);
  const [shippingAlreadyPaid, setShippingAlreadyPaid] = useState(false);

  // Check if already registered
  useEffect(() => {
    const key = `catalog_lead_${slug}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      setRegistered(true);
      try {
        const parsed = JSON.parse(stored);
        if (parsed.registrationId) setRegistrationId(parsed.registrationId);
        if (parsed.instagram) setInstagram(parsed.instagram);
        if (parsed.whatsapp) setWhatsapp(parsed.whatsapp);
        if (parsed.shippingPaid) setShippingAlreadyPaid(true);
      } catch { /* ignore */ }
    }
  }, [slug]);

  // Check if customer already paid shipping in a previous purchase on this catalog
  useEffect(() => {
    if (!config?.id || !whatsapp || shippingAlreadyPaid) return;
    const phoneClean = whatsapp.replace(/\D/g, "");
    if (phoneClean.length < 8) return;
    (async () => {
      // Find any completed registration for this catalog with this phone
      const { data: regs } = await supabase
        .from("catalog_lead_registrations")
        .select("checkout_sale_id, status")
        .eq("catalog_page_id", config.id)
        .eq("status", "completed")
        .ilike("whatsapp", `%${phoneClean.slice(-8)}%`);
      if (!regs || regs.length === 0) return;
      
      for (const reg of regs) {
        if (!reg.checkout_sale_id) continue;
        const { data: sale } = await supabase
          .from("pos_sales")
          .select("*")
          .eq("id", reg.checkout_sale_id)
          .maybeSingle();
        if (sale && Number((sale as any).shipping_cost) > 0 && sale.status === "completed") {
          setShippingAlreadyPaid(true);
          const key = `catalog_lead_${slug}`;
          const stored = JSON.parse(localStorage.getItem(key) || "{}");
          localStorage.setItem(key, JSON.stringify({ ...stored, shippingPaid: true }));
          return;
        }
      }
    })();
  }, [config?.id, whatsapp, slug, shippingAlreadyPaid]);

  // Load config
  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("catalog_lead_pages")
        .select("*")
        .eq("slug", slug)
        .eq("is_active", true)
        .maybeSingle();
      if (error || !data) { setLoading(false); return; }
      const cfg = data as any;
      setConfig({
        id: cfg.id,
        title: cfg.title,
        subtitle: cfg.subtitle,
        theme_config: cfg.theme_config || { primaryColor: "#00BFA6", secondaryColor: "#00897B", backgroundGradient: "linear-gradient(160deg, #00BFA6 0%, #00897B 50%, #004D40 100%)" },
        selected_product_ids: cfg.selected_product_ids || [],
        require_registration: cfg.require_registration ?? true,
        whatsapp_numbers: cfg.whatsapp_numbers || [],
        shipping_cost: Number(cfg.shipping_cost) || 0,
      });
      prevIdsRef.current = cfg.selected_product_ids || [];
      supabase.from("catalog_lead_pages").update({ views: (cfg.views || 0) + 1 } as any).eq("id", cfg.id).then();
      setLoading(false);
    })();
  }, [slug]);

  // Subscribe to realtime changes on this page
  useEffect(() => {
    if (!config?.id) return;
    const channel = supabase
      .channel(`catalog-lead-${config.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "catalog_lead_pages", filter: `id=eq.${config.id}` },
        (payload) => {
          const newData = payload.new as any;
          const newIds: string[] = newData.selected_product_ids || [];
          const oldIds = prevIdsRef.current;

          // Detect newly added or boosted-to-front products
          const newHighlights = new Set<string>();
          // Products that are new (not in old list)
          for (const id of newIds) {
            if (!oldIds.includes(id)) newHighlights.add(id);
          }
          // Product moved to position 0 that wasn't there before
          if (newIds[0] && newIds[0] !== oldIds[0]) {
            newHighlights.add(newIds[0]);
          }

          if (newHighlights.size > 0) {
            setHighlightedIds(newHighlights);
            setTimeout(() => setHighlightedIds(new Set()), 5000);
          }

          prevIdsRef.current = newIds;

          setConfig(prev => prev ? {
            ...prev,
            title: newData.title || prev.title,
            subtitle: newData.subtitle,
            selected_product_ids: newIds,
            theme_config: newData.theme_config || prev.theme_config,
            shipping_cost: Number(newData.shipping_cost) || 0,
          } : prev);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [config?.id]);

  // Load products after config (and when product IDs change, load any new ones)
  useEffect(() => {
    if (!config) return;
    (async () => {
      setProductsLoading(true);
      const raw = await fetchProducts(250);
      setProductMap(buildProductMap(raw));
      setProductsLoading(false);
    })();
  }, [config?.id]); // Only reload shopify products on initial load

  // Build ordered product list from config.selected_product_ids
  const orderedProducts: CatalogProduct[] = (config?.selected_product_ids || [])
    .map(id => productMap.get(id))
    .filter(Boolean) as CatalogProduct[];

  const handleRegister = async () => {
    const igClean = instagram.trim().replace(/^@/, "");
    const phoneClean = whatsapp.replace(/\D/g, "");
    if (!igClean) { toast.error("Digite seu @ do Instagram"); return; }
    if (phoneClean.length < 10) { toast.error("WhatsApp inválido"); return; }
    setRegLoading(true);
    try {
      const { data: regData } = await supabase.from("catalog_lead_registrations").insert({
        catalog_page_id: config!.id,
        instagram_handle: igClean,
        whatsapp: phoneClean,
        status: "browsing",
      } as any).select("id").single();

      await supabase.from("lp_leads" as any).insert({
        instagram: igClean,
        phone: phoneClean,
        campaign_tag: `catalogo-lead-${slug}`,
        source: "catalog_lead_page",
      } as any);

      supabase.from("catalog_lead_pages").update({ leads_count: ((config as any).leads_count || 0) + 1 } as any).eq("id", config!.id).then();

      const regId = (regData as any)?.id || null;
      setRegistrationId(regId);
      localStorage.setItem(`catalog_lead_${slug}`, JSON.stringify({ instagram: igClean, whatsapp: phoneClean, registrationId: regId }));
      setRegistered(true);
      setRegOpen(false);
      toast.success("Cadastro feito! Agora escolha seus produtos 🎉");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao cadastrar");
    }
    setRegLoading(false);
  };

  const handleProductClick = (product: CatalogProduct) => {
    if (config?.require_registration && !registered) {
      setSelectedProduct(product);
      setRegOpen(true);
      return;
    }
    setSelectedProduct(product);
    setSelectedVariant(null);
  };

  // Persist cart to DB whenever it changes
  useEffect(() => {
    if (!registrationId || cart.length === 0) return;
    const cartData = cart.map(c => ({
      title: c.productTitle,
      variant: c.variant.label,
      sku: c.variant.sku,
      price: Number(c.variant.price),
      quantity: c.quantity,
      image: c.imageUrl,
      variantGid: c.variant.gid,
    }));
    const total = cart.reduce((s, c) => s + Number(c.variant.price) * c.quantity, 0);
    supabase.from("catalog_lead_registrations").update({
      cart_items: cartData,
      cart_total: total,
      status: "cart_created",
    } as any).eq("id", registrationId).then();
  }, [cart, registrationId]);

  const addToCart = () => {
    if (!selectedProduct || !selectedVariant) return;
    const existing = cart.find(c => c.variant.gid === selectedVariant.gid);
    if (existing) {
      setCart(cart.map(c => c.variant.gid === selectedVariant.gid ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, {
        productId: selectedProduct.id,
        productTitle: selectedProduct.title,
        variant: selectedVariant,
        quantity: 1,
        imageUrl: selectedVariant.imageUrl || selectedProduct.imageUrl,
      }]);
    }
    setCartBounce(true);
    setTimeout(() => setCartBounce(false), 600);
    toast.success("Adicionado ao carrinho!");
    setSelectedProduct(null);
    setSelectedVariant(null);
  };

  const removeFromCart = (variantGid: string) => setCart(cart.filter(c => c.variant.gid !== variantGid));
  const updateQty = (variantGid: string, delta: number) => {
    setCart(cart.map(c => {
      if (c.variant.gid !== variantGid) return c;
      return { ...c, quantity: Math.max(1, c.quantity + delta) };
    }));
  };

  const cartSubtotal = cart.reduce((s, c) => s + Number(c.variant.price) * c.quantity, 0);
  const shippingCost = shippingAlreadyPaid ? 0 : (config?.shipping_cost || 0);
  const cartTotal = cartSubtotal + shippingCost;

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setCheckoutLoading(true);
    try {
      if (registrationId) {
        await supabase.from("catalog_lead_registrations").update({
          cart_items: cart.map(c => ({
            title: c.productTitle,
            variant: c.variant.label,
            sku: c.variant.sku,
            price: Number(c.variant.price),
            quantity: c.quantity,
            image: c.imageUrl,
            variantGid: c.variant.gid,
          })),
          cart_total: cartTotal,
          status: "checkout_started",
        } as any).eq("id", registrationId);
      }

      const stored = JSON.parse(localStorage.getItem(`catalog_lead_${slug}`) || "{}");
      const { data: sale, error: saleError } = await supabase.from("pos_sales").insert({
        store_id: DEFAULT_STORE_ID,
        sale_type: "online",
        status: "pending",
        subtotal: cartSubtotal,
        total: cartTotal,
        discount: 0,
        customer_name: stored.instagram ? `@${stored.instagram}` : null,
        customer_phone: stored.whatsapp || null,
        notes: `Catálogo Lead: ${slug} | IG: @${stored.instagram || ""}${shippingCost > 0 ? ` | Frete: R$${shippingCost.toFixed(2)}` : ""}`,
        checkout_step: 0,
        payment_details: { shipping_amount: shippingCost },
      } as any).select("id").single();

      if (saleError) throw saleError;

      const items = cart.map(c => ({
        sale_id: sale.id,
        sku: c.variant.sku || `CAT-${c.variant.id}`,
        product_name: c.productTitle,
        variant_name: c.variant.label,
        quantity: c.quantity,
        unit_price: Number(c.variant.price),
        total_price: Number(c.variant.price) * c.quantity,
      }));

      await supabase.from("pos_sale_items").insert(items);

      if (registrationId) {
        await supabase.from("catalog_lead_registrations").update({
          checkout_sale_id: sale.id,
          status: "checkout_started",
        } as any).eq("id", registrationId);
      }

      window.location.href = `${CHECKOUT_BASE_URL}/checkout-loja/${DEFAULT_STORE_ID}/${sale.id}`;
    } catch (e) {
      console.error(e);
      toast.error("Erro ao iniciar checkout");
    }
    setCheckoutLoading(false);
  };

  const theme = config?.theme_config || { primaryColor: "#00BFA6", secondaryColor: "#00897B", backgroundGradient: "linear-gradient(160deg, #00BFA6 0%, #00897B 50%, #004D40 100%)" };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: theme.backgroundGradient }}>
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: theme.backgroundGradient }}>
        <p className="text-white text-lg">Catálogo não encontrado</p>
      </div>
    );
  }

  // ─── Cart Drawer ───
  const cartDrawer = cartOpen && (
    <div className="fixed inset-0 z-50 flex" onClick={() => setCartOpen(false)}>
      <div className="flex-1 bg-black/50" />
      <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" /> Carrinho ({cart.length})
          </h3>
          <button onClick={() => setCartOpen(false)} className="p-1"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Carrinho vazio</p>
          ) : cart.map(item => (
            <div key={item.variant.gid} className="flex gap-3 p-3 bg-gray-50 rounded-xl">
              <img src={item.imageUrl} alt={item.productTitle} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold line-clamp-1">{item.productTitle}</p>
                <p className="text-xs text-gray-500">{item.variant.label}</p>
                <p className="text-sm font-bold mt-1" style={{ color: theme.primaryColor }}>{fmt(item.variant.price)}</p>
                <div className="flex items-center gap-2 mt-1">
                  <button onClick={() => updateQty(item.variant.gid, -1)} className="w-6 h-6 rounded-full border flex items-center justify-center text-gray-500 hover:bg-gray-100">
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="text-sm font-medium w-6 text-center">{item.quantity}</span>
                  <button onClick={() => updateQty(item.variant.gid, 1)} className="w-6 h-6 rounded-full border flex items-center justify-center text-gray-500 hover:bg-gray-100">
                    <Plus className="h-3 w-3" />
                  </button>
                  <button onClick={() => removeFromCart(item.variant.gid)} className="ml-auto p-1 text-red-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {cart.length > 0 && (
          <div className="border-t p-4 space-y-3">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span>{fmt(cartSubtotal)}</span>
            </div>
            {shippingAlreadyPaid ? (
              <div className="flex justify-between text-sm text-emerald-600 font-medium">
                <span>📦 Frete</span>
                <span>✅ Já pago</span>
              </div>
            ) : shippingCost > 0 ? (
              <div className="flex justify-between text-sm text-gray-600">
                <span>📦 Frete</span>
                <span>{fmt(shippingCost)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-bold text-lg border-t pt-2">
              <span>Total</span>
              <span style={{ color: theme.primaryColor }}>{fmt(cartTotal)}</span>
            </div>
            <button onClick={handleCheckout} disabled={checkoutLoading}
              className="w-full py-4 rounded-xl text-white font-black text-lg flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-60 uppercase tracking-wider shadow-lg"
              style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})` }}>
              {checkoutLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "💳"}
              PAGAR AGORA
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Product Detail View ───
  if (selectedProduct && registered) {
    const uniqueSizes = [...new Set(selectedProduct.variants.filter(v => v.size).map(v => v.size!))];
    const uniqueColors = [...new Set(selectedProduct.variants.filter(v => v.color).map(v => v.color!))];

    return (
      <div className="min-h-screen" style={{ background: theme.backgroundGradient }}>
        {cartDrawer}
        {cart.length > 0 && (
          <button onClick={() => setCartOpen(true)}
            className={`fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-white text-xl active:scale-90 transition-transform ${cartBounce ? "animate-bounce" : ""}`}
            style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})` }}>
            🛒
            <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">{cart.reduce((s, c) => s + c.quantity, 0)}</span>
          </button>
        )}

        <div className="max-w-lg mx-auto px-4 py-6">
          <button onClick={() => { setSelectedProduct(null); setSelectedVariant(null); }} className="flex items-center gap-1 text-white/80 hover:text-white mb-4 text-sm">
            <ChevronLeft className="h-4 w-4" />Voltar
          </button>
          <div className="bg-white rounded-2xl overflow-hidden shadow-xl">
            <img src={selectedVariant?.imageUrl || selectedProduct.imageUrl} alt={selectedProduct.title} className="w-full aspect-square object-cover" />
            <div className="p-4 space-y-4">
              <h2 className="text-lg font-bold text-gray-900">{selectedProduct.title}</h2>
              <div className="flex items-center gap-2">
                {selectedVariant?.compareAtPrice && Number(selectedVariant.compareAtPrice) > Number(selectedVariant.price) && (
                  <span className="text-sm line-through text-gray-400">{fmt(selectedVariant.compareAtPrice)}</span>
                )}
                <span className="text-xl font-bold" style={{ color: theme.primaryColor }}>
                  {fmt(selectedVariant?.price || selectedProduct.price)}
                </span>
              </div>

              {uniqueSizes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">Tamanho</p>
                  <div className="flex flex-wrap gap-2">
                    {uniqueSizes.map(s => {
                      const isSelected = selectedVariant?.size === s;
                      return (
                        <button key={s} onClick={() => {
                          const v = selectedProduct.variants.find(v => v.size === s && (selectedVariant?.color ? v.color === selectedVariant.color : true))
                            || selectedProduct.variants.find(v => v.size === s);
                          if (v) setSelectedVariant(v);
                        }}
                          className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${isSelected ? "text-white border-transparent" : "text-gray-700 border-gray-300 hover:border-gray-500"}`}
                          style={isSelected ? { background: theme.primaryColor } : {}}>
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {uniqueColors.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">Cor</p>
                  <div className="flex flex-wrap gap-2">
                    {uniqueColors.map(c => {
                      const isSelected = selectedVariant?.color === c;
                      return (
                        <button key={c} onClick={() => {
                          const v = selectedProduct.variants.find(v => v.color === c && (selectedVariant?.size ? v.size === selectedVariant.size : true))
                            || selectedProduct.variants.find(v => v.color === c);
                          if (v) setSelectedVariant(v);
                        }}
                          className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${isSelected ? "text-white border-transparent" : "text-gray-700 border-gray-300 hover:border-gray-500"}`}
                          style={isSelected ? { background: theme.primaryColor } : {}}>
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedVariant && (
                <button onClick={addToCart}
                  className="w-full py-3 rounded-xl text-white font-bold text-base flex items-center justify-center gap-2 active:scale-95 transition-transform"
                  style={{ background: theme.primaryColor }}>
                  <ShoppingBag className="h-5 w-5" />
                  Adicionar ao Carrinho
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Registration Modal ───
  const registrationModal = regOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setRegOpen(false)}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="text-center">
          <h3 className="text-lg font-bold text-gray-900">Cadastre-se para ver as opções! 🎉</h3>
          <p className="text-sm text-gray-500 mt-1">Digite seu Instagram e WhatsApp</p>
        </div>
        <div className="space-y-3">
          <div className="relative">
            <Instagram className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <input type="text" placeholder="@seu_instagram" value={instagram} onChange={e => setInstagram(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div className="relative">
            <Phone className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <input type="tel" placeholder="(33) 99999-9999" value={whatsapp} onChange={e => setWhatsapp(formatPhone(e.target.value))}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
        </div>
        <button onClick={handleRegister} disabled={regLoading}
          className="w-full py-3 rounded-xl text-white font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
          style={{ background: theme.primaryColor }}>
          {regLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
          Cadastrar e Ver Produtos
        </button>
      </div>
    </div>
  );

  // ─── Product Grid (ordered by selected_product_ids) ───
  return (
    <div className="min-h-screen" style={{ background: theme.backgroundGradient }}>
      {registrationModal}
      {cartDrawer}

      {cart.length > 0 && (
        <button onClick={() => setCartOpen(true)}
          className={`fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-white text-xl active:scale-90 transition-transform ${cartBounce ? "animate-bounce" : ""}`}
          style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})` }}>
          🛒
          <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">{cart.reduce((s, c) => s + c.quantity, 0)}</span>
        </button>
      )}

      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-black text-white tracking-wider drop-shadow-lg">🍌 BANANA</h2>
          <p className="text-xs font-bold text-white/80 tracking-[0.3em] -mt-1">CALÇADOS</p>
          <h1 className="text-xl font-bold text-white mt-3">{config.title}</h1>
          {config.subtitle && <p className="text-sm text-white/80 mt-1">{config.subtitle}</p>}
        </div>

        {productsLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>
        ) : orderedProducts.length === 0 ? (
          <p className="text-center text-white/70">Nenhum produto disponível</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {orderedProducts.map((p, idx) => {
              const hasDiscount = p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price);
              const inCart = cart.some(c => c.productId === p.id);
              const isHighlighted = highlightedIds.has(p.id);
              return (
                <button key={p.id} onClick={() => handleProductClick(p)}
                  className={`bg-white rounded-xl overflow-hidden shadow-lg text-left active:scale-95 transition-all duration-500 ${inCart ? "ring-2 ring-emerald-500 ring-offset-1" : ""} ${isHighlighted ? "ring-2 ring-yellow-400 ring-offset-2 scale-[1.02] shadow-yellow-400/40 shadow-2xl" : ""}`}
                  style={isHighlighted ? { animation: "pulse 1.5s ease-in-out 3" } : {}}>
                  <div className="relative">
                    <img src={p.imageUrl} alt={p.title} className="w-full aspect-square object-cover" />
                    {isHighlighted && (
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-yellow-400 text-yellow-900 text-[10px] font-bold flex items-center gap-1 shadow-lg animate-bounce">
                        <Sparkles className="h-3 w-3" />NOVO
                      </div>
                    )}
                    {inCart && (
                      <div className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ background: theme.primaryColor }}>
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-xs font-semibold text-gray-900 line-clamp-2 leading-tight">{p.title}</p>
                    <div className="mt-1 flex items-center gap-1">
                      {hasDiscount && <span className="text-[10px] line-through text-gray-400">{fmt(p.compareAtPrice!)}</span>}
                      <span className="text-sm font-bold" style={{ color: theme.primaryColor }}>{fmt(p.price)}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">{p.variants.length} opção(ões)</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {cart.length > 0 && (
          <>
            <div className="h-24" />
            <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-white/95 backdrop-blur-sm border-t shadow-2xl">
              <div className="max-w-lg mx-auto flex items-center gap-3">
                <button onClick={() => setCartOpen(true)} className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  🛒 <span className="font-bold">{cart.reduce((s, c) => s + c.quantity, 0)}</span> itens
                  {shippingAlreadyPaid ? <span className="text-[10px] text-emerald-500">(frete grátis ✅)</span> : shippingCost > 0 && <span className="text-[10px] text-gray-400">(+frete)</span>}
                </button>
                <div className="flex-1 text-right">
                  <span className="text-lg font-black" style={{ color: theme.primaryColor }}>{fmt(cartTotal)}</span>
                </div>
                <button onClick={handleCheckout} disabled={checkoutLoading}
                  className="px-6 py-3 rounded-xl text-white font-black text-sm uppercase tracking-wider flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-60 shadow-lg"
                  style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})` }}>
                  {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "💳"}
                  PAGAR AGORA
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
