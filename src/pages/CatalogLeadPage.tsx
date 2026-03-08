import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { toast } from "sonner";
import { ShoppingBag, X, ChevronLeft, Instagram, Phone, Loader2, Check } from "lucide-react";

// ─── Types ───
interface PageConfig {
  id: string;
  title: string;
  subtitle: string | null;
  theme_config: { primaryColor: string; secondaryColor: string; backgroundGradient: string };
  selected_product_ids: string[];
  require_registration: boolean;
  whatsapp_numbers: Array<{ name: string; number: string }>;
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
}

// ─── Helpers ───
function buildProducts(raw: ShopifyProduct[], selectedIds: Set<string>): CatalogProduct[] {
  const products: CatalogProduct[] = [];
  for (const sp of raw) {
    if (selectedIds.size > 0 && !selectedIds.has(sp.node.id)) continue;
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
        color,
        size,
        label: parts.join(" / "),
        price: v.price.amount,
        compareAtPrice: v.compareAtPrice?.amount || null,
        imageUrl: v.image?.url || fallbackImg,
        available: v.availableForSale,
      });
    }
    if (variants.length === 0) continue;
    const defaultV = variants[0];
    products.push({
      id: sp.node.id,
      title: sp.node.title,
      handle: sp.node.handle,
      imageUrl: defaultV.imageUrl || fallbackImg,
      price: sp.node.priceRange.minVariantPrice.amount,
      compareAtPrice: variants[0].compareAtPrice,
      variants,
    });
  }
  return products;
}

const fmt = (v: string | number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatPhone = (value: string) => {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

// ─── Component ───
export default function CatalogLeadPage() {
  const { slug } = useParams<{ slug: string }>();
  const [config, setConfig] = useState<PageConfig | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);

  // Registration
  const [registered, setRegistered] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [instagram, setInstagram] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  // Product detail
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<CatalogVariant | null>(null);

  // Check if already registered in this session
  useEffect(() => {
    const key = `catalog_lead_${slug}`;
    if (localStorage.getItem(key)) setRegistered(true);
  }, [slug]);

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
      });
      // Increment views non-blocking
      supabase.from("catalog_lead_pages").update({ views: (cfg.views || 0) + 1 } as any).eq("id", cfg.id).then();
      setLoading(false);
    })();
  }, [slug]);

  // Load products after config
  useEffect(() => {
    if (!config) return;
    (async () => {
      setProductsLoading(true);
      const raw = await fetchProducts(250);
      setProducts(buildProducts(raw, new Set(config.selected_product_ids)));
      setProductsLoading(false);
    })();
  }, [config]);

  const handleRegister = async () => {
    const igClean = instagram.trim().replace(/^@/, "");
    const phoneClean = whatsapp.replace(/\D/g, "");
    if (!igClean) { toast.error("Digite seu @ do Instagram"); return; }
    if (phoneClean.length < 10) { toast.error("WhatsApp inválido"); return; }
    setRegLoading(true);
    try {
      await supabase.from("catalog_lead_registrations").insert({
        catalog_page_id: config!.id,
        instagram_handle: igClean,
        whatsapp: phoneClean,
      } as any);
      // Also register as lp_lead
      await supabase.from("lp_leads" as any).insert({
        instagram: igClean,
        phone: phoneClean,
        campaign_tag: `catalogo-lead-${slug}`,
        source: "catalog_lead_page",
      } as any);
      // Increment leads_count
      supabase.from("catalog_lead_pages").update({ leads_count: ((config as any).leads_count || 0) + 1 } as any).eq("id", config!.id).then();
      localStorage.setItem(`catalog_lead_${slug}`, JSON.stringify({ instagram: igClean, whatsapp: phoneClean }));
      setRegistered(true);
      setRegOpen(false);
      toast.success("Cadastro feito! Agora escolha suas variações 🎉");
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

  const handleVariantSelect = (variant: CatalogVariant) => {
    setSelectedVariant(variant);
  };

  const handleWhatsAppOrder = () => {
    if (!selectedProduct || !selectedVariant) return;
    const stored = JSON.parse(localStorage.getItem(`catalog_lead_${slug}`) || "{}");
    const numbers = config?.whatsapp_numbers || [];
    const store = numbers[Math.floor(Math.random() * numbers.length)] || { number: "5533936180084" };
    const msg = `Oi! Vi no catálogo e quero o:\n\n*${selectedProduct.title}*\nVariação: ${selectedVariant.label}\nPreço: ${fmt(selectedVariant.price)}\n\nMeu Instagram: @${stored.instagram || instagram}\nMeu WhatsApp: ${stored.whatsapp || whatsapp}`;
    window.open(`https://wa.me/${store.number}?text=${encodeURIComponent(msg)}`, "_blank");
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

  // ─── Product Detail View ───
  if (selectedProduct && registered) {
    const uniqueSizes = [...new Set(selectedProduct.variants.filter(v => v.size).map(v => v.size!))];
    const uniqueColors = [...new Set(selectedProduct.variants.filter(v => v.color).map(v => v.color!))];

    return (
      <div className="min-h-screen" style={{ background: theme.backgroundGradient }}>
        <div className="max-w-lg mx-auto px-4 py-6">
          <button onClick={() => { setSelectedProduct(null); setSelectedVariant(null); }} className="flex items-center gap-1 text-white/80 hover:text-white mb-4 text-sm">
            <ChevronLeft className="h-4 w-4" />Voltar
          </button>
          <div className="bg-white rounded-2xl overflow-hidden shadow-xl">
            <img
              src={selectedVariant?.imageUrl || selectedProduct.imageUrl}
              alt={selectedProduct.title}
              className="w-full aspect-square object-cover"
            />
            <div className="p-4 space-y-4">
              <h2 className="text-lg font-bold text-gray-900">{selectedProduct.title}</h2>
              <div className="flex items-center gap-2">
                {selectedProduct.compareAtPrice && Number(selectedProduct.compareAtPrice) > Number(selectedProduct.price) && (
                  <span className="text-sm line-through text-gray-400">{fmt(selectedProduct.compareAtPrice)}</span>
                )}
                <span className="text-xl font-bold" style={{ color: theme.primaryColor }}>
                  {fmt(selectedVariant?.price || selectedProduct.price)}
                </span>
              </div>

              {/* Size selector */}
              {uniqueSizes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">Tamanho</p>
                  <div className="flex flex-wrap gap-2">
                    {uniqueSizes.map(s => {
                      const isSelected = selectedVariant?.size === s;
                      return (
                        <button key={s} onClick={() => {
                          const v = selectedProduct.variants.find(v => v.size === s && (selectedVariant?.color ? v.color === selectedVariant.color : true));
                          if (v) handleVariantSelect(v);
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

              {/* Color selector */}
              {uniqueColors.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">Cor</p>
                  <div className="flex flex-wrap gap-2">
                    {uniqueColors.map(c => {
                      const isSelected = selectedVariant?.color === c;
                      return (
                        <button key={c} onClick={() => {
                          const v = selectedProduct.variants.find(v => v.color === c && (selectedVariant?.size ? v.size === selectedVariant.size : true));
                          if (v) handleVariantSelect(v);
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
                <button onClick={handleWhatsAppOrder}
                  className="w-full py-3 rounded-xl text-white font-bold text-base flex items-center justify-center gap-2 active:scale-95 transition-transform"
                  style={{ background: "#25D366" }}>
                  <ShoppingBag className="h-5 w-5" />
                  Quero esse! WhatsApp
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
            <input
              type="text"
              placeholder="@seu_instagram"
              value={instagram}
              onChange={e => setInstagram(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]"
              style={{ "--primary-color": theme.primaryColor } as any}
            />
          </div>
          <div className="relative">
            <Phone className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <input
              type="tel"
              placeholder="(33) 99999-9999"
              value={whatsapp}
              onChange={e => setWhatsapp(formatPhone(e.target.value))}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2"
            />
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

  // ─── Product Grid ───
  return (
    <div className="min-h-screen" style={{ background: theme.backgroundGradient }}>
      {registrationModal}

      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-black text-white tracking-wider drop-shadow-lg">🍌 BANANA</h2>
          <p className="text-xs font-bold text-white/80 tracking-[0.3em] -mt-1">CALÇADOS</p>
          <h1 className="text-xl font-bold text-white mt-3">{config.title}</h1>
          {config.subtitle && <p className="text-sm text-white/80 mt-1">{config.subtitle}</p>}
        </div>

        {/* Products */}
        {productsLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>
        ) : products.length === 0 ? (
          <p className="text-center text-white/70">Nenhum produto disponível</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {products.map(p => {
              const hasDiscount = p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price);
              return (
                <button key={p.id} onClick={() => handleProductClick(p)}
                  className="bg-white rounded-xl overflow-hidden shadow-lg text-left active:scale-95 transition-transform">
                  <img src={p.imageUrl} alt={p.title} className="w-full aspect-square object-cover" />
                  <div className="p-2.5">
                    <p className="text-xs font-semibold text-gray-900 line-clamp-2 leading-tight">{p.title}</p>
                    <div className="mt-1 flex items-center gap-1">
                      {hasDiscount && <span className="text-[10px] line-through text-gray-400">{fmt(p.compareAtPrice!)}</span>}
                      <span className="text-sm font-bold" style={{ color: theme.primaryColor }}>{fmt(p.price)}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">{p.variants.length} variação(ões)</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
