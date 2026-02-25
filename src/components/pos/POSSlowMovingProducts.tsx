import { useState, useEffect, useMemo } from "react";
import { Flame, Filter, Loader2, Plus, Tag, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  storeId: string;
  sellerId?: string;
  onAddToCart?: (product: any) => void;
}

interface SlowProduct {
  id: string;
  tiny_id: number;
  sku: string;
  name: string;
  variant: string;
  size?: string;
  price: number;
  stock: number;
  barcode: string;
  category?: string;
  daysSinceLastSale: number;
  suggestedDiscount: number;
}

function extractSize(name: string): string | null {
  const m = name.match(/ - (\d{2,3}(?:\/\d{2,3})?) (?:- |$)/);
  return m ? m[1] : null;
}

export function POSSlowMovingProducts({ storeId, sellerId, onAddToCart }: Props) {
  const [products, setProducts] = useState<SlowProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSize, setFilterSize] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [addedSkus, setAddedSkus] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadSlowMovingProducts();
  }, [storeId]);

  const loadSlowMovingProducts = async () => {
    setLoading(true);
    try {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      // Get all active products with stock
      const { data: allProducts } = await supabase
        .from("pos_products")
        .select("*")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .gt("stock", 0)
        .order("name");

      if (!allProducts || allProducts.length === 0) {
        setProducts([]);
        setLoading(false);
        return;
      }

      // Get sales history to find products sold in last 3 months
      const { data: recentSales } = await supabase
        .from("tiny_sales_history" as any)
        .select("sku, period_end")
        .eq("store_id", storeId);

      // Also check pos_sale_items for recent sales
      const { data: posSaleItems } = await supabase
        .from("pos_sale_items" as any)
        .select("sku, created_at")
        .order("created_at", { ascending: false })
        .limit(5000);

      // Build map of last sale date per SKU
      const lastSaleMap = new Map<string, Date>();

      for (const sale of (recentSales as any[]) || []) {
        const date = new Date(sale.period_end);
        const current = lastSaleMap.get(sale.sku);
        if (!current || date > current) lastSaleMap.set(sale.sku, date);
      }

      for (const item of (posSaleItems as any[]) || []) {
        const date = new Date(item.created_at);
        const current = lastSaleMap.get(item.sku);
        if (!current || date > current) lastSaleMap.set(item.sku, date);
      }

      const now = new Date();
      const slowProducts: SlowProduct[] = [];
      const catSet = new Set<string>();
      const sizeSet = new Set<string>();

      for (const p of allProducts) {
        const lastSale = lastSaleMap.get(p.sku);
        const neverSold = !lastSale;
        const isOld = neverSold || lastSale < threeMonthsAgo;

        if (!isOld) continue;

        const daysSince = neverSold
          ? 999
          : Math.floor((now.getTime() - lastSale.getTime()) / (1000 * 60 * 60 * 24));

        // Suggested discount: 5-20% based on how long without sales
        let discount = 5;
        if (daysSince > 365) discount = 20;
        else if (daysSince > 270) discount = 15;
        else if (daysSince > 180) discount = 10;
        else discount = 5;

        const size = extractSize(p.name || "") || p.size || null;
        if (p.category) catSet.add(p.category);
        if (size) sizeSet.add(size);

        slowProducts.push({
          id: `${p.tiny_id}-${p.sku}`,
          tiny_id: p.tiny_id,
          sku: p.sku,
          name: p.name,
          variant: p.variant || "",
          size: size || undefined,
          price: parseFloat(String(p.price || "0")),
          stock: parseFloat(String(p.stock || "0")),
          barcode: p.barcode || "",
          category: p.category || undefined,
          daysSinceLastSale: daysSince,
          suggestedDiscount: discount,
        });
      }

      // Sort: oldest without sale first
      slowProducts.sort((a, b) => b.daysSinceLastSale - a.daysSinceLastSale);

      setProducts(slowProducts);
      setCategories([...catSet].sort());
      setSizes([...sizeSet].sort((a, b) => {
        const na = parseInt(a), nb = parseInt(b);
        return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
      }));
    } catch (e) {
      console.error("Error loading slow-moving products:", e);
      toast.error("Erro ao carregar produtos parados");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return products
      .filter(p => filterCategory === "all" || p.category === filterCategory)
      .filter(p => filterSize === "all" || p.size === filterSize)
      .filter(p => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.includes(searchQuery))
        );
      });
  }, [products, filterCategory, filterSize, searchQuery]);

  const handleAddToCart = async (product: SlowProduct) => {
    const discountedPrice = product.price * (1 - product.suggestedDiscount / 100);

    if (onAddToCart) {
      onAddToCart({
        ...product,
        price: discountedPrice,
        originalPrice: product.price,
        quantity: 1,
        fromSlowMoving: true, // Flag for gamification
      });
    }

    // Award 20 gamification points to the seller
    if (sellerId) {
      try {
        const { data: gam } = await supabase
          .from("pos_gamification")
          .select("id, weekly_points, total_points")
          .eq("seller_id", sellerId)
          .eq("store_id", storeId)
          .maybeSingle();

        if (gam) {
          await supabase.from("pos_gamification").update({
            weekly_points: (gam.weekly_points || 0) + 20,
            total_points: (gam.total_points || 0) + 20,
          }).eq("id", gam.id);
        } else {
          await supabase.from("pos_gamification").insert({
            seller_id: sellerId,
            store_id: storeId,
            weekly_points: 20,
            total_points: 20,
            total_sales: 0,
            complete_registrations: 0,
            fast_requests_answered: 0,
            returns_count: 0,
          } as any);
        }
        toast.success("+20 pts! 🎯 Produto queima de estoque");
      } catch (e) {
        console.error("Gamification error:", e);
      }
    }

    setAddedSkus(prev => new Set(prev).add(product.sku));
  };

  const getDaysLabel = (days: number) => {
    if (days >= 999) return "Nunca vendeu";
    if (days >= 365) return `${Math.floor(days / 30)} meses parado`;
    if (days >= 30) return `${Math.floor(days / 30)} meses sem venda`;
    return `${days} dias sem venda`;
  };

  const getDiscountColor = (discount: number) => {
    if (discount >= 20) return "bg-red-500/20 text-red-400 border-red-500/30";
    if (discount >= 15) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    if (discount >= 10) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    return "bg-green-500/20 text-green-400 border-green-500/30";
  };

  return (
    <div className="h-full flex flex-col bg-pos-black">
      {/* Header */}
      <div className="p-4 border-b border-pos-orange/20 flex-shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <Flame className="h-5 w-5 text-red-500" />
          <h2 className="text-lg font-bold text-pos-white">Queima de Estoque</h2>
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
            {products.length} produtos
          </Badge>
        </div>
        <p className="text-xs text-pos-white/50 mb-3">
          Produtos sem vendas há mais de 3 meses. Desconto sugerido de até 20%. Ganhe +20 pts na gamificação!
        </p>

        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-white/30" />
          <Input
            placeholder="Buscar por nome, SKU ou código..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-pos-white/5 border-pos-orange/20 text-pos-white placeholder:text-pos-white/30"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="h-8 text-xs bg-pos-white/5 border-pos-orange/20 text-pos-white flex-1">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorias</SelectItem>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterSize} onValueChange={setFilterSize}>
            <SelectTrigger className="h-8 text-xs bg-pos-white/5 border-pos-orange/20 text-pos-white flex-1">
              <Tag className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Tamanho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos tamanhos</SelectItem>
              {sizes.map(size => (
                <SelectItem key={size} value={size}>{size}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Product List */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-pos-orange/50" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-pos-white/40 gap-3">
          <Flame className="h-16 w-16 opacity-30" />
          <p className="text-sm">Nenhum produto parado encontrado</p>
          <p className="text-xs text-pos-white/30">Todos os produtos estão vendendo normalmente 🎉</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {filtered.map(p => {
              const discountedPrice = p.price * (1 - p.suggestedDiscount / 100);
              const isAdded = addedSkus.has(p.sku);

              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-pos-orange/10 bg-pos-white/5 hover:border-pos-orange/30 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-pos-white truncate">{p.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-pos-white/40 font-mono">{p.sku}</span>
                      {p.size && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-pos-white/20 text-pos-white/50">
                          Tam {p.size}
                        </Badge>
                      )}
                      {p.category && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-pos-white/20 text-pos-white/50">
                          {p.category}
                        </Badge>
                      )}
                      <span className="text-[10px] text-pos-white/30">Est: {p.stock}</span>
                    </div>
                    <p className="text-[10px] text-red-400/70 mt-0.5">
                      🔥 {getDaysLabel(p.daysSinceLastSale)}
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] text-pos-white/30 line-through">
                      R$ {p.price.toFixed(2)}
                    </p>
                    <p className="text-sm font-bold text-green-400">
                      R$ {discountedPrice.toFixed(2)}
                    </p>
                    <Badge className={`text-[9px] px-1 ${getDiscountColor(p.suggestedDiscount)}`}>
                      -{p.suggestedDiscount}%
                    </Badge>
                  </div>

                  <Button
                    size="icon"
                    disabled={isAdded}
                    className="h-8 w-8 bg-red-500 text-white hover:bg-red-600 flex-shrink-0 disabled:opacity-50"
                    onClick={() => handleAddToCart(p)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Scoring info */}
      <div className="p-3 border-t border-pos-orange/20 flex-shrink-0">
        <div className="rounded-lg bg-pos-white/5 border border-pos-orange/20 p-2 flex items-center justify-between">
          <span className="text-[10px] text-pos-white/50">🎯 Cada venda desta aba</span>
          <Badge className="bg-pos-orange/20 text-pos-orange border-pos-orange/30 text-xs font-bold">
            +20 pts
          </Badge>
        </div>
      </div>
    </div>
  );
}
