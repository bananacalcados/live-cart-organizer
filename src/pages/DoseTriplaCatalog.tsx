import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { createYampiPaymentLinkFromOrder } from "@/lib/yampi";
import type { DbOrderProduct } from "@/types/database";
import { toast } from "sonner";

type Step = "welcome" | "category" | "products" | "cart";

// ─── Default config ───

const DEFAULT_CATEGORIES: Array<{ key: string; label: string; emoji: string }> = [
  { key: "todos", label: "Todos", emoji: "👟" },
  { key: "tenis", label: "Tênis", emoji: "👟" },
  { key: "salto", label: "Salto", emoji: "👠" },
  { key: "papete", label: "Papete", emoji: "🩴" },
  { key: "rasteira", label: "Rasteira", emoji: "🥿" },
  { key: "sandalia", label: "Sandália", emoji: "👡" },
  { key: "bota", label: "Bota", emoji: "🥾" },
];

const DEFAULT_WHATSAPP_STORES = [
  { name: "Banana Calçados", number: "5533936180084" },
  { name: "Zoppy", number: "5533935050288" },
];

const DEFAULT_COMBOS = [
  { qty: "1 par", price: "R$ 150" },
  { qty: "2 pares", price: "R$ 240" },
  { qty: "3 pares", price: "R$ 300" },
];

const DEFAULT_THEME = {
  primaryColor: "#00BFA6",
  secondaryColor: "#00897B",
  accentColor: "#004D40",
  buttonWhatsappColor: "#25D366",
  buttonStoreColor: "#7C3AED",
  backgroundGradient: "linear-gradient(160deg, #00BFA6 0%, #00897B 50%, #004D40 100%)",
};

// ─── Types ───

interface PageConfig {
  welcome_title: string;
  welcome_subtitle: string | null;
  cta_text: string;
  payment_info: string | null;
  combo_tiers: Array<{ qty: string; price: string }>;
  categories: Array<{ key: string; label: string; emoji: string }>;
  whatsapp_numbers: Array<{ name: string; number: string }>;
  selected_product_ids: string[];
  product_filter: { sizeFilter: string; filterBySize: boolean };
  store_base_url: string;
  theme: typeof DEFAULT_THEME;
}

type CategoryKey = string;

interface FilteredProduct {
  id: string;
  title: string;
  handle: string;
  imageUrl: string;
  price: string;
  compareAtPrice: string | null;
  variantId: string;
  variantGid: string;
  sku: string | null;
  color: string;
  category: CategoryKey;
}

// ─── Helpers ───

function getNextStoreIndex(key: string, total: number): number {
  const current = Number(localStorage.getItem(key) || "0");
  const next = (current + 1) % total;
  localStorage.setItem(key, String(next));
  return current;
}

function categorizeProduct(title: string): CategoryKey {
  const t = title.toLowerCase();
  if (t.includes("tênis") || t.includes("tenis")) return "tenis";
  if (t.includes("salto") || t.includes("scarpin") || t.includes("mule")) return "salto";
  if (t.includes("papete") || t.includes("papette")) return "papete";
  if (t.includes("rasteira") || t.includes("rasteirinha")) return "rasteira";
  if (t.includes("sandália") || t.includes("sandalia") || t.includes("tamanco")) return "sandalia";
  if (t.includes("bota") || t.includes("coturno") || t.includes("ankle")) return "bota";
  return "todos";
}

function extractColor(product: ShopifyProduct): string {
  const colorOption = product.node.variants.edges
    .flatMap((v) => v.node.selectedOptions)
    .find((opt) => opt.name.toLowerCase() === "cor" || opt.name.toLowerCase() === "color");
  return colorOption?.value || "";
}

function filterProducts(products: ShopifyProduct[], config: PageConfig): FilteredProduct[] {
  const result: FilteredProduct[] = [];
  const selectedIds = new Set(config.selected_product_ids || []);
  const hasManualSelection = selectedIds.size > 0;

  for (const product of products) {
    if (hasManualSelection && !selectedIds.has(product.node.id)) continue;

    let targetVariant = product.node.variants.edges[0];

    if (config.product_filter.filterBySize && config.product_filter.sizeFilter) {
      const sizeVariant = product.node.variants.edges.find((v) =>
        v.node.selectedOptions.some(
          (opt) =>
            (opt.name.toLowerCase() === "tamanho" || opt.name.toLowerCase() === "size") &&
            opt.value === config.product_filter.sizeFilter
        )
      );
      if (sizeVariant) {
        targetVariant = sizeVariant;
      } else if (!hasManualSelection) {
        continue;
      }
    }

    if (!targetVariant || !targetVariant.node.availableForSale) continue;

    const imageUrl = product.node.images.edges[0]?.node.url || "";
    const color = extractColor(product);
    const gid = targetVariant.node.id;
    const numericId = gid.split("/").pop() || gid;

    result.push({
      id: product.node.id,
      title: product.node.title,
      handle: product.node.handle,
      imageUrl,
      price: targetVariant.node.price.amount,
      compareAtPrice: targetVariant.node.compareAtPrice?.amount || null,
      variantId: numericId,
      variantGid: gid,
      sku: targetVariant.node.sku || null,
      color,
      category: categorizeProduct(product.node.title),
    });
  }
  return result;
}

function parseComboPrice(priceStr: string): number {
  const match = priceStr.replace(/[^\d,\.]/g, "").replace(",", ".");
  return parseFloat(match) || 0;
}

function getComboTotal(cart: FilteredProduct[], tiers: Array<{ qty: string; price: string }>): { label: string; total: number } {
  const qty = cart.length;
  if (tiers.length === 0 || qty === 0) {
    const total = cart.reduce((s, p) => s + Number(p.price), 0);
    return { label: `${qty} item(s)`, total };
  }
  // Find the tier that best matches qty (highest tier where qty >= tier qty number)
  const parsedTiers = tiers.map(t => {
    const n = parseInt(t.qty.replace(/\D/g, "")) || 1;
    return { n, price: parseComboPrice(t.price), label: t.qty + " por " + t.price };
  }).sort((a, b) => b.n - a.n);

  const match = parsedTiers.find(t => qty >= t.n);
  if (match) {
    return { label: match.label, total: match.price };
  }
  // Fallback: sum individual prices
  const total = cart.reduce((s, p) => s + Number(p.price), 0);
  return { label: `${qty} item(s)`, total };
}

// ─── Component ───

export default function DoseTriplaCatalog() {
  const { slug } = useParams<{ slug?: string }>();
  const [step, setStep] = useState<Step>("welcome");
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>("todos");
  const [allProducts, setAllProducts] = useState<FilteredProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [configLoading, setConfigLoading] = useState(!!slug);

  // Cart state
  const [cart, setCart] = useState<FilteredProduct[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [cartBounce, setCartBounce] = useState(false);

  const [config, setConfig] = useState<PageConfig>({
    welcome_title: "Calçados em\nDose Tripla! 🔥",
    welcome_subtitle: "Os melhores calçados no **tamanho 34** com preços imperdíveis",
    cta_text: "Ver Calçados no 34 👀",
    payment_info: "Até **6x sem juros** no cartão ou **15% cashback** no Pix 💚",
    combo_tiers: DEFAULT_COMBOS,
    categories: [...DEFAULT_CATEGORIES],
    whatsapp_numbers: DEFAULT_WHATSAPP_STORES,
    selected_product_ids: [],
    product_filter: { sizeFilter: "34", filterBySize: true },
    store_base_url: "https://bananacalcados.com.br",
    theme: { ...DEFAULT_THEME },
  });

  // Load config from DB if slug
  useEffect(() => {
    if (!slug) return;
    (async () => {
      setConfigLoading(true);
      try {
        const { data, error } = await supabase
          .from("catalog_landing_pages")
          .select("*")
          .eq("slug", slug)
          .eq("is_active", true)
          .maybeSingle();
        if (error) throw error;
        if (!data) { setConfigLoading(false); return; }
        const theme = (data.theme_config as any) || DEFAULT_THEME;
        const cats = (data.categories as any[]) || DEFAULT_CATEGORIES;
        const combos = (data.combo_tiers as any[]) || DEFAULT_COMBOS;
        const waNums = (data.whatsapp_numbers as any[]) || DEFAULT_WHATSAPP_STORES;
        const filter = (data.product_filter as any) || { sizeFilter: "34", filterBySize: true };
        setConfig({
          welcome_title: data.welcome_title || "Confira nossos produtos!",
          welcome_subtitle: data.welcome_subtitle,
          cta_text: data.cta_text || "Ver Produtos 👀",
          payment_info: data.payment_info,
          combo_tiers: combos,
          categories: cats,
          whatsapp_numbers: waNums,
          selected_product_ids: data.selected_product_ids || [],
          product_filter: filter,
          store_base_url: data.store_base_url || "https://bananacalcados.com.br",
          theme,
        });
        supabase.from("catalog_landing_pages").update({ views: (data.views || 0) + 1 }).eq("id", data.id).then();
      } catch (e) {
        console.error("Failed to load catalog config:", e);
      } finally {
        setConfigLoading(false);
      }
    })();
  }, [slug]);

  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, [step]);

  const loadProducts = async () => {
    if (allProducts.length > 0) return;
    setLoading(true);
    try {
      const raw = await fetchProducts(250);
      setAllProducts(filterProducts(raw, config));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCategorySelect = (cat: CategoryKey) => {
    setSelectedCategory(cat);
    loadProducts();
    setStep("products");
  };

  const filteredProducts =
    selectedCategory === "todos"
      ? allProducts
      : allProducts.filter((p) => p.category === selectedCategory);

  // Cart helpers
  const isInCart = (productId: string) => cart.some((p) => p.id === productId);

  const addToCart = (product: FilteredProduct) => {
    if (isInCart(product.id)) return;
    setCart((prev) => [...prev, product]);
    setCartBounce(true);
    setTimeout(() => setCartBounce(false), 600);
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((p) => p.id !== productId));
  };

  const comboInfo = getComboTotal(cart, config.combo_tiers);

  // Register lead
  const registerLead = async (channel: string) => {
    try {
      await supabase.from("lp_leads" as any).insert({
        name: customerName,
        phone: customerPhone.replace(/\D/g, ""),
        campaign_tag: `catalogo-${slug || "dose-tripla"}`,
        metadata: {
          cart: cart.map((p) => ({ title: p.title, color: p.color, variantId: p.variantId })),
          channel,
          total: comboInfo.total,
        },
      } as any);
      // Increment clicks
      if (slug) {
        const { data } = await supabase.from("catalog_landing_pages").select("id, clicks").eq("slug", slug).maybeSingle();
        if (data) {
          await supabase.from("catalog_landing_pages").update({ clicks: (data.clicks || 0) + 1 }).eq("id", data.id);
        }
      }
    } catch (e) {
      console.error("Lead registration failed:", e);
    }
  };

  // Checkout via Yampi
  const handleYampiCheckout = async () => {
    if (!customerName.trim() || customerPhone.replace(/\D/g, "").length < 10) {
      toast.error("Preencha seu nome e WhatsApp corretamente");
      return;
    }
    setCheckoutLoading(true);
    try {
      const products: DbOrderProduct[] = cart.map((p) => ({
        id: `catalog-${p.variantId}`,
        shopifyId: p.variantGid,
        sku: p.sku || undefined,
        title: p.title,
        variant: p.color || "Padrão",
        price: Number(p.price),
        quantity: 1,
        image: p.imageUrl,
      }));
      const link = await createYampiPaymentLinkFromOrder(products, {
        customerName,
        customerPhone: customerPhone.replace(/\D/g, ""),
      });
      if (link) {
        await registerLead("yampi");
        window.open(link, "_blank");
      }
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao gerar link de pagamento");
    } finally {
      setCheckoutLoading(false);
    }
  };

  // WhatsApp checkout
  const handleWhatsAppCheckout = async (type: "whatsapp" | "loja") => {
    if (!customerName.trim() || customerPhone.replace(/\D/g, "").length < 10) {
      toast.error("Preencha seu nome e WhatsApp corretamente");
      return;
    }
    const stores = config.whatsapp_numbers;
    const storeIdx = getNextStoreIndex(`catalog_store_turn_${slug || "dose-tripla"}`, stores.length);
    const store = stores[storeIdx];
    const sizeText = config.product_filter.filterBySize ? ` no tamanho ${config.product_filter.sizeFilter}` : "";

    const itemsList = cart
      .map((p, i) => {
        const colorText = p.color ? ` - Cor: ${p.color}` : "";
        return `${i + 1}. *${p.title}*${colorText}${sizeText}`;
      })
      .join("\n");

    const intro = type === "whatsapp"
      ? `Oi! Sou *${customerName}*, vim do catálogo e quero comprar:`
      : `Oi! Sou *${customerName}*, vim do catálogo e quero *retirar na loja física*:`;

    const message = `${intro}\n\n${itemsList}\n\nTotal: R$ ${comboInfo.total.toFixed(0)} (${comboInfo.label})\n\nMeu WhatsApp: ${customerPhone}`;

    await registerLead(type);
    window.open(`https://wa.me/${store.number}?text=${encodeURIComponent(message)}`, "_blank");
  };

  // Phone mask
  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const fadeCls = `transition-all duration-500 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`;
  const theme = config.theme;

  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: theme.backgroundGradient }}>
        <div className="animate-spin w-8 h-8 border-4 border-white/30 border-t-white rounded-full" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center px-4 py-8 relative overflow-hidden"
      style={{ background: theme.backgroundGradient, fontFamily: "'Segoe UI', system-ui, sans-serif" }}
    >
      {/* Background circles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-white/5" />
        <div className="absolute bottom-10 -left-16 w-48 h-48 rounded-full bg-white/5" />
        <div className="absolute top-1/3 right-4 w-24 h-24 rounded-full bg-yellow-300/10" />
      </div>

      {/* Logo */}
      <div className="mb-4 relative z-10 text-center">
        <h2 className="text-2xl font-black text-white tracking-wider drop-shadow-lg">🍌 BANANA</h2>
        <p className="text-xs font-bold text-white/80 tracking-[0.3em] -mt-1">CALÇADOS</p>
      </div>

      {/* Floating cart button */}
      {step !== "welcome" && step !== "cart" && cart.length > 0 && (
        <button
          onClick={() => setStep("cart")}
          className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-white text-xl active:scale-90 transition-transform ${cartBounce ? "animate-bounce" : ""}`}
          style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})` }}
        >
          🛒
          <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
            {cart.length}
          </span>
        </button>
      )}

      {/* Main content */}
      <div className={`relative z-10 w-full max-w-md ${fadeCls}`}>
        {/* =================== WELCOME =================== */}
        {step === "welcome" && (
          <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl overflow-hidden">
            <div className="px-6 pb-8 pt-6 flex flex-col items-center text-center gap-5">
              <div className="text-4xl">👟👠🩴</div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800 leading-tight whitespace-pre-line">
                  {config.welcome_title.includes("\n")
                    ? config.welcome_title.split("\n").map((line, i) => (
                        <span key={i}>
                          {i > 0 && <br />}
                          {line.includes("Dose Tripla") ? (
                            <span className="text-emerald-600">{line}</span>
                          ) : line}
                        </span>
                      ))
                    : config.welcome_title}
                </h1>
                {config.welcome_subtitle && (
                  <p className="text-sm text-gray-500 mt-2"
                    dangerouslySetInnerHTML={{
                      __html: config.welcome_subtitle.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
                    }}
                  />
                )}
              </div>

              {config.combo_tiers.length > 0 && (
                <div className="w-full bg-emerald-50 rounded-2xl p-4 space-y-2">
                  <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Combo Especial</p>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(config.combo_tiers.length, 3)}, 1fr)` }}>
                    {config.combo_tiers.map((item) => (
                      <div key={item.qty} className="bg-white rounded-xl p-3 shadow-sm text-center">
                        <p className="text-xs text-gray-500">{item.qty}</p>
                        <p className="text-lg font-bold text-emerald-600">{item.price}</p>
                      </div>
                    ))}
                  </div>
                  {config.payment_info && (
                    <p className="text-xs text-gray-500 mt-2"
                      dangerouslySetInnerHTML={{
                        __html: config.payment_info.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
                      }}
                    />
                  )}
                </div>
              )}

              <button
                onClick={() => { loadProducts(); setStep("category"); }}
                className="w-full py-3.5 rounded-xl font-bold text-white text-lg shadow-lg active:scale-95 transition-transform"
                style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})` }}
              >
                {config.cta_text}
              </button>
            </div>
          </div>
        )}

        {/* =================== CATEGORY =================== */}
        {step === "category" && (
          <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl overflow-hidden">
            <div className="px-6 pb-8 pt-6 flex flex-col gap-4">
              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-800">O que você procura? 🔍</h2>
                <p className="text-sm text-gray-500 mt-1">Escolha uma categoria pra ver os modelos</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {config.categories.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => handleCategorySelect(cat.key)}
                    className="flex flex-col items-center justify-center gap-1 py-4 px-2 rounded-2xl border-2 border-gray-100 hover:border-emerald-400 hover:bg-emerald-50 active:scale-95 transition-all"
                  >
                    <span className="text-2xl">{cat.emoji}</span>
                    <span className="text-sm font-semibold text-gray-700">{cat.label}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep("welcome")} className="mx-auto px-4 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                ← Voltar
              </button>
            </div>
          </div>
        )}

        {/* =================== PRODUCTS =================== */}
        {step === "products" && (
          <div className="flex flex-col gap-4">
            <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl px-6 py-4 flex items-center justify-between">
              <button onClick={() => setStep("category")} className="text-sm text-gray-500 hover:text-gray-700 font-semibold">
                ← Categorias
              </button>
              <span className="text-sm font-bold text-emerald-600">
                {config.categories.find((c) => c.key === selectedCategory)?.emoji}{" "}
                {config.categories.find((c) => c.key === selectedCategory)?.label}
              </span>
              <span className="text-xs text-gray-400">{filteredProducts.length} itens</span>
            </div>

            {/* Stock reservation warning */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex gap-2 items-start">
              <span className="text-lg">⚠️</span>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                <strong>Atenção:</strong> Só adicione ao carrinho se tiver real intenção de compra. Os produtos adicionados serão separados no estoque.
              </p>
            </div>

            {loading ? (
              <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl p-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-emerald-200 border-t-emerald-500 rounded-full mx-auto" />
                <p className="text-sm text-gray-500 mt-3">Carregando produtos...</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl p-8 text-center">
                <p className="text-3xl mb-2">😕</p>
                <p className="text-sm text-gray-500">Nenhum produto encontrado nessa categoria</p>
                <button
                  onClick={() => setStep("category")}
                  className="mt-4 px-6 py-2 rounded-xl text-sm font-semibold text-white active:scale-95 transition-transform"
                  style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})` }}
                >
                  Escolher outra categoria
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredProducts.map((product) => {
                  const inCart = isInCart(product.id);
                  return (
                    <div
                      key={product.id + product.variantId}
                      className={`bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg overflow-hidden flex flex-col ${inCart ? "ring-2 ring-emerald-400" : ""}`}
                    >
                      {product.imageUrl && (
                        <div className="aspect-square overflow-hidden">
                          <img src={product.imageUrl} alt={product.title} className="w-full h-full object-cover" loading="lazy" />
                        </div>
                      )}
                      <div className="p-3 flex flex-col gap-2 flex-1">
                        <h3 className="text-xs font-bold text-gray-800 leading-tight line-clamp-2">{product.title}</h3>
                        {product.color && <p className="text-[10px] text-gray-400">Cor: {product.color}</p>}
                        <div className="flex items-baseline gap-1">
                          {product.compareAtPrice && (
                            <span className="text-[10px] text-gray-400 line-through">R$ {Number(product.compareAtPrice).toFixed(0)}</span>
                          )}
                          <span className="text-sm font-bold text-emerald-600">R$ {Number(product.price).toFixed(0)}</span>
                        </div>
                        <div className="mt-auto">
                          {inCart ? (
                            <button
                              onClick={() => removeFromCart(product.id)}
                              className="w-full py-2 rounded-lg text-[11px] font-bold text-emerald-700 bg-emerald-100 text-center active:scale-95 transition-transform"
                            >
                              ✅ Adicionado · Remover
                            </button>
                          ) : (
                            <button
                              onClick={() => addToCart(product)}
                              className="w-full py-2 rounded-lg text-[11px] font-bold text-white text-center active:scale-95 transition-transform"
                              style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})` }}
                            >
                              🛒 Adicionar ao Carrinho
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* =================== CART =================== */}
        {step === "cart" && (
          <div className="flex flex-col gap-4">
            <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl px-6 py-4 flex items-center justify-between">
              <button onClick={() => setStep("products")} className="text-sm text-gray-500 hover:text-gray-700 font-semibold">
                ← Continuar Comprando
              </button>
              <span className="text-sm font-bold text-emerald-600">🛒 Meu Carrinho ({cart.length})</span>
            </div>

            {cart.length === 0 ? (
              <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl p-8 text-center">
                <p className="text-3xl mb-2">🛒</p>
                <p className="text-sm text-gray-500">Seu carrinho está vazio</p>
                <button
                  onClick={() => setStep("products")}
                  className="mt-4 px-6 py-2 rounded-xl text-sm font-semibold text-white active:scale-95 transition-transform"
                  style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})` }}
                >
                  Ver Produtos
                </button>
              </div>
            ) : (
              <>
                {/* Cart items */}
                <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl overflow-hidden">
                  <div className="p-4 space-y-3">
                    {cart.map((product) => (
                      <div key={product.id} className="flex gap-3 items-center">
                        {product.imageUrl && (
                          <img src={product.imageUrl} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-gray-800 line-clamp-1">{product.title}</p>
                          {product.color && <p className="text-[10px] text-gray-400">Cor: {product.color}</p>}
                          <p className="text-xs font-bold text-emerald-600">R$ {Number(product.price).toFixed(0)}</p>
                        </div>
                        <button
                          onClick={() => removeFromCart(product.id)}
                          className="text-red-400 hover:text-red-600 text-lg shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  {/* Total */}
                  <div className="bg-emerald-50 px-4 py-3 flex items-center justify-between">
                    <span className="text-xs text-gray-600">{comboInfo.label}</span>
                    <span className="text-lg font-black text-emerald-600">R$ {comboInfo.total.toFixed(0)}</span>
                  </div>
                </div>

                {/* Customer form */}
                <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl p-5 space-y-3">
                  <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">Seus dados para contato</p>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Seu nome"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                    />
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(formatPhone(e.target.value))}
                      placeholder="(00) 00000-0000"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                    />
                  </div>
                </div>

                {/* Warning */}
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex gap-2 items-start">
                  <span className="text-lg">⚠️</span>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    <strong>NÃO FINALIZE SE NÃO TIVER A INTENÇÃO DE COMPRAR</strong> — Todos os produtos do seu carrinho serão separados automaticamente no estoque.
                  </p>
                </div>

                {/* Checkout buttons */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleYampiCheckout}
                    disabled={checkoutLoading}
                    className="w-full py-3 rounded-xl font-bold text-white text-sm shadow-lg active:scale-95 transition-transform disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})` }}
                  >
                    {checkoutLoading ? "Gerando link..." : "🛒 Finalizar no Site"}
                  </button>
                  <button
                    onClick={() => handleWhatsAppCheckout("whatsapp")}
                    className="w-full py-3 rounded-xl font-bold text-white text-sm shadow-lg active:scale-95 transition-transform"
                    style={{ background: theme.buttonWhatsappColor }}
                  >
                    💬 Finalizar no WhatsApp
                  </button>
                  <button
                    onClick={() => handleWhatsAppCheckout("loja")}
                    className="w-full py-3 rounded-xl font-bold text-white text-sm shadow-lg active:scale-95 transition-transform"
                    style={{ background: `linear-gradient(135deg, ${theme.buttonStoreColor}, ${theme.buttonStoreColor}dd)` }}
                  >
                    🏬 Retirar na Loja Física
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
