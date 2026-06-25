import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Loader2, RefreshCw, Filter, Search, Download, X,
  Package, DollarSign, TrendingUp, Boxes, AlertTriangle, Layers, Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ---------- Types ----------
type RawProduct = {
  id: string;
  store_id: string;
  tiny_id: number;
  sku: string | null;
  barcode: string | null;
  name: string;
  variant: string | null;
  size: string | null;
  color: string | null;
  category: string | null;
  price: number;
  cost_price: number;
  stock: number;
  is_active: boolean;
  updated_at: string;
};

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const fixed = (value: unknown, digits = 2) => toNumber(value).toFixed(digits);

type EnrichedProduct = RawProduct & {
  brand: string;
  parent_key: string; // chave do "produto pai" (sem tamanho/cor)
};

type SalesAgg = {
  qty: number;
  revenue: number;
};

// ---------- Helpers ----------
const fmtMoney = (v: number) =>
  toNumber(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number) => toNumber(v).toLocaleString("pt-BR");

function parseBrand(name: string): string {
  if (!name) return "—";
  // Padrão: "TENIS USAFLEX COURO GABI - 38 - Ouro" → "USAFLEX"
  // Heurística: pula tokens genéricos (TENIS, CHINELO, SANDALIA, BOTA, SAPATO,
  // BABUCHES, TAMANCO, RASTEIRA, MOCASSIM, BOTINHA, SAPATILHA), pega o próximo.
  const generic = new Set([
    "TENIS", "TÊNIS", "CHINELO", "SANDALIA", "SANDÁLIA", "BOTA", "SAPATO",
    "BABUCHES", "BABUCHE", "TAMANCO", "RASTEIRA", "MOCASSIM", "BOTINHA",
    "SAPATILHA", "PANTUFA", "MULE", "SLIDE", "PAPETE", "SCARPIN", "SLIPPER",
    "CASUAL", "MASCULINO", "FEMININO", "INFANTIL", "ESPORTIVO", "COURO",
  ]);
  const tokens = name.toUpperCase().split(/[\s-]+/).filter(Boolean);
  for (const t of tokens) {
    if (/^\d+$/.test(t)) continue;
    if (generic.has(t)) continue;
    if (t.length < 3) continue;
    return t;
  }
  return tokens[0] || "—";
}

// Conjuntos para detectar inversão tamanho⇄cor (pente fino)
const SIZE_TOKENS = new Set([
  "PP", "P", "M", "G", "GG", "XG", "XGG", "XS", "S", "L", "XL", "XXL",
  "ÚNICO", "UNICO", "U", "UN",
]);
const COLOR_KEYWORDS = [
  "PRETO", "BRANCO", "BEGE", "NUDE", "MARROM", "CARAMELO", "AZUL", "VERDE",
  "VERMELH", "ROSA", "ROXO", "LILAS", "LILÁS", "AMAREL", "CINZA", "PRATA",
  "DOURAD", "OURO", "BRONZE", "COBRE", "OFF", "OFFWHITE", "OFF-WHITE",
  "MOSTARDA", "VINHO", "TURQUESA", "TIFFANY", "PINK", "FUCSIA", "FÚCSIA",
  "GRAFITE", "TERRACOTA", "AREIA", "TAUPE", "MUSGO", "OLIVA", "JEANS",
  "MARINHO", "CELESTE", "CORAL", "SALMÃO", "SALMAO", "LARANJA", "CHUMBO",
  "CHAMPAGNE", "CHAMPANHE", "RUBI", "ESMERALDA", "PEROLA", "PÉROLA",
  "ESTAMPAD", "ANIMAL", "ONÇA", "ONCA", "FLORAL", "MULTICOR", "TRANSPARENTE",
  "MESCLA", "GLITTER", "METALIZ", "FOSCO", "BRILH",
];

function looksLikeSize(v: string): boolean {
  if (!v) return false;
  const t = v.trim().toUpperCase();
  if (!t) return false;
  // Numérico puro (34, 38), faixa (33/34), decimal
  if (/^\d{1,2}([.,/-]\d{1,2})?$/.test(t)) return true;
  if (SIZE_TOKENS.has(t)) return true;
  return false;
}

function looksLikeColor(v: string): boolean {
  if (!v) return false;
  const t = v.trim().toUpperCase();
  if (!t) return false;
  if (looksLikeSize(t)) return false;
  // Tem letras (não é só dígito) e não é um token de tamanho
  if (/[A-ZÀ-Ú]/.test(t)) {
    if (COLOR_KEYWORDS.some((k) => t.includes(k))) return true;
    // Heurística: 3+ letras sem números → provavelmente cor
    if (/^[A-ZÀ-Ú\s/-]{3,}$/.test(t)) return true;
  }
  return false;
}

/** Detecta e corrige inversão tamanho⇄cor vinda do Tiny. */
function fixSizeColor(size: string | null, color: string | null): { size: string | null; color: string | null; swapped: boolean } {
  const s = (size || "").trim();
  const c = (color || "").trim();
  if (!s && !c) return { size: null, color: null, swapped: false };
  // Caso clássico: size parece cor E color parece tamanho → inverter
  if (s && c && looksLikeColor(s) && looksLikeSize(c)) {
    return { size: c, color: s, swapped: true };
  }
  // size sozinho, mas é cor → mover para color
  if (s && !c && looksLikeColor(s) && !looksLikeSize(s)) {
    return { size: null, color: s, swapped: true };
  }
  // color sozinho, mas é tamanho → mover para size
  if (!s && c && looksLikeSize(c)) {
    return { size: c, color: null, swapped: true };
  }
  return { size: s || null, color: c || null, swapped: false };
}

function parentKey(p: RawProduct): string {
  // Tenta agrupar por SKU root (parte antes do tamanho/cor) ou pelo nome sem variação
  const baseName = p.name.split(" - ")[0]?.trim() || p.name;
  // Se SKU tem padrão "ROOT-COR-TAM", pega o root
  if (p.sku && /-/.test(p.sku)) {
    return p.sku.split("-")[0];
  }
  return baseName.toUpperCase();
}

// ---------- Component ----------
export function InventoryAnalytics() {
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<EnrichedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Filtros
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [sizeFilter, setSizeFilter] = useState<string>("all");
  const [colorFilter, setColorFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<"all" | "with" | "without">("with");
  const [scopeFilter, setScopeFilter] = useState<"variants" | "parents">("variants");
  const [coverageScope, setCoverageScope] = useState<"variants" | "parents">("variants");
  const [coverageBucket, setCoverageBucket] = useState<"all" | "critical" | "low" | "healthy" | "excess" | "noSales">("all");

  // Vendas / Curva ABC
  const [periodDays, setPeriodDays] = useState<number>(90);
  const [sales, setSales] = useState<Map<string, SalesAgg>>(new Map());
  const [loadingSales, setLoadingSales] = useState(false);

  // Carregar produtos
  async function loadProducts() {
    setLoading(true);
    setProducts([]);

    const { data: storeRows } = await supabase
      .from("pos_stores")
      .select("id, name")
      .eq("is_active", true)
      .eq("is_simulation", false)
      .eq("has_tiny_token", true);
    setStores(storeRows || []);

    // Conta total
    const { count } = await supabase
      .from("pos_products")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    setProgress({ done: 0, total: count || 0 });

    const all: EnrichedProduct[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("pos_products")
        .select("id, store_id, tiny_id, sku, barcode, name, variant, size, color, category, price, cost_price, stock, is_active, updated_at")
        .eq("is_active", true)
        .order("id")
        .range(from, from + pageSize - 1);
      if (error) {
        toast.error("Erro ao carregar produtos: " + error.message);
        break;
      }
      if (!data || data.length === 0) break;
      for (const r of data as any[]) {
        const raw = r as RawProduct;
        const sizeColor = fixSizeColor(raw.size, raw.color);
        all.push({
          ...raw,
          size: sizeColor.size,
          color: sizeColor.color,
          stock: toNumber(raw.stock),
          cost_price: toNumber(raw.cost_price),
          price: toNumber(raw.price),
          brand: parseBrand(raw.name),
          parent_key: parentKey(raw),
        });
      }
      from += pageSize;
      setProgress({ done: all.length, total: count || all.length });
      if (data.length < pageSize) break;
    }
    setProducts(all);
    setLoading(false);
  }

  // Carregar vendas (agregado por SKU/tiny_id) no período
  async function loadSales(days: number) {
    setLoadingSales(true);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const map = new Map<string, SalesAgg>();
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("pos_sale_items")
        .select("sku, tiny_product_id, quantity, total_price, created_at")
        .gte("created_at", since.toISOString())
        .range(from, from + pageSize - 1);
      if (error) {
        toast.error("Erro ao carregar vendas: " + error.message);
        break;
      }
      if (!data || data.length === 0) break;
      for (const r of data as any[]) {
        const key = (r.sku && String(r.sku)) || (r.tiny_product_id && String(r.tiny_product_id)) || "";
        if (!key) continue;
        const cur = map.get(key) || { qty: 0, revenue: 0 };
        cur.qty += Number(r.quantity || 0);
        cur.revenue += Number(r.total_price || 0);
        map.set(key, cur);
      }
      from += pageSize;
      if (data.length < pageSize) break;
    }
    setSales(map);
    setLoadingSales(false);
  }

  useEffect(() => { loadProducts(); }, []);
  useEffect(() => { loadSales(periodDays); }, [periodDays]);

  // Listas distintas para filtros
  const brands = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => s.add(p.brand));
    return Array.from(s).sort();
  }, [products]);
  const sizes = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => p.size && s.add(p.size));
    return Array.from(s).sort((a, b) => {
      const na = parseFloat(a); const nb = parseFloat(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [products]);
  const colors = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => p.color && s.add(p.color));
    return Array.from(s).sort();
  }, [products]);
  const categories = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => p.category && s.add(p.category));
    return Array.from(s).sort();
  }, [products]);

  // Filtragem
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (storeFilter !== "all" && p.store_id !== storeFilter) return false;
      if (brandFilter !== "all" && p.brand !== brandFilter) return false;
      if (sizeFilter !== "all" && (p.size || "") !== sizeFilter) return false;
      if (colorFilter !== "all" && (p.color || "") !== colorFilter) return false;
      if (categoryFilter !== "all" && (p.category || "") !== categoryFilter) return false;
      if (stockFilter === "with" && p.stock <= 0) return false;
      if (stockFilter === "without" && p.stock > 0) return false;
      if (q && !(
        p.name.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [products, search, storeFilter, brandFilter, sizeFilter, colorFilter, categoryFilter, stockFilter]);

  // Agregação pai/filho
  const aggregatedRows = useMemo(() => {
    if (scopeFilter === "variants") return filtered;
    const map = new Map<string, EnrichedProduct & { variants: number }>();
    for (const p of filtered) {
      // Consolida entre lojas quando não há filtro de loja específico
      const k = storeFilter !== "all" ? `${p.store_id}::${p.parent_key}` : p.parent_key;
      const cur = map.get(k);
      if (cur) {
        cur.stock += p.stock;
        cur.cost_price = ((cur.cost_price * (cur.variants || 1)) + p.cost_price) / ((cur.variants || 1) + 1);
        cur.price = ((cur.price * (cur.variants || 1)) + p.price) / ((cur.variants || 1) + 1);
        cur.variants += 1;
      } else {
        map.set(k, { ...p, variants: 1 });
      }
    }
    return Array.from(map.values());
  }, [filtered, scopeFilter]);

  // KPIs
  const kpis = useMemo(() => {
    let qty = 0, cost = 0, sale = 0;
    let stagnant = 0;
    let qtyWithoutCost = 0;
    let skusWithoutCost = 0;
    let saleOfWithoutCost = 0;
    for (const p of filtered) {
      qty += p.stock;
      const hasCost = p.cost_price > 0;
      if (hasCost) {
        cost += p.stock * p.cost_price;
      } else if (p.stock > 0) {
        qtyWithoutCost += p.stock;
        skusWithoutCost += 1;
        saleOfWithoutCost += p.stock * p.price;
      }
      sale += p.stock * p.price;
      const key = (p.sku && String(p.sku)) || (p.tiny_id && String(p.tiny_id)) || "";
      if (p.stock > 0 && (!sales.get(key) || sales.get(key)!.qty === 0)) {
        stagnant += p.stock;
      }
    }
    // Custo estimado: completa os produtos sem custo usando markup médio observado
    // markup médio = sale / cost (apenas dos que têm custo)
    const observedCostRatio = cost > 0 && (sale - saleOfWithoutCost) > 0
      ? cost / (sale - saleOfWithoutCost)
      : 0;
    const estimatedExtraCost = observedCostRatio > 0 ? saleOfWithoutCost * observedCostRatio : 0;
    return {
      skus: filtered.length,
      qty, cost, sale,
      margin: sale - cost,
      stagnant,
      qtyWithoutCost,
      skusWithoutCost,
      saleOfWithoutCost,
      costEstimated: cost + estimatedExtraCost,
      observedMarkup: cost > 0 ? (sale - saleOfWithoutCost) / cost : 0,
    };
  }, [filtered, sales]);

  // Curva ABC (por período) — usa filtered
  const abcRows = useMemo(() => {
    type Row = {
      key: string;
      label: string;
      qty: number;
      revenue: number;
      stock: number;
      cost: number;
      classe: "A" | "B" | "C";
      pct: number;
      cumPct: number;
      _countedSkus: Set<string>;
    };
    const map = new Map<string, Row>();
    for (const p of filtered) {
      // Consolida entre lojas quando não há filtro de loja específico
      const key = scopeFilter === "parents"
        ? (storeFilter !== "all" ? `${p.store_id}::${p.parent_key}` : p.parent_key)
        : (storeFilter !== "all"
            ? `${p.store_id}::${(p.sku && String(p.sku)) || String(p.tiny_id)}`
            : (p.sku && String(p.sku)) || String(p.tiny_id));
      const label = scopeFilter === "parents"
        ? p.name.split(" - ")[0]
        : `${p.name}${p.size ? ` · ${p.size}` : ""}${p.color ? ` · ${p.color}` : ""}`;
      const sk = (p.sku && String(p.sku)) || String(p.tiny_id);
      const sales_ = sales.get(sk) || { qty: 0, revenue: 0 };

      const cur = map.get(key);
      if (cur) {
        // Vendas (sales map) são globais por SKU — só contar uma vez por SKU dentro do grupo
        if (!cur._countedSkus.has(sk)) {
          cur.qty += sales_.qty;
          cur.revenue += sales_.revenue;
          cur._countedSkus.add(sk);
        }
        cur.stock += p.stock;
        cur.cost += p.stock * p.cost_price;
      } else {
        map.set(key, {
          key, label,
          qty: sales_.qty,
          revenue: sales_.revenue,
          stock: p.stock,
          cost: p.stock * p.cost_price,
          classe: "C", pct: 0, cumPct: 0,
          _countedSkus: new Set([sk]),
        } as any);
      }
    }
    const rows = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
    const total = rows.reduce((a, b) => a + b.revenue, 0) || 1;
    let cum = 0;
    for (const r of rows) {
      r.pct = (r.revenue / total) * 100;
      cum += r.pct;
      r.cumPct = cum;
      r.classe = cum <= 80 ? "A" : cum <= 95 ? "B" : "C";
    }
    return rows.filter((r) => r.revenue > 0 || r.stock > 0);
  }, [filtered, sales, scopeFilter]);

  // Produtos parados (mais antigos sem venda)
  const stagnantRows = useMemo(() => {
    return filtered
      .filter((p) => {
        if (p.stock <= 0) return false;
        const key = (p.sku && String(p.sku)) || String(p.tiny_id);
        const s = sales.get(key);
        return !s || s.qty === 0;
      })
      .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
      .slice(0, 200);
  }, [filtered, sales]);

  // Cobertura de estoque em dias (estoque / vendas-por-dia no período)
  const coverageRows = useMemo(() => {
    type Row = {
      key: string;
      label: string;
      sku: string;
      brand: string;
      category: string;
      size: string;
      color: string;
      stock: number;
      soldQty: number;
      avgDaily: number;
      coverageDays: number | null; // null = sem venda
      cost: number;
      sale: number;
    };
    const map = new Map<string, Row>();
    for (const p of filtered) {
      const isParents = coverageScope === "parents";
      const key = isParents
        ? (storeFilter !== "all" ? `${p.store_id}::${p.parent_key}` : p.parent_key)
        : (storeFilter !== "all"
            ? `${p.store_id}::${(p.sku && String(p.sku)) || String(p.tiny_id)}`
            : (p.sku && String(p.sku)) || String(p.tiny_id));
      const sk = (p.sku && String(p.sku)) || String(p.tiny_id);
      const sales_ = sales.get(sk) || { qty: 0, revenue: 0 };
      const label = isParents
        ? p.name.split(" - ")[0]
        : `${p.name}${p.size ? ` · ${p.size}` : ""}${p.color ? ` · ${p.color}` : ""}`;

      const cur = map.get(key) as any;
      if (cur) {
        cur.stock += p.stock;
        if (!cur._countedSkus.has(sk)) {
          cur.soldQty += sales_.qty;
          cur._countedSkus.add(sk);
        }
        cur.cost += p.stock * p.cost_price;
        cur.sale += p.stock * p.price;
      } else {
        map.set(key, {
          key, label,
          sku: p.sku || "",
          brand: p.brand,
          category: p.category || "",
          size: p.size || "",
          color: p.color || "",
          stock: p.stock,
          soldQty: sales_.qty,
          avgDaily: 0,
          coverageDays: null,
          cost: p.stock * p.cost_price,
          sale: p.stock * p.price,
          _countedSkus: new Set([sk]),
        } as any);
      }
    }
    const rows = Array.from(map.values());
    for (const r of rows) {
      r.avgDaily = r.soldQty / Math.max(1, periodDays);
      r.coverageDays = r.avgDaily > 0 ? r.stock / r.avgDaily : null;
    }
    // Ordena por menor cobertura (com vendas) primeiro, depois sem venda
    rows.sort((a, b) => {
      const ax = a.coverageDays ?? Number.POSITIVE_INFINITY;
      const bx = b.coverageDays ?? Number.POSITIVE_INFINITY;
      return ax - bx;
    });
    return rows;
  }, [filtered, sales, periodDays, coverageScope, storeFilter]);

  const coverageBuckets = useMemo(() => {
    const b = { critical: 0, low: 0, healthy: 0, excess: 0, noSales: 0 };
    for (const r of coverageRows) {
      if (r.stock <= 0) continue;
      if (r.coverageDays === null) b.noSales += 1;
      else if (r.coverageDays < 15) b.critical += 1;
      else if (r.coverageDays < 30) b.low += 1;
      else if (r.coverageDays <= 90) b.healthy += 1;
      else b.excess += 1;
    }
    return b;
  }, [coverageRows]);

  const filteredCoverageRows = useMemo(() => {
    if (coverageBucket === "all") return coverageRows;
    return coverageRows.filter((r) => {
      if (r.stock <= 0) return false;
      const cov = r.coverageDays;
      switch (coverageBucket) {
        case "noSales": return cov === null;
        case "critical": return cov !== null && cov < 15;
        case "low": return cov !== null && cov >= 15 && cov < 30;
        case "healthy": return cov !== null && cov >= 30 && cov <= 90;
        case "excess": return cov !== null && cov > 90;
        default: return true;
      }
    });
  }, [coverageRows, coverageBucket]);

  // Resumos por dimensão
  const byDim = (dim: keyof EnrichedProduct) => {
    const map = new Map<string, { qty: number; cost: number; sale: number; skus: number }>();
    for (const p of filtered) {
      const k = String((p as any)[dim] || "—");
      const cur = map.get(k) || { qty: 0, cost: 0, sale: 0, skus: 0 };
      cur.qty += p.stock;
      cur.cost += p.stock * p.cost_price;
      cur.sale += p.stock * p.price;
      cur.skus += 1;
      map.set(k, cur);
    }
    return Array.from(map.entries())
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => b.cost - a.cost);
  };

  const byBrand = useMemo(() => byDim("brand"), [filtered]);
  const bySize = useMemo(() => byDim("size"), [filtered]);
  const byColor = useMemo(() => byDim("color"), [filtered]);
  const byCategory = useMemo(() => byDim("category"), [filtered]);

  function clearFilters() {
    setSearch(""); setStoreFilter("all"); setBrandFilter("all"); setSizeFilter("all");
    setColorFilter("all"); setCategoryFilter("all"); setStockFilter("with");
  }

  function exportCSV() {
    const header = ["SKU", "Nome", "Marca", "Categoria", "Tamanho", "Cor", "Loja", "Estoque", "Custo Unit", "Venda Unit", "Custo Total", "Venda Total"];
    const storeMap = new Map(stores.map((s) => [s.id, s.name]));
    const rows = filtered.map((p) => [
      p.sku || "", p.name, p.brand, p.category || "", p.size || "", p.color || "",
      storeMap.get(p.store_id) || "", String(p.stock),
      fixed(p.cost_price), fixed(p.price),
      fixed(toNumber(p.stock) * toNumber(p.cost_price)), fixed(toNumber(p.stock) * toNumber(p.price)),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `analise-estoque-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeFiltersCount = [
    storeFilter, brandFilter, sizeFilter, colorFilter, categoryFilter,
  ].filter((v) => v !== "all").length + (search ? 1 : 0) + (stockFilter !== "with" ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Filter className="h-5 w-5" /> Análise de Estoque
          </h2>
          <p className="text-sm text-muted-foreground">
            Filtros cruzados, curva ABC, produtos parados e cortes por marca, tamanho, cor e categoria.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => loadProducts()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} /> Recarregar
          </Button>
          <Button size="sm" variant="outline" onClick={exportCSV} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-1" /> Exportar CSV
          </Button>
        </div>
      </div>

      {/* Loading bar */}
      {loading && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando produtos: {fmtNum(progress.done)} / {fmtNum(progress.total)}
            </div>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          </CardContent>
        </Card>
      )}

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nome, SKU, código de barras..."
                className="pl-8"
              />
            </div>
            <FilterSelect label="Loja" value={storeFilter} onChange={setStoreFilter}
              options={stores.map((s) => ({ value: s.id, label: s.name }))} />
            <FilterSelect label="Marca" value={brandFilter} onChange={setBrandFilter}
              options={brands.map((b) => ({ value: b, label: b }))} />
            <FilterSelect label="Categoria" value={categoryFilter} onChange={setCategoryFilter}
              options={categories.map((c) => ({ value: c, label: c }))} />
            <FilterSelect label="Tamanho" value={sizeFilter} onChange={setSizeFilter}
              options={sizes.map((s) => ({ value: s, label: s }))} />
            <FilterSelect label="Cor" value={colorFilter} onChange={setColorFilter}
              options={colors.map((c) => ({ value: c, label: c }))} />
            <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as any)}>
              <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="with">Com estoque</SelectItem>
                <SelectItem value="without">Sem estoque</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as any)}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="variants">Produtos filhos</SelectItem>
                <SelectItem value="parents">Produtos pai</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="15">Últimos 15 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="60">Últimos 60 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
                <SelectItem value="180">Últimos 180 dias</SelectItem>
                <SelectItem value="365">Últimos 365 dias</SelectItem>
              </SelectContent>
            </Select>
            {activeFiltersCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-3 w-3 mr-1" /> Limpar ({activeFiltersCount})
              </Button>
            )}
          </div>
          {loadingSales && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando vendas do período...
            </p>
          )}
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={<Package className="h-4 w-4" />} label="SKUs filtrados" value={fmtNum(kpis.skus)} />
        <KpiCard icon={<Boxes className="h-4 w-4" />} label="Qtd em estoque" value={fmtNum(kpis.qty)} />
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Custo de estoque"
          value={fmtMoney(kpis.cost)}
          hint={kpis.skusWithoutCost > 0
            ? `${fmtNum(kpis.skusWithoutCost)} SKUs sem custo · estimado total ${fmtMoney(kpis.costEstimated)}`
            : undefined}
        />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Valor de revenda" value={fmtMoney(kpis.sale)} />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Markup observado"
          value={kpis.observedMarkup > 0 ? `${fixed(kpis.observedMarkup)}x` : "—"}
          hint={kpis.observedMarkup > 0
            ? `Margem: ${fmtMoney(kpis.margin)}`
            : "Cadastre custos para calcular"}
        />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label="Pares parados" value={fmtNum(kpis.stagnant)} />
      </div>

      {kpis.skusWithoutCost > 0 && (
        <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            <div>
              <strong>{fmtNum(kpis.skusWithoutCost)} SKUs com estoque estão sem preço de custo</strong> ({fmtNum(kpis.qtyWithoutCost)} pares).
              O custo de estoque mostrado ({fmtMoney(kpis.cost)}) ignora esses itens.
              Vá na aba <strong>"Sem custo"</strong> para cadastrar — ao salvar no produto pai, todos os filhos recebem o mesmo valor.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Abas de análise */}
      <Tabs defaultValue="abc">
        <TabsList className="flex w-full overflow-x-auto justify-start">
          <TabsTrigger value="abc">Curva ABC</TabsTrigger>
          <TabsTrigger value="coverage">Cobertura (dias)</TabsTrigger>
          <TabsTrigger value="nocost">
            Sem custo {kpis.skusWithoutCost > 0 && <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">{kpis.skusWithoutCost}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="brand">Por marca</TabsTrigger>
          <TabsTrigger value="category">Por categoria</TabsTrigger>
          <TabsTrigger value="size">Por tamanho</TabsTrigger>
          <TabsTrigger value="color">Por cor</TabsTrigger>
          <TabsTrigger value="stagnant">Parados</TabsTrigger>
          <TabsTrigger value="list">Lista</TabsTrigger>
        </TabsList>

        <TabsContent value="abc">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4" /> Curva ABC ({periodDays} dias) — {scopeFilter === "parents" ? "Produto Pai" : "Produto Filho"}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Cl.</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Vendas (un)</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead className="text-right">% Receita</TableHead>
                    <TableHead className="text-right">% Acum.</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Custo Estoque</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {abcRows.slice(0, 500).map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>
                        <Badge variant={r.classe === "A" ? "default" : r.classe === "B" ? "secondary" : "outline"}>
                          {r.classe}
                        </Badge>
                      </TableCell>
                      <TableCell className="min-w-[180px] whitespace-normal break-words">{r.label}</TableCell>
                      <TableCell className="text-right">{fmtNum(r.qty)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.revenue)}</TableCell>
                      <TableCell className="text-right">{fixed(r.pct, 1)}%</TableCell>
                      <TableCell className="text-right">{fixed(r.cumPct, 1)}%</TableCell>
                      <TableCell className="text-right">{fmtNum(r.stock)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {abcRows.length > 500 && (
                <p className="text-xs text-muted-foreground mt-2">Exibindo top 500 de {fmtNum(abcRows.length)} itens.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="coverage">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4" /> Cobertura de estoque ({periodDays} dias) — {coverageScope === "parents" ? "Produto Pai" : "Produto Filho"}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cobertura = estoque atual ÷ média diária de vendas no período. Ex.: 12 unidades vendendo 1/dia = 12 dias.
                  </p>
                </div>
                <Tabs value={coverageScope} onValueChange={(v) => setCoverageScope(v as any)}>
                  <TabsList>
                    <TabsTrigger value="variants">Filho</TabsTrigger>
                    <TabsTrigger value="parents">Pai</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label="Crítico (<15d)" value={fmtNum(coverageBuckets.critical)}
                  active={coverageBucket === "critical"}
                  onClick={() => setCoverageBucket(coverageBucket === "critical" ? "all" : "critical")} />
                <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label="Baixo (15-30d)" value={fmtNum(coverageBuckets.low)}
                  active={coverageBucket === "low"}
                  onClick={() => setCoverageBucket(coverageBucket === "low" ? "all" : "low")} />
                <KpiCard icon={<Boxes className="h-4 w-4" />} label="Saudável (30-90d)" value={fmtNum(coverageBuckets.healthy)}
                  active={coverageBucket === "healthy"}
                  onClick={() => setCoverageBucket(coverageBucket === "healthy" ? "all" : "healthy")} />
                <KpiCard icon={<Layers className="h-4 w-4" />} label="Excesso (>90d)" value={fmtNum(coverageBuckets.excess)}
                  active={coverageBucket === "excess"}
                  onClick={() => setCoverageBucket(coverageBucket === "excess" ? "all" : "excess")} />
                <KpiCard icon={<X className="h-4 w-4" />} label="Sem venda" value={fmtNum(coverageBuckets.noSales)}
                  active={coverageBucket === "noSales"}
                  onClick={() => setCoverageBucket(coverageBucket === "noSales" ? "all" : "noSales")} />
              </div>
              {coverageBucket !== "all" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Filtrando por: <strong className="text-foreground">{({
                    critical: "Crítico (<15d)", low: "Baixo (15-30d)", healthy: "Saudável (30-90d)",
                    excess: "Excesso (>90d)", noSales: "Sem venda",
                  } as any)[coverageBucket]}</strong></span>
                  <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setCoverageBucket("all")}>
                    <X className="h-3 w-3 mr-1" /> Limpar
                  </Button>
                </div>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      {coverageScope === "variants" && <TableHead>SKU</TableHead>}
                      <TableHead>Marca</TableHead>
                      {coverageScope === "variants" && <TableHead>Tam</TableHead>}
                      {coverageScope === "variants" && <TableHead>Cor</TableHead>}
                      <TableHead className="text-right">Estoque</TableHead>
                      <TableHead className="text-right">Vendas ({periodDays}d)</TableHead>
                      <TableHead className="text-right">Média/dia</TableHead>
                      <TableHead className="text-right">Cobertura</TableHead>
                      <TableHead className="text-right">Custo Estoque</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCoverageRows.slice(0, 500).map((r) => {
                      const cov = r.coverageDays;
                      const badge =
                        cov === null ? { label: "Sem venda", variant: "outline" as const } :
                        cov < 15 ? { label: `${fixed(cov, 1)}d`, variant: "destructive" as const } :
                        cov < 30 ? { label: `${fixed(cov, 1)}d`, variant: "secondary" as const } :
                        cov <= 90 ? { label: `${fixed(cov, 0)}d`, variant: "default" as const } :
                        { label: `${fixed(cov, 0)}d`, variant: "outline" as const };
                      return (
                        <TableRow key={r.key}>
                          <TableCell className="min-w-[180px] whitespace-normal break-words">{r.label}</TableCell>
                          {coverageScope === "variants" && <TableCell className="font-mono text-xs">{r.sku}</TableCell>}
                          <TableCell>{r.brand}</TableCell>
                          {coverageScope === "variants" && <TableCell>{r.size || "—"}</TableCell>}
                          {coverageScope === "variants" && <TableCell>{r.color || "—"}</TableCell>}
                          <TableCell className="text-right">{fmtNum(r.stock)}</TableCell>
                          <TableCell className="text-right">{fmtNum(r.soldQty)}</TableCell>
                          <TableCell className="text-right">{fixed(r.avgDaily)}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{fmtMoney(r.cost)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {filteredCoverageRows.length > 500 && (
                  <p className="text-xs text-muted-foreground mt-2">Exibindo top 500 (menor cobertura) de {fmtNum(filteredCoverageRows.length)}.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nocost">
          <NoCostEditor
            products={products}
            filtered={filtered}
            scope={scopeFilter}
            stores={stores}
            onUpdated={(updates) => {
              setProducts((prev) => prev.map((p) => {
                const v = updates.get(p.id);
                return v !== undefined ? { ...p, cost_price: v } : p;
              }));
            }}
          />
        </TabsContent>

        <TabsContent value="brand"><DimTable rows={byBrand} label="Marca" /></TabsContent>
        <TabsContent value="category"><DimTable rows={byCategory} label="Categoria" /></TabsContent>
        <TabsContent value="size"><DimTable rows={bySize} label="Tamanho" /></TabsContent>
        <TabsContent value="color"><DimTable rows={byColor} label="Cor" /></TabsContent>

        <TabsContent value="stagnant">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Produtos parados (sem venda em {periodDays} dias)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Marca</TableHead>
                    <TableHead>Tam</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Venda</TableHead>
                    <TableHead>Última atualização</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stagnantRows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="min-w-[180px] whitespace-normal break-words">{p.name}</TableCell>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell>{p.brand}</TableCell>
                      <TableCell>{p.size || "—"}</TableCell>
                      <TableCell>{p.color || "—"}</TableCell>
                      <TableCell className="text-right">{fmtNum(p.stock)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.stock * p.cost_price)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.stock * p.price)}</TableCell>
                      <TableCell className="text-xs">{new Date(p.updated_at).toLocaleDateString("pt-BR")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {stagnantRows.length === 0 && (
                <p className="text-sm text-muted-foreground py-4">Nenhum produto parado no recorte atual.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="list">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Lista detalhada — {fmtNum(aggregatedRows.length)} {scopeFilter === "parents" ? "produtos pai" : "variações"}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Marca</TableHead>
                    <TableHead>Cat.</TableHead>
                    <TableHead>Tam</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Venda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregatedRows.slice(0, 500).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="min-w-[180px] whitespace-normal break-words">{p.name}</TableCell>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell>{p.brand}</TableCell>
                      <TableCell>{p.category || "—"}</TableCell>
                      <TableCell>{p.size || "—"}</TableCell>
                      <TableCell>{p.color || "—"}</TableCell>
                      <TableCell className="text-right">{fmtNum(p.stock)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.stock * p.cost_price)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.stock * p.price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {aggregatedRows.length > 500 && (
                <p className="text-xs text-muted-foreground mt-2">Exibindo top 500. Use filtros pra reduzir o recorte ou exporte CSV.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[160px] h-9">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        <SelectItem value="all">Todas as {label.toLowerCase()}s</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function KpiCard({ icon, label, value, hint, onClick, active }: { icon: React.ReactNode; label: string; value: string; hint?: string; onClick?: () => void; active?: boolean }) {
  const clickable = !!onClick;
  return (
    <Card
      onClick={onClick}
      className={cn(
        clickable && "cursor-pointer hover:bg-accent/40 transition-colors",
        active && "ring-2 ring-primary border-primary",
      )}
    >
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
          <span>{label}</span>{icon}
        </div>
        <div className="text-lg font-bold">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-1 leading-tight">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function DimTable({ rows, label }: { rows: any[]; label: string }) {
  const total = rows.reduce((a, b) => a + b.cost, 0) || 1;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Estoque por {label}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{label}</TableHead>
              <TableHead className="text-right">SKUs</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead className="text-right">Venda</TableHead>
              <TableHead className="text-right">% Custo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-medium">{r.key}</TableCell>
                <TableCell className="text-right">{r.skus.toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right">{r.qty.toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right">{r.cost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                <TableCell className="text-right">{r.sale.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                <TableCell className="text-right">{total ? fixed((toNumber(r.cost) / toNumber(total)) * 100, 1) : "0.0"}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------- NoCostEditor ----------
type NoCostRow = {
  key: string; // parent_key (escopo pai) ou id (escopo filho)
  label: string;
  sku: string;
  brand: string;
  category: string;
  size: string;
  color: string;
  price: number;
  stock: number;
  totalSale: number;
  ids: string[]; // ids dos pos_products afetados ao salvar
  variantsCount: number;
};

function NoCostEditor({
  products, filtered, scope, stores, onUpdated,
}: {
  products: EnrichedProduct[];
  filtered: EnrichedProduct[];
  scope: "variants" | "parents";
  stores: { id: string; name: string }[];
  onUpdated: (updates: Map<string, number>) => void;
}) {
  const [editing, setEditing] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [scopeLocal, setScopeLocal] = useState<"parents" | "variants">("parents");

  const rows = useMemo<NoCostRow[]>(() => {
    // Considera todos os produtos do recorte filtrado que NÃO têm custo e têm estoque > 0
    const noCost = filtered.filter((p) => (!p.cost_price || p.cost_price <= 0) && p.stock > 0);
    if (scopeLocal === "variants") {
      return noCost.map((p) => ({
        key: p.id,
        label: p.name,
        sku: p.sku || "",
        brand: p.brand,
        category: p.category || "",
        size: p.size || "",
        color: p.color || "",
        price: p.price,
        stock: p.stock,
        totalSale: p.stock * p.price,
        ids: [p.id],
        variantsCount: 1,
      })).sort((a, b) => b.totalSale - a.totalSale);
    }
    // Modo "parents": agrupa por parent_key — inclui TODOS os filhos do pai
    // (não só os sem custo) pra que a edição realmente cascate.
    const parentMap = new Map<string, EnrichedProduct[]>();
    const targetKeys = new Set(noCost.map((p) => p.parent_key));
    for (const p of products) {
      if (!targetKeys.has(p.parent_key)) continue;
      const arr = parentMap.get(p.parent_key) || [];
      arr.push(p);
      parentMap.set(p.parent_key, arr);
    }
    const out: NoCostRow[] = [];
    for (const [k, list] of parentMap.entries()) {
      const sample = list[0];
      const totalStock = list.reduce((a, b) => a + b.stock, 0);
      const avgPrice = list.reduce((a, b) => a + b.price, 0) / list.length;
      const sizes = Array.from(new Set(list.map((x) => x.size).filter(Boolean) as string[]));
      const colors = Array.from(new Set(list.map((x) => x.color).filter(Boolean) as string[]));
      out.push({
        key: k,
        label: sample.name.split(" - ")[0],
        sku: sample.sku?.split("-")[0] || sample.sku || "",
        brand: sample.brand,
        category: sample.category || "",
        size: sizes.length > 1 ? `${sizes.length} tam.` : sizes[0] || "",
        color: colors.length > 1 ? `${colors.length} cores` : colors[0] || "",
        price: avgPrice,
        stock: totalStock,
        totalSale: totalStock * avgPrice,
        ids: list.map((x) => x.id),
        variantsCount: list.length,
      });
    }
    return out.sort((a, b) => b.totalSale - a.totalSale);
  }, [filtered, products, scopeLocal]);

  async function handleSave(row: NoCostRow) {
    const raw = editing.get(row.key) || "";
    const value = parseFloat(raw.replace(",", "."));
    if (!isFinite(value) || value <= 0) {
      toast.error("Informe um valor de custo maior que zero.");
      return;
    }
    setSaving((s) => new Set(s).add(row.key));
    const { error } = await supabase
      .from("pos_products")
      .update({ cost_price: value })
      .in("id", row.ids);
    setSaving((s) => { const n = new Set(s); n.delete(row.key); return n; });
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success(`Custo salvo em ${row.ids.length} variante(s).`);
    const updates = new Map<string, number>();
    row.ids.forEach((id) => updates.set(id, value));
    onUpdated(updates);
    setEditing((m) => { const n = new Map(m); n.delete(row.key); return n; });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Produtos sem preço de custo — {fmtNum(rows.length)} {scopeLocal === "parents" ? "produtos pai" : "variações"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          No modo <strong>Produto Pai</strong>, ao salvar o custo, todos os filhos (variações de tamanho/cor) recebem o mesmo valor.
          O custo de estoque no dashboard é recalculado automaticamente.
        </p>
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant={scopeLocal === "parents" ? "default" : "outline"} onClick={() => setScopeLocal("parents")}>
            Produto Pai
          </Button>
          <Button size="sm" variant={scopeLocal === "variants" ? "default" : "outline"} onClick={() => setScopeLocal("variants")}>
            Variações (filhos)
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[180px]">Produto</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Marca</TableHead>
              {scopeLocal === "variants" && <TableHead>Tam</TableHead>}
              {scopeLocal === "variants" && <TableHead>Cor</TableHead>}
              {scopeLocal === "parents" && <TableHead>Variações</TableHead>}
              <TableHead className="text-right">Estoque</TableHead>
              <TableHead className="text-right">Preço venda</TableHead>
              <TableHead className="text-right min-w-[180px]">Custo (novo)</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 500).map((r) => {
              const isSaving = saving.has(r.key);
              const val = editing.get(r.key) ?? "";
              return (
                <TableRow key={r.key}>
                  <TableCell className="min-w-[180px] whitespace-normal break-words font-medium">{r.label}</TableCell>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell>{r.brand}</TableCell>
                  {scopeLocal === "variants" && <TableCell>{r.size || "—"}</TableCell>}
                  {scopeLocal === "variants" && <TableCell>{r.color || "—"}</TableCell>}
                  {scopeLocal === "parents" && (
                    <TableCell className="text-xs text-muted-foreground">
                      {r.variantsCount} {r.size && `· ${r.size}`} {r.color && `· ${r.color}`}
                    </TableCell>
                  )}
                  <TableCell className="text-right">{fmtNum(r.stock)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.price)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      placeholder="0,00"
                      value={val}
                      onChange={(e) => setEditing((m) => new Map(m).set(r.key, e.target.value))}
                      className="h-8 w-28 ml-auto text-right"
                      disabled={isSaving}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      onClick={() => handleSave(r)}
                      disabled={isSaving || !val}
                    >
                      {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">
            Nenhum produto sem custo no recorte atual. 🎉
          </p>
        )}
        {rows.length > 500 && (
          <p className="text-xs text-muted-foreground mt-2">
            Exibindo top 500 (maior valor de venda em estoque) de {fmtNum(rows.length)}. Use filtros para refinar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
