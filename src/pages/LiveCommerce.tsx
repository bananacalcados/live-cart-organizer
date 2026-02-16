import { useState, useEffect, useCallback } from "react";
import { ShoppingBag, MessageCircle, X, ChevronUp, ChevronDown, Plus, Minus, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { createShopifyCartFromOrder } from "@/lib/shopifyCart";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CartItem {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  price: number;
  quantity: number;
  image?: string;
}

interface ProductRef {
  handle: string;
  title: string;
  image?: string;
  price: number;
}

interface LiveSessionData {
  youtube_video_id: string | null;
  whatsapp_link: string | null;
  selected_products: ProductRef[];
  title: string;
}

const LiveCommerce = () => {
  const [session, setSession] = useState<LiveSessionData | null>(null);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [drawerView, setDrawerView] = useState<"closed" | "products" | "cart">("closed");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkingOut, setCheckingOut] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ShopifyProduct | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch active session from DB
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("live_sessions")
        .select("*")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (data) {
        const s = data as any;
        setSession({
          youtube_video_id: s.youtube_video_id,
          whatsapp_link: s.whatsapp_link,
          selected_products: s.selected_products || [],
          title: s.title,
        });

        // Fetch full product data for selected handles
        const handles = (s.selected_products || []).map((p: ProductRef) => p.handle);
        if (handles.length > 0) {
          const allProds = await fetchProducts(250);
          const filtered = allProds.filter(p => handles.includes(p.node.handle));
          setProducts(filtered);
        }
      }
      setLoading(false);
    };
    load();
  }, []);

  const isLive = !!session?.youtube_video_id;
  const videoId = session?.youtube_video_id || "";
  const whatsappLink = session?.whatsapp_link || "";
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  const addToCart = useCallback((variant: { id: string; title: string; price: number }, productTitle: string, image?: string) => {
    setCart(prev => {
      const existing = prev.find(i => i.variantId === variant.id);
      if (existing) {
        return prev.map(i => i.variantId === variant.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        variantId: variant.id,
        productTitle,
        variantTitle: variant.title === "Default Title" ? "" : variant.title,
        price: variant.price,
        quantity: 1,
        image,
      }];
    });
    toast.success("Adicionado ao carrinho!");
    setSelectedProduct(null);
  }, []);

  const updateQty = (variantId: string, delta: number) => {
    setCart(prev => prev.map(i => {
      if (i.variantId !== variantId) return i;
      const newQty = i.quantity + delta;
      return newQty <= 0 ? null! : { ...i, quantity: newQty };
    }).filter(Boolean));
  };

  const removeItem = (variantId: string) => {
    setCart(prev => prev.filter(i => i.variantId !== variantId));
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setCheckingOut(true);
    try {
      const orderProducts = cart.map(item => ({
        id: item.variantId,
        title: item.productTitle,
        variant: item.variantTitle || "Default",
        price: item.price,
        quantity: item.quantity,
        shopifyId: item.variantId,
        image: item.image,
      }));
      const checkoutUrl = await createShopifyCartFromOrder(orderProducts);
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        toast.error("Erro ao criar carrinho. Tente novamente.");
      }
    } catch {
      toast.error("Erro ao processar. Tente novamente.");
    } finally {
      setCheckingOut(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-400">Carregando...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-3">
        <ShoppingBag className="w-16 h-16 text-zinc-600" />
        <p className="text-zinc-400 text-lg font-medium">Nenhuma live no momento</p>
        <p className="text-zinc-500 text-sm">Volte em breve! 🎉</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Video */}
      <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
        {isLive ? (
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
            title="Live"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 gap-3">
            <ShoppingBag className="w-8 h-8 text-zinc-500" />
            <p className="text-zinc-400">Aguardando transmissão...</p>
          </div>
        )}
      </div>

      {/* Info Bar */}
      <div className="bg-zinc-900 border-t border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/images/banana-logo.png" alt="Banana Calçados" className="w-8 h-8 rounded-full object-cover" loading="lazy" />
          <div>
            <h1 className="text-sm font-bold leading-tight">Banana Calçados</h1>
            {isLive && (
              <span className="inline-flex items-center gap-1 text-xs">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                AO VIVO
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {whatsappLink && (
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </a>
          )}
          {products.length > 0 && (
            <Button size="sm" variant="outline" className="border-zinc-700 text-white hover:bg-zinc-800 gap-1.5"
              onClick={() => setDrawerView(v => v === "products" ? "closed" : "products")}>
              <ShoppingBag className="w-4 h-4" />
              Produtos
              {drawerView === "products" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </Button>
          )}
          <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-black font-bold gap-1.5 relative"
            onClick={() => setDrawerView(v => v === "cart" ? "closed" : "cart")}>
            <ShoppingCart className="w-4 h-4" />
            {cartCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Variant Selector Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => setSelectedProduct(null)}>
          <div className="bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="font-bold text-sm">Escolha o tamanho/cor</h3>
              <button onClick={() => setSelectedProduct(null)} className="text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4">
              <p className="text-xs text-zinc-400 mb-3">{selectedProduct.node.title}</p>
              <div className="grid grid-cols-2 gap-2">
                {selectedProduct.node.variants.edges.filter(v => v.node.availableForSale).map(v => (
                  <button key={v.node.id}
                    className="bg-zinc-800 hover:bg-zinc-700 rounded-lg p-3 text-left transition-colors"
                    onClick={() => addToCart(
                      { id: v.node.id, title: v.node.title, price: parseFloat(v.node.price.amount) },
                      selectedProduct.node.title,
                      selectedProduct.node.images.edges[0]?.node.url
                    )}>
                    <p className="text-xs font-medium">{v.node.title}</p>
                    <p className="text-sm font-bold text-green-400 mt-1">
                      R$ {parseFloat(v.node.price.amount).toFixed(2).replace(".", ",")}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Products Drawer */}
      {drawerView === "products" && (
        <div className="bg-zinc-900 border-t border-zinc-800 max-h-[50vh] overflow-y-auto">
          <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800">
            <h2 className="text-sm font-bold">Produtos da Live</h2>
            <button onClick={() => setDrawerView("closed")} className="text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 p-4">
            {products.map((p) => {
              const product = p.node;
              const image = product.images.edges[0]?.node.url;
              const price = parseFloat(product.priceRange.minVariantPrice.amount);
              const hasVariants = product.variants.edges.length > 1;

              return (
                <button key={product.id}
                  className="bg-zinc-800 rounded-lg overflow-hidden hover:ring-1 hover:ring-amber-500/50 transition-all group text-left"
                  onClick={() => {
                    if (hasVariants) {
                      setSelectedProduct(p);
                    } else {
                      const v = product.variants.edges[0]?.node;
                      if (v?.availableForSale) {
                        addToCart({ id: v.id, title: v.title, price: parseFloat(v.price.amount) }, product.title, image);
                      } else {
                        toast.error("Produto esgotado");
                      }
                    }
                  }}>
                  {image && (
                    <div className="aspect-square overflow-hidden">
                      <img src={image} alt={product.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                    </div>
                  )}
                  <div className="p-2">
                    <p className="text-xs font-medium line-clamp-2 leading-tight">{product.title}</p>
                    <p className="text-sm font-bold text-green-400 mt-1">
                      R$ {price.toFixed(2).replace(".", ",")}
                    </p>
                    <span className="text-[10px] text-amber-400 flex items-center gap-1 mt-1">
                      <Plus className="w-3 h-3" /> {hasVariants ? "Escolher tamanho" : "Adicionar"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Cart Drawer */}
      {drawerView === "cart" && (
        <div className="bg-zinc-900 border-t border-zinc-800 max-h-[50vh] overflow-y-auto">
          <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800">
            <h2 className="text-sm font-bold">Meu Carrinho ({cartCount})</h2>
            <button onClick={() => setDrawerView("closed")} className="text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          {cart.length === 0 ? (
            <div className="text-center py-8">
              <ShoppingCart className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
              <p className="text-zinc-500 text-sm">Seu carrinho está vazio</p>
              <button className="text-amber-400 text-xs mt-2 underline" onClick={() => setDrawerView("products")}>
                Ver produtos
              </button>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {cart.map(item => (
                <div key={item.variantId} className="flex items-center gap-3 bg-zinc-800 rounded-lg p-3">
                  {item.image && <img src={item.image} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.productTitle}</p>
                    {item.variantTitle && <p className="text-[10px] text-zinc-400">{item.variantTitle}</p>}
                    <p className="text-sm font-bold text-green-400">
                      R$ {(item.price * item.quantity).toFixed(2).replace(".", ",")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateQty(item.variantId, -1)}
                      className="w-7 h-7 rounded bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center">
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-xs w-6 text-center font-bold">{item.quantity}</span>
                    <button onClick={() => updateQty(item.variantId, 1)}
                      className="w-7 h-7 rounded bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center">
                      <Plus className="w-3 h-3" />
                    </button>
                    <button onClick={() => removeItem(item.variantId)}
                      className="w-7 h-7 rounded bg-red-900/50 hover:bg-red-800/50 flex items-center justify-center ml-1">
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="border-t border-zinc-700 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">Total</span>
                  <span className="text-lg font-bold text-green-400">
                    R$ {cartTotal.toFixed(2).replace(".", ",")}
                  </span>
                </div>
                <Button className="w-full bg-amber-500 hover:bg-amber-600 text-black font-bold text-sm py-5"
                  onClick={handleCheckout} disabled={checkingOut}>
                  {checkingOut ? "Gerando checkout..." : "Finalizar Compra"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LiveCommerce;
