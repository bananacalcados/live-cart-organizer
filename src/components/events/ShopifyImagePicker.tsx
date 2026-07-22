import { useEffect, useMemo, useState } from "react";
import { Search, Loader2, ArrowLeft, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchProducts, ShopifyProduct } from "@/lib/shopify";

interface ShopifyImagePickerProps {
  onPick: (imageUrl: string) => void;
}

/**
 * Seletor de imagem Shopify (para cards de carrossel).
 * - Busca por nome / SKU / GTIN (SEM auto-seleção enquanto digita).
 * - Ao clicar num produto, abre a galeria com TODAS as imagens dele (produto + variações).
 * - Ao clicar numa imagem, aplica no card.
 */
export function ShopifyImagePicker({ onPick }: ShopifyImagePickerProps) {
  const [allProducts, setAllProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [openProductId, setOpenProductId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await fetchProducts(250);
      setAllProducts(data);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return allProducts;
    return allProducts.filter((p) => {
      if (p.node.title.toLowerCase().includes(q)) return true;
      return p.node.variants.edges.some(
        (v) =>
          (v.node.sku && v.node.sku.toLowerCase().includes(q)) ||
          (v.node.barcode && v.node.barcode.toLowerCase().includes(q)),
      );
    });
  }, [debounced, allProducts]);

  const openProduct = openProductId
    ? allProducts.find((p) => p.node.id === openProductId) || null
    : null;

  const gallery = useMemo(() => {
    if (!openProduct) return [] as { url: string; alt?: string }[];
    const urls: string[] = [];
    const push = (u?: string | null, alt?: string | null) => {
      if (!u) return;
      if (urls.includes(u)) return;
      urls.push(u);
    };
    openProduct.node.images.edges.forEach((e) => push(e.node.url, e.node.altText));
    openProduct.node.variants.edges.forEach((v) => push(v.node.image?.url));
    return urls.map((url) => ({ url }));
  }, [openProduct]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // --- Galeria de imagens do produto selecionado ---
  if (openProduct) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpenProductId(null)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <p className="font-medium text-sm truncate">{openProduct.node.title}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Clique numa imagem para aplicar no card.
        </p>
        <ScrollArea className="h-[400px]">
          {gallery.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              Este produto não tem imagens cadastradas.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 pr-3">
              {gallery.map((img) => (
                <button
                  key={img.url}
                  type="button"
                  onClick={() => onPick(img.url)}
                  className="group relative aspect-square overflow-hidden rounded-md border border-border hover:border-primary transition-colors"
                >
                  <img
                    src={img.url}
                    alt={openProduct.node.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/20 flex items-center justify-center transition-colors">
                    <Check className="h-6 w-6 text-primary opacity-0 group-hover:opacity-100" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    );
  }

  // --- Lista de produtos ---
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, SKU ou GTIN..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>
      <ScrollArea className="h-[400px]">
        <div className="space-y-2 pr-3">
          {filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">
              Nenhum produto encontrado
            </p>
          ) : (
            filtered.map((p) => {
              const cover = p.node.images.edges[0]?.node.url;
              const imgCount =
                p.node.images.edges.length +
                p.node.variants.edges.filter(
                  (v) =>
                    v.node.image?.url &&
                    !p.node.images.edges.some((e) => e.node.url === v.node.image?.url),
                ).length;
              return (
                <button
                  key={p.node.id}
                  type="button"
                  onClick={() => setOpenProductId(p.node.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/60 hover:bg-muted/40 transition-colors text-left"
                >
                  {cover && (
                    <img
                      src={cover}
                      alt={p.node.title}
                      className="w-14 h-14 rounded-md object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{p.node.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {imgCount} {imgCount === 1 ? "imagem" : "imagens"} disponíveis
                    </p>
                  </div>
                  <span className="text-xs text-primary font-medium">Ver imagens →</span>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
