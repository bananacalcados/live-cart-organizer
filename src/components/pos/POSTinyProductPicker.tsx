import { useState, useRef, useEffect } from "react";
import { Search, Loader2, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

interface TinyProduct {
  tiny_id: number;
  sku: string;
  name: string;
  variant: string;
  size: string | null;
  category: string | null;
  price: number;
  barcode: string;
  stock: number;
}

interface Props {
  storeId: string;
  label?: string;
  value: string;
  onSelect: (product: { product_name: string; sku: string; unit_price: number; size?: string; tiny_id?: number; barcode?: string }) => void;
  placeholder?: string;
}

export function POSTinyProductPicker({ storeId, label = "Produto", value, onSelect, placeholder = "Buscar produto..." }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TinyProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const searchProducts = async (term: string) => {
    if (term.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const isBarcode = /^\d{8,14}$/.test(term);

      // First try local DB — use unaccent RPC for text search, include ALL products (even zero stock)
      let localData: any[] | null = null;

      if (isBarcode) {
        const { data } = await supabase
          .from('pos_products')
          .select('*')
          .eq('store_id', storeId)
          .or(`barcode.eq.${term},sku.eq.${term}`)
          .order('name')
          .limit(20);
        localData = data;
      } else {
        // Use unaccent RPC for accent-insensitive search, no is_active filter
        const { data } = await supabase
          .rpc('search_products_unaccent', { search_term: term, p_store_id: storeId }) as any;
        localData = data;
      }

      if (localData && localData.length > 0) {
        const mapped: TinyProduct[] = localData.map((row: any) => ({
          tiny_id: row.tiny_id,
          sku: row.sku || '',
          name: row.name,
          variant: row.variant || '',
          size: row.size || null,
          category: row.category || null,
          price: parseFloat(row.price || '0'),
          barcode: row.barcode || '',
          stock: parseFloat(row.stock || '0'),
        }));
        setResults(mapped);
        setShowDropdown(true);
        setSearching(false);
        return;
      }

      // Fallback: try Tiny API
      const { data, error } = await supabase.functions.invoke("pos-tiny-search-product", {
        body: { store_id: storeId, query: isBarcode ? undefined : term, gtin: isBarcode ? term : undefined },
      });
      if (!error && data?.products) {
        setResults(data.products);
        setShowDropdown(true);
      }
    } catch {
      // ignore
    } finally {
      setSearching(false);
    }
  };

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchProducts(val.trim()), 500);
  };

  const handleSelect = (p: TinyProduct) => {
    const displayName = p.variant ? `${p.name} - ${p.variant}` : p.name;
    onSelect({
      product_name: displayName,
      sku: p.sku,
      unit_price: p.price,
      size: p.size || undefined,
      tiny_id: p.tiny_id,
      barcode: p.barcode,
    });
    setQuery("");
    setShowDropdown(false);
    setResults([]);
  };

  return (
    <div ref={containerRef} className="relative">
      <Label className="text-pos-white/50 text-[10px]">{label}</Label>
      {value ? (
        <div
          className="h-8 text-xs bg-pos-white/5 border border-pos-orange/30 text-pos-white rounded-md px-2 flex items-center justify-between cursor-pointer hover:bg-pos-white/10 transition-colors"
          onClick={() => { onSelect({ product_name: "", sku: "", unit_price: 0 }); }}
          title="Clique para trocar"
        >
          <span className="truncate">{value}</span>
          <Search className="h-3 w-3 text-pos-white/30 flex-shrink-0 ml-1" />
        </div>
      ) : (
        <div className="relative">
          <Input
            value={query}
            onChange={e => handleInputChange(e.target.value)}
            placeholder={placeholder}
            className="h-8 text-xs bg-pos-white/5 border-pos-orange/30 text-pos-white pl-7"
            onFocus={() => { if (results.length) setShowDropdown(true); }}
          />
          {searching ? (
            <Loader2 className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-pos-orange" />
          ) : (
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-pos-white/30" />
          )}
        </div>
      )}

      {showDropdown && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-pos-black border border-pos-orange/30 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {results.map((p, i) => (
            <button
              key={`${p.tiny_id}-${p.sku}-${i}`}
              className="w-full text-left px-3 py-2 hover:bg-pos-orange/10 transition-colors border-b border-pos-white/5 last:border-0"
              onClick={() => handleSelect(p)}
            >
              <div className="flex items-center gap-2">
                <Package className="h-3 w-3 text-pos-orange flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-pos-white truncate">
                    {p.name} {p.variant && <span className="text-pos-orange">- {p.variant}</span>}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-pos-white/40">
                    {p.sku && <span>SKU: {p.sku}</span>}
                    <span>R$ {p.price.toFixed(2)}</span>
                    <span className={p.stock > 0 ? "text-green-400" : "text-red-400"}>
                      Estoque: {p.stock}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {showDropdown && !searching && query.length >= 2 && results.length === 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-pos-black border border-pos-orange/30 rounded-lg p-3 text-center">
          <p className="text-xs text-pos-white/40">Nenhum produto encontrado</p>
        </div>
      )}
    </div>
  );
}
