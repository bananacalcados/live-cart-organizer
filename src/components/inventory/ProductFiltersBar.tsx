import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Filter, X } from "lucide-react";

export interface ProductFilters {
  brandId: string;      // "" = all
  categoryId: string;   // "" = all
  createdFrom: string;  // yyyy-mm-dd
  createdTo: string;
  priceMin: string;
  priceMax: string;
  noCost: boolean;
  noPrice: boolean;
  noBrand: boolean;
  noCategory: boolean;
}

export const emptyProductFilters: ProductFilters = {
  brandId: "", categoryId: "", createdFrom: "", createdTo: "",
  priceMin: "", priceMax: "", noCost: false, noPrice: false,
  noBrand: false, noCategory: false,
};

export function countActive(f: ProductFilters) {
  let n = 0;
  if (f.brandId) n++;
  if (f.categoryId) n++;
  if (f.createdFrom || f.createdTo) n++;
  if (f.priceMin || f.priceMax) n++;
  if (f.noCost) n++;
  if (f.noPrice) n++;
  if (f.noBrand) n++;
  if (f.noCategory) n++;
  return n;
}

interface Props {
  value: ProductFilters;
  onChange: (f: ProductFilters) => void;
}

export function ProductFiltersBar({ value, onChange }: Props) {
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [local, setLocal] = useState<ProductFilters>(value);

  useEffect(() => { setLocal(value); }, [value]);

  useEffect(() => {
    (async () => {
      const [{ data: b }, { data: c }] = await Promise.all([
        supabase.from("product_brands" as any).select("id,name").order("name"),
        supabase.from("product_categories").select("id,name").order("name"),
      ]);
      setBrands((b || []) as any);
      setCategories((c || []) as any);
    })();
  }, []);

  const active = countActive(value);

  function apply() { onChange(local); }
  function clear() {
    setLocal(emptyProductFilters);
    onChange(emptyProductFilters);
  }

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <Filter className="h-4 w-4" /> Filtros
            {active > 0 && <Badge variant="secondary" className="ml-1 h-5">{active}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <div>
            <Label className="text-xs">Marca</Label>
            <Select value={local.brandId || "__all__"} onValueChange={v => setLocal({ ...local, brandId: v === "__all__" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {brands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <Select value={local.categoryId || "__all__"} onValueChange={v => setLocal({ ...local, categoryId: v === "__all__" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Criado de</Label>
              <Input type="date" value={local.createdFrom} onChange={e => setLocal({ ...local, createdFrom: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Criado até</Label>
              <Input type="date" value={local.createdTo} onChange={e => setLocal({ ...local, createdTo: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Preço mín.</Label>
              <Input type="number" min="0" step="0.01" value={local.priceMin} onChange={e => setLocal({ ...local, priceMin: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Preço máx.</Label>
              <Input type="number" min="0" step="0.01" value={local.priceMax} onChange={e => setLocal({ ...local, priceMax: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={local.noCost} onChange={e => setLocal({ ...local, noCost: e.target.checked })} />
              Sem preço de custo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={local.noPrice} onChange={e => setLocal({ ...local, noPrice: e.target.checked })} />
              Sem preço de venda
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={local.noBrand} onChange={e => setLocal({ ...local, noBrand: e.target.checked })} />
              Sem marca
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={local.noCategory} onChange={e => setLocal({ ...local, noCategory: e.target.checked })} />
              Sem categoria
            </label>
          </div>
          <div className="flex gap-2 justify-end pt-1 border-t">
            <Button variant="ghost" size="sm" onClick={clear}>Limpar</Button>
            <Button size="sm" onClick={apply}>Aplicar</Button>
          </div>
        </PopoverContent>
      </Popover>
      {active > 0 && (
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground" onClick={clear}>
          <X className="h-3 w-3" /> limpar
        </Button>
      )}
    </div>
  );
}

/** Reusable client-side filter predicate for a row with the standard fields. */
export function matchesProductFilters(
  row: { brand_id?: string | null; category_id?: string | null; brand?: string | null; category?: string | null; created_at?: string | null; cost_price?: number | string | null; sale_price?: number | string | null },
  f: ProductFilters,
): boolean {
  if (f.brandId && row.brand_id !== f.brandId) return false;
  if (f.categoryId && row.category_id !== f.categoryId) return false;
  if (f.createdFrom && (!row.created_at || row.created_at < f.createdFrom)) return false;
  if (f.createdTo && (!row.created_at || row.created_at.slice(0, 10) > f.createdTo)) return false;
  const cost = Number(row.cost_price ?? 0);
  const sale = Number(row.sale_price ?? 0);
  if (f.noCost && cost > 0) return false;
  if (f.noPrice && sale > 0) return false;
  if (f.priceMin && !(sale >= Number(f.priceMin))) return false;
  if (f.priceMax && !(sale <= Number(f.priceMax))) return false;
  if (f.noBrand && (row.brand_id || (row.brand && row.brand.trim()))) return false;
  if (f.noCategory && (row.category_id || (row.category && row.category.trim()))) return false;
  return true;
}
