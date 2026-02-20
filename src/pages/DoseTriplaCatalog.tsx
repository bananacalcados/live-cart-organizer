import { useState, useEffect } from "react";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";

type Step = "welcome" | "category" | "products";

const CATEGORIES = [
  { key: "todos", label: "Todos", emoji: "👟" },
  { key: "tenis", label: "Tênis", emoji: "👟" },
  { key: "salto", label: "Salto", emoji: "👠" },
  { key: "papete", label: "Papete", emoji: "🩴" },
  { key: "rasteira", label: "Rasteira", emoji: "🥿" },
  { key: "sandalia", label: "Sandália", emoji: "👡" },
  { key: "bota", label: "Bota", emoji: "🥾" },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

const WHATSAPP_STORES = [
  { name: "Banana Calçados", number: "5533936180084" },
  { name: "Zoppy", number: "5533935050288" },
];

function getNextStoreIndex(): number {
  const current = Number(localStorage.getItem("dose_tripla_store_turn") || "0");
  const next = (current + 1) % WHATSAPP_STORES.length;
  localStorage.setItem("dose_tripla_store_turn", String(next));
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

interface FilteredProduct {
  id: string;
  title: string;
  handle: string;
  imageUrl: string;
  price: string;
  compareAtPrice: string | null;
  variantId: string;
  color: string;
  category: CategoryKey;
}

function extractColor(product: ShopifyProduct): string {
  const colorOption = product.node.variants.edges
    .flatMap((v) => v.node.selectedOptions)
    .find((opt) => opt.name.toLowerCase() === "cor" || opt.name.toLowerCase() === "color");
  return colorOption?.value || "";
}

function filterSize34Products(products: ShopifyProduct[]): FilteredProduct[] {
  const result: FilteredProduct[] = [];

  for (const product of products) {
    const variant34 = product.node.variants.edges.find((v) =>
      v.node.selectedOptions.some(
        (opt) =>
          (opt.name.toLowerCase() === "tamanho" || opt.name.toLowerCase() === "size") &&
          opt.value === "34"
      )
    );
    if (!variant34 || !variant34.node.availableForSale) continue;

    const imageUrl = product.node.images.edges[0]?.node.url || "";
    const color = extractColor(product);
    const gid = variant34.node.id; // gid://shopify/ProductVariant/XXXXX
    const numericId = gid.split("/").pop() || gid;

    result.push({
      id: product.node.id,
      title: product.node.title,
      handle: product.node.handle,
      imageUrl,
      price: variant34.node.price.amount,
      compareAtPrice: variant34.node.compareAtPrice?.amount || null,
      variantId: numericId,
      color,
      category: categorizeProduct(product.node.title),
    });
  }

  return result;
}

export default function DoseTriplaCatalog() {
  const [step, setStep] = useState<Step>("welcome");
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>("todos");
  const [allProducts, setAllProducts] = useState<FilteredProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);

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
      setAllProducts(filterSize34Products(raw));
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

  const buildWhatsAppLink = (product: FilteredProduct, type: "whatsapp" | "loja") => {
    const storeIdx = getNextStoreIndex();
    const store = WHATSAPP_STORES[storeIdx];
    const colorText = product.color ? ` na cor *${product.color}*` : "";
    const message =
      type === "whatsapp"
        ? `Oi! Vi o produto *${product.title}*${colorText} no tamanho 34 e quero comprar! 🛒 Campanha Dose Tripla`
        : `Oi! Vi o produto *${product.title}*${colorText} no tamanho 34 e quero *retirar na loja física*! 🏬 Campanha Dose Tripla`;
    return `https://wa.me/${store.number}?text=${encodeURIComponent(message)}`;
  };

  const buildSiteLink = (product: FilteredProduct) =>
    `https://bananacalcados.com.br/products/${product.handle}?variant=${product.variantId}`;

  const fadeCls = `transition-all duration-500 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`;

  return (
    <div
      className="min-h-screen flex flex-col items-center px-4 py-8 relative overflow-hidden"
      style={{
        background: "linear-gradient(160deg, #00BFA6 0%, #00897B 50%, #004D40 100%)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* Background circles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-white/5" />
        <div className="absolute bottom-10 -left-16 w-48 h-48 rounded-full bg-white/5" />
        <div className="absolute top-1/3 right-4 w-24 h-24 rounded-full bg-yellow-300/10" />
      </div>

      {/* Logo */}
      <div className="mb-4 relative z-10 text-center">
        <h2
          className="text-2xl font-black text-white tracking-wider drop-shadow-lg"
          style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}
        >
          🍌 BANANA
        </h2>
        <p className="text-xs font-bold text-white/80 tracking-[0.3em] -mt-1">CALÇADOS</p>
      </div>

      {/* Main content */}
      <div className={`relative z-10 w-full max-w-md ${fadeCls}`}>
        {/* =================== WELCOME =================== */}
        {step === "welcome" && (
          <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl overflow-hidden">
            <div className="px-6 pb-8 pt-6 flex flex-col items-center text-center gap-5">
              <div className="text-4xl">👟👠🩴</div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800 leading-tight">
                  Calçados em<br />
                  <span className="text-emerald-600">Dose Tripla!</span> 🔥
                </h1>
                <p className="text-sm text-gray-500 mt-2">
                  Os melhores calçados no <strong>tamanho 34</strong> com preços imperdíveis
                </p>
              </div>

              {/* Pricing */}
              <div className="w-full bg-emerald-50 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                  Combo Dose Tripla
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { qty: "1 par", price: "R$ 150" },
                    { qty: "2 pares", price: "R$ 240" },
                    { qty: "3 pares", price: "R$ 300" },
                  ].map((item) => (
                    <div
                      key={item.qty}
                      className="bg-white rounded-xl p-3 shadow-sm text-center"
                    >
                      <p className="text-xs text-gray-500">{item.qty}</p>
                      <p className="text-lg font-bold text-emerald-600">{item.price}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Até <strong>6x sem juros</strong> no cartão ou{" "}
                  <strong>15% cashback</strong> no Pix 💚
                </p>
              </div>

              <button
                onClick={() => {
                  loadProducts();
                  setStep("category");
                }}
                className="w-full py-3.5 rounded-xl font-bold text-white text-lg shadow-lg active:scale-95 transition-transform"
                style={{ background: "linear-gradient(135deg, #00BFA6, #00897B)" }}
              >
                Ver Calçados no 34 👀
              </button>
            </div>
          </div>
        )}

        {/* =================== CATEGORY =================== */}
        {step === "category" && (
          <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl overflow-hidden">
            <div className="px-6 pb-8 pt-6 flex flex-col gap-4">
              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-800">
                  O que você procura? 🔍
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Escolha uma categoria pra ver os modelos
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {CATEGORIES.map((cat) => (
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

              <button
                onClick={() => setStep("welcome")}
                className="mx-auto px-4 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                ← Voltar
              </button>
            </div>
          </div>
        )}

        {/* =================== PRODUCTS =================== */}
        {step === "products" && (
          <div className="flex flex-col gap-4">
            {/* Header card */}
            <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl px-6 py-4 flex items-center justify-between">
              <button
                onClick={() => setStep("category")}
                className="text-sm text-gray-500 hover:text-gray-700 font-semibold"
              >
                ← Categorias
              </button>
              <span className="text-sm font-bold text-emerald-600">
                {CATEGORIES.find((c) => c.key === selectedCategory)?.emoji}{" "}
                {CATEGORIES.find((c) => c.key === selectedCategory)?.label}
              </span>
              <span className="text-xs text-gray-400">
                {filteredProducts.length} itens
              </span>
            </div>

            {loading ? (
              <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl p-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-emerald-200 border-t-emerald-500 rounded-full mx-auto" />
                <p className="text-sm text-gray-500 mt-3">Carregando produtos...</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl p-8 text-center">
                <p className="text-3xl mb-2">😕</p>
                <p className="text-sm text-gray-500">
                  Nenhum produto encontrado nessa categoria no tamanho 34
                </p>
                <button
                  onClick={() => setStep("category")}
                  className="mt-4 px-6 py-2 rounded-xl text-sm font-semibold text-white active:scale-95 transition-transform"
                  style={{ background: "linear-gradient(135deg, #00BFA6, #00897B)" }}
                >
                  Escolher outra categoria
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id + product.variantId}
                    className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg overflow-hidden flex flex-col"
                  >
                    {/* Image */}
                    {product.imageUrl && (
                      <div className="aspect-square overflow-hidden">
                        <img
                          src={product.imageUrl}
                          alt={product.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    )}
                    {/* Info */}
                    <div className="p-3 flex flex-col gap-2 flex-1">
                      <h3 className="text-xs font-bold text-gray-800 leading-tight line-clamp-2">
                        {product.title}
                      </h3>
                      {product.color && (
                        <p className="text-[10px] text-gray-400">Cor: {product.color}</p>
                      )}
                      <div className="flex items-baseline gap-1">
                        {product.compareAtPrice && (
                          <span className="text-[10px] text-gray-400 line-through">
                            R$ {Number(product.compareAtPrice).toFixed(0)}
                          </span>
                        )}
                        <span className="text-sm font-bold text-emerald-600">
                          R$ {Number(product.price).toFixed(0)}
                        </span>
                      </div>

                      {/* Buttons */}
                      <div className="flex flex-col gap-1.5 mt-auto">
                        <a
                          href={buildSiteLink(product)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-2 rounded-lg text-[11px] font-bold text-white text-center active:scale-95 transition-transform"
                          style={{ background: "linear-gradient(135deg, #00BFA6, #00897B)" }}
                        >
                          🛒 Comprar no Site
                        </a>
                        <a
                          href={buildWhatsAppLink(product, "whatsapp")}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-2 rounded-lg text-[11px] font-bold text-white text-center active:scale-95 transition-transform"
                          style={{ background: "#25D366" }}
                        >
                          💬 Comprar no WhatsApp
                        </a>
                        <a
                          href={buildWhatsAppLink(product, "loja")}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-2 rounded-lg text-[11px] font-bold text-white text-center active:scale-95 transition-transform"
                          style={{ background: "linear-gradient(135deg, #7C3AED, #5B21B6)" }}
                        >
                          🏬 Comprar na Loja
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
