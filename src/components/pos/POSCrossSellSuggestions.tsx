import { useState, useEffect } from "react";
import { Sparkles, Plus, Tag, TrendingDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface CartItem {
  id: string;
  sku: string;
  name: string;
  variant: string;
  size?: string;
  price: number;
  quantity: number;
  tiny_id?: number;
  barcode: string;
  category?: string;
  stock?: number;
}

interface Suggestion {
  id: string;
  tiny_id?: number;
  sku: string;
  name: string;
  variant: string;
  size?: string;
  price: number;
  stock: number;
  barcode: string;
  category?: string;
  curve: "A" | "B" | "C";
  maxDiscount: number;
  reason: string;
}

interface Props {
  storeId: string;
  cart: CartItem[];
  onAddToCart: (product: any) => void;
}

export function POSCrossSellSuggestions({ storeId, cart, onAddToCart }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (cart.length === 0) {
      setSuggestions([]);
      return;
    }
    loadSuggestions();
  }, [cart.length, storeId]);

  const loadSuggestions = async () => {
    if (cart.length === 0) return;
    setLoading(true);
    try {
      // Extract sizes from cart
      const cartSizes = [...new Set(cart.map(i => i.size).filter(Boolean))] as string[];
      const cartSkus = cart.map(i => i.sku);

      if (cartSizes.length === 0) {
        setSuggestions([]);
        setLoading(false);
        return;
      }

      // Get ABC curve data: sales counts in last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const { data: salesData } = await supabase
        .from("pos_sale_items" as any)
        .select("sku, quantity")
        .limit(1000);

      // Aggregate sales by SKU
      const skuSales = new Map<string, number>();
      for (const item of (salesData as any[]) || []) {
        skuSales.set(item.sku, (skuSales.get(item.sku) || 0) + (item.quantity || 0));
      }

      // Sort and classify ABC
      const sorted = [...skuSales.entries()].sort((a, b) => b[1] - a[1]);
      const total = sorted.length;
      const curveMap = new Map<string, "A" | "B" | "C">();
      sorted.forEach(([sku], i) => {
        const pct = (i + 1) / total;
        curveMap.set(sku, pct <= 0.2 ? "A" : pct <= 0.5 ? "B" : "C");
      });

      // Get products in same sizes with stock > 0, not already in cart
      const { data: products } = await supabase
        .from("pos_products")
        .select("*")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .in("size", cartSizes)
        .gt("stock", 0)
        .not("sku", "in", `(${cartSkus.join(",")})`)
        .order("stock", { ascending: false })
        .limit(50);

      if (!products || products.length === 0) {
        setSuggestions([]);
        setLoading(false);
        return;
      }

      const results: Suggestion[] = [];

      for (const p of products) {
        const curve = curveMap.get(p.sku) || "C"; // Not sold = curve C
        const isSize34 = p.size === "34";
        
        let maxDiscount = 0;
        let reason = "";

        if (isSize34) {
          // Size 34 special rules
          if (curve === "A") {
            maxDiscount = 15;
            reason = "Tam 34 · Curva A · Estoque alto";
          } else if (curve === "B") {
            maxDiscount = 30;
            reason = "Tam 34 · Curva B";
          } else {
            maxDiscount = 50;
            reason = "Tam 34 · Curva C · Oportunidade";
          }
        } else {
          // Normal rules
          if (curve === "B") {
            maxDiscount = 15;
            reason = "Curva B · Rotação média";
          } else if (curve === "C") {
            maxDiscount = 30;
            reason = "Curva C · Baixa rotação";
          } else {
            // Curve A without size 34 - no special discount, but can still suggest
            maxDiscount = 0;
            reason = "Curva A · Best seller";
          }
        }

        // Only suggest if there's a discount or it's a high-value item
        if (maxDiscount > 0 || curve === "A") {
          results.push({
            id: `${p.tiny_id}-${p.sku}-${p.variant}`,
            tiny_id: p.tiny_id,
            sku: p.sku,
            name: p.name,
            variant: p.variant || "",
            size: p.size,
            price: parseFloat(String(p.price || "0")),
            stock: parseFloat(String(p.stock || "0")),
            barcode: p.barcode || "",
            category: p.category,
            curve,
            maxDiscount,
            reason,
          });
        }
      }

      // Sort: highest discount first, then by stock desc
      results.sort((a, b) => b.maxDiscount - a.maxDiscount || b.stock - a.stock);
      setSuggestions(results.slice(0, 6));
    } catch (e) {
      console.error("Cross-sell error:", e);
    } finally {
      setLoading(false);
    }
  };

  const visibleSuggestions = suggestions.filter(s => !dismissed.has(s.id));

  if (visibleSuggestions.length === 0 && !loading) return null;

  const curveColors: Record<string, string> = {
    A: "bg-green-500/20 text-green-400 border-green-500/30",
    B: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    C: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  return (
    <div className="border-t border-pos-orange/20 bg-gradient-to-b from-pos-orange/5 to-transparent">
      <div className="px-3 py-2 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-pos-orange" />
        <span className="text-xs font-bold text-pos-orange">Sugestões inteligentes</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-pos-orange/50" />}
      </div>
      <div className="px-3 pb-3 space-y-1.5">
        {visibleSuggestions.map(s => {
          const discountedPrice = s.maxDiscount > 0 ? s.price * (1 - s.maxDiscount / 100) : s.price;
          return (
            <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg border border-pos-orange/10 bg-pos-white/5 hover:border-pos-orange/30 transition-all">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-pos-white truncate">{s.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge className={`text-[9px] px-1 py-0 ${curveColors[s.curve]}`}>
                    {s.curve}
                  </Badge>
                  <span className="text-[10px] text-pos-white/40">{s.sku}</span>
                  {s.size && <span className="text-[10px] text-pos-white/40">Tam {s.size}</span>}
                  <span className="text-[10px] text-pos-white/30">Est: {s.stock}</span>
                </div>
                <p className="text-[10px] text-pos-white/40 mt-0.5">{s.reason}</p>
              </div>
              <div className="text-right flex-shrink-0">
                {s.maxDiscount > 0 ? (
                  <>
                    <p className="text-[10px] text-pos-white/30 line-through">R$ {s.price.toFixed(2)}</p>
                    <p className="text-xs font-bold text-green-400">R$ {discountedPrice.toFixed(2)}</p>
                    <Badge className="text-[9px] bg-green-500/20 text-green-400 border-green-500/30 px-1">
                      -{s.maxDiscount}%
                    </Badge>
                  </>
                ) : (
                  <p className="text-xs font-bold text-pos-orange">R$ {s.price.toFixed(2)}</p>
                )}
              </div>
              <Button
                size="icon"
                className="h-7 w-7 bg-pos-orange text-pos-black hover:bg-pos-orange-muted flex-shrink-0"
                onClick={() => {
                  onAddToCart({
                    ...s,
                    price: s.maxDiscount > 0 ? discountedPrice : s.price,
                    quantity: 1,
                  });
                  setDismissed(prev => new Set(prev).add(s.id));
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
