import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, Package, ShoppingBag, Store as StoreIcon, Loader2, Pencil, ChevronDown, RefreshCw, Boxes, Sparkles, Tag, Unlink } from "lucide-react";
import { ProductMasterForm } from "./ProductMasterForm";
import { ProductEditDialog } from "./ProductEditDialog";

import { ProductLabelPrintDialog } from "./ProductLabelPrintDialog";
import { UnifiedProductsList } from "./UnifiedProductsList";
import { LegacyProductsList } from "./LegacyProductsList";
import { toast } from "sonner";

interface Master {
  id: string;
  sku_root: string;
  name: string;
  brand: string | null;
  category: string | null;
  cost_price: number | string | null;
  sale_price: number | string | null;
  is_active: boolean;
  shopify_product_id: string | null;
  tiny_product_id: string | null;
  created_at: string;
}

const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const fixed = (value: unknown, digits = 2) => toNumber(value).toFixed(digits);

interface VariantSummary {
  master_id: string;
  variant_count: number;
  total_stock: number;
}

export function ProductsList() {
  const navigate = useNavigate();
  const [view, setView] = useState<"unified" | "legacy">(() => {
    if (typeof window === "undefined") return "unified";
    return (localStorage.getItem("products_view") as any) || "unified";
  });
  const [items, setItems] = useState<Master[]>([]);
  const [variantSummary, setVariantSummary] = useState<Record<string, VariantSummary>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [labelPrintId, setLabelPrintId] = useState<string | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  function setViewPersist(v: "unified" | "legacy") {
    setView(v);
    try { localStorage.setItem("products_view", v); } catch {}
  }

  async function backfillCosts() {
    setBackfilling(true);
    try {
      const { data, error } = await supabase.rpc("backfill_master_costs_from_pos");
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      toast.success(
        `Custos importados do estoque local: ${row?.masters_updated ?? 0} produtos e ${row?.variants_updated ?? 0} variações`,
        { duration: 8000 }
      );
      load();
    } catch (err: any) {
      toast.error("Erro ao importar custos: " + err.message);
    } finally {
      setBackfilling(false);
    }
  }

  async function load() {
    setLoading(true);
    const term = search.trim();
    let query = supabase.from("products_master").select("*");

    if (term) {
      // 1) Look up matching variants by SKU/GTIN to find their master_ids
      const { data: variantHits } = await supabase
        .from("product_variants")
        .select("master_id")
        .or(`sku.ilike.%${term}%,gtin.ilike.%${term}%`)
        .limit(200);
      const masterIds = Array.from(new Set((variantHits || []).map((v: any) => v.master_id).filter(Boolean)));

      // 2) Match on master fields (name, sku_root, brand) OR ids found via variants
      const orParts = [
        `name.ilike.%${term}%`,
        `sku_root.ilike.%${term}%`,
        `brand.ilike.%${term}%`,
      ];
      if (masterIds.length > 0) {
        orParts.push(`id.in.(${masterIds.join(",")})`);
      }
      query = query.or(orParts.join(","));
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error("Erro ao carregar produtos: " + error.message);
    } else {
      setItems((data || []) as any);
      // Sumário de variações
      if (data && data.length > 0) {
        const ids = data.map((d: any) => d.id);
        const { data: vars } = await supabase
          .from("product_variants")
          .select("master_id, initial_stock")
          .in("master_id", ids);
        const summary: Record<string, VariantSummary> = {};
        (vars || []).forEach((v: any) => {
          const cur = summary[v.master_id] || { master_id: v.master_id, variant_count: 0, total_stock: 0 };
          cur.variant_count += 1;
          cur.total_stock += v.initial_stock || 0;
          summary[v.master_id] = cur;
        });
        setVariantSummary(summary);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(() => { load(); }, search ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function sendToPos(masterId: string) {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("create-master-product-pos", {
        body: { master_id: masterId },
      });
      if (error) throw error;
      toast.success("Enviado ao PDV: " + (data?.message || "OK"));
      load();
    } catch (err: any) {
      toast.error("Erro ao enviar ao PDV: " + err.message);
    } finally {
      setSendingTo(null);
    }
  }

  async function sendToShopify(masterId: string) {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("create-master-product-shopify", {
        body: { master_id: masterId },
      });
      if (error) throw error;
      toast.success("Criado na Shopify! ID: " + (data?.shopify_product_id || "?"));
      load();
    } catch (err: any) {
      toast.error("Erro ao criar na Shopify: " + err.message);
    } finally {
      setSendingTo(null);
    }
  }

  // Desvincula o produto da Shopify (limpa os IDs locais) para permitir reenviar
  // como produto novo — usado quando o anúncio foi APAGADO na Shopify mas o sistema
  // ainda acha que existe vínculo.
  async function unlinkShopify(masterId: string) {
    if (!confirm("Desvincular este produto da Shopify? Isso limpa o vínculo local (IDs Shopify do produto e variações) para você poder criar um novo produto na Shopify. Não apaga nada na Shopify.")) return;
    setSendingTo(masterId);
    try {
      const { error: e1 } = await supabase
        .from("products_master")
        .update({ shopify_product_id: null } as any)
        .eq("id", masterId);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("product_variants")
        .update({ shopify_variant_id: null } as any)
        .eq("master_id", masterId);
      if (e2) throw e2;
      toast.success("Produto desvinculado da Shopify. Agora você pode criar um novo produto.");
      load();
    } catch (err: any) {
      toast.error("Erro ao desvincular: " + err.message);
    } finally {
      setSendingTo(null);
    }
  }

  async function updateShopify(masterId: string) {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("update-master-product-shopify", {
        body: { master_id: masterId },
      });
      if (error) throw error;
      toast.success(data?.message || "Produto atualizado na Shopify");
    } catch (err: any) {
      toast.error("Erro ao atualizar Shopify: " + err.message);
    } finally {
      setSendingTo(null);
    }
  }

  async function syncStock(masterId: string, target: "pos" | "shopify" | "both") {
    setSendingTo(masterId);
    try {
      const { data, error } = await supabase.functions.invoke("sync-master-product-stock", {
        body: { master_id: masterId, target },
      });
      if (error) throw error;
      const r = data?.result || {};
      const parts: string[] = [];
      if (r.pos) parts.push(`PDV: ${r.pos.updated} atualizados em ${r.pos.stores} loja(s)`);
      if (r.shopify) parts.push(`Shopify: ${r.shopify.updated || 0} variantes`);
      toast.success("Estoque sincronizado — " + parts.join(" · "));
    } catch (err: any) {
      toast.error("Erro ao sincronizar estoque: " + err.message);
    } finally {
      setSendingTo(null);
    }
  }

  const filtered = items;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 p-1 rounded-lg border bg-muted/40 w-fit">
        <Button size="sm" variant={view === "unified" ? "default" : "ghost"} onClick={() => setViewPersist("unified")} className="gap-1">
          <Sparkles className="h-3.5 w-3.5" /> Catálogo Unificado
        </Button>
        <Button size="sm" variant={view === "legacy" ? "default" : "ghost"} onClick={() => setViewPersist("legacy")}>
          Legacy
        </Button>
      </div>

      {view === "unified" ? <UnifiedProductsList /> : <LegacyProductsList />}
    </div>
  );
}
