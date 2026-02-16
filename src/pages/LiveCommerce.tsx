import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ShoppingBag, ExternalLink, MessageCircle, X, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";

const LiveCommerce = () => {
  const [searchParams] = useSearchParams();
  const videoId = searchParams.get("v") || "";
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [isLive, setIsLive] = useState(!!videoId);

  useEffect(() => {
    fetchProducts(12).then(setProducts);
  }, []);

  const whatsappLink = "https://wa.me/5500000000000?text=Oi!%20Vim%20da%20live!";

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Video Section */}
      <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
        {isLive && videoId ? (
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
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center">
              <ShoppingBag className="w-8 h-8 text-zinc-500" />
            </div>
            <p className="text-zinc-400 text-lg font-medium">Nenhuma live no momento</p>
            <p className="text-zinc-500 text-sm">Volte em breve! 🎉</p>
          </div>
        )}
      </div>

      {/* Live Info Bar */}
      <div className="bg-zinc-900 border-t border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/images/banana-logo.png"
            alt="Banana Calçados"
            className="w-8 h-8 rounded-full object-cover"
            loading="lazy"
          />
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
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            WhatsApp
          </a>
          <Button
            size="sm"
            variant="outline"
            className="border-zinc-700 text-white hover:bg-zinc-800 gap-1.5"
            onClick={() => setCartOpen(!cartOpen)}
          >
            <ShoppingBag className="w-4 h-4" />
            Produtos
            {cartOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </Button>
        </div>
      </div>

      {/* Products Drawer */}
      {cartOpen && (
        <div className="bg-zinc-900 border-t border-zinc-800 max-h-[50vh] overflow-y-auto">
          <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800">
            <h2 className="text-sm font-bold">Produtos da Live</h2>
            <button onClick={() => setCartOpen(false)} className="text-zinc-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          {products.length === 0 ? (
            <p className="text-center text-zinc-500 py-8 text-sm">Carregando produtos...</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 p-4">
              {products.map((p) => {
                const product = p.node;
                const image = product.images.edges[0]?.node.url;
                const price = parseFloat(product.priceRange.minVariantPrice.amount);
                const handle = product.handle;

                return (
                  <a
                    key={product.id}
                    href={`https://ftx2e2-np.myshopify.com/products/${handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-zinc-800 rounded-lg overflow-hidden hover:ring-1 hover:ring-zinc-600 transition-all group"
                  >
                    {image && (
                      <div className="aspect-square overflow-hidden">
                        <img
                          src={image}
                          alt={product.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="p-2">
                      <p className="text-xs font-medium line-clamp-2 leading-tight">{product.title}</p>
                      <p className="text-sm font-bold text-green-400 mt-1">
                        R$ {price.toFixed(2).replace(".", ",")}
                      </p>
                      <span className="text-[10px] text-zinc-400 flex items-center gap-1 mt-1">
                        <ExternalLink className="w-3 h-3" /> Ver produto
                      </span>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LiveCommerce;
