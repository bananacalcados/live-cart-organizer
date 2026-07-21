import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Save, Trash2, Plus, Upload, X, Package, Sparkles, Store as StoreIcon } from "lucide-react";
import { toast } from "sonner";
import { generateEan13, isValidEan13 } from "@/lib/ean13";
import { sanitizeSizeInput, sanitizeColorInput, isValidSize, isValidColor } from "@/lib/variantValidation";
import { ColorSizeCombobox } from "@/components/inventory/ColorSizeCombobox";

interface VariantRow {
  id?: string;                 // existente
  _isNew?: boolean;            // marcador
  color: string;
  size: string;
  cost_price_override: string;
  sale_price_override: string;
  weight_kg_override: string;
  current_stock: number;       // novo valor (editável)
  original_stock: number;      // valor antes da edição (para diff)
  gtin?: string;
  sku?: string;
  is_active: boolean;
}

interface Props {
  masterId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}

export function ProductEditDialog({ masterId, open, onOpenChange, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Pai
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [newBrandMode, setNewBrandMode] = useState(false);
  const [category, setCategory] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [newCategoryMode, setNewCategoryMode] = useState(false);
  const [ncm, setNcm] = useState("");
  const [cest, setCest] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [width, setWidth] = useState("");
  const [length, setLength] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [skuRoot, setSkuRoot] = useState("");

  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [removedVariantIds, setRemovedVariantIds] = useState<string[]>([]);

  // Lote: gerador de matriz cor × tamanho + loja que recebe o estoque das variações novas
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [stockStoreId, setStockStoreId] = useState<string>("");
  const [matrixColors, setMatrixColors] = useState("");
  const [matrixSizes, setMatrixSizes] = useState("");
  const [batchStock, setBatchStock] = useState("0");
  const [batchCost, setBatchCost] = useState("");

  useEffect(() => {
    if (!open || !masterId) return;
    loadData();
  }, [open, masterId]);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("product_categories")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setCategories((data || []) as any));
    supabase
      .from("pos_stores")
      .select("id, name")
      .eq("is_active", true)
      .eq("is_simulation", false)
      .order("name")
      .then(({ data }) => setStores((data || []) as any));
    supabase
      .from("product_brands" as any)
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setBrands(((data || []) as any) as { id: string; name: string }[]));
  }, [open]);

  async function loadData() {
    if (!masterId) return;
    setLoading(true);
    try {
      const { data: master, error: e1 } = await supabase
        .from("products_master")
        .select("*")
        .eq("id", masterId)
        .single();
      if (e1) throw e1;

      setName(master.name || "");
      setDescription(master.description || "");
      setBrand(master.brand || "");
      {
        const bName = (master.brand || "").toString();
        const bMatch = brands.find((b) => b.name.toLowerCase() === bName.toLowerCase());
        setNewBrandMode(!!bName && !bMatch);
      }
      setCategory(master.category || "");
      {
        const catName = (master.category || "").toString();
        const match = categories.find((c) => c.name.toLowerCase() === catName.toLowerCase())
          || (master.category_id ? categories.find((c) => c.id === master.category_id) : undefined);
        if (master.category_id) setCategoryId(master.category_id);
        else if (match) setCategoryId(match.id);
        else setCategoryId("");
        setNewCategoryMode(!!catName && !match && !master.category_id);
      }
      setNcm(master.ncm || "");
      setCest(master.cest || "");
      setCostPrice(master.cost_price?.toString() || "");
      setSalePrice(master.sale_price?.toString() || "");
      setWeight(master.weight_kg?.toString() || "");
      setHeight(master.height_cm?.toString() || "");
      setWidth(master.width_cm?.toString() || "");
      setLength(master.length_cm?.toString() || "");
      setImages(master.images || []);
      setIsActive(master.is_active !== false);
      setSkuRoot(master.sku_root || "");

      const { data: vars, error: e2 } = await supabase
        .from("product_variants")
        .select("*")
        .eq("master_id", masterId)
        .order("size", { ascending: true });
      if (e2) throw e2;

      setVariants(
        (vars || []).map((v: any) => ({
          id: v.id,
          color: v.color || "",
          size: v.size || "",
          cost_price_override: v.cost_price_override?.toString() || "",
          sale_price_override: v.sale_price_override?.toString() || "",
          weight_kg_override: v.weight_kg_override?.toString() || "",
          current_stock: v.initial_stock ?? 0,
          original_stock: v.initial_stock ?? 0,
          gtin: v.gtin,
          sku: v.sku,
          is_active: v.is_active !== false,
        }))
      );
      setRemovedVariantIds([]);
    } catch (err: any) {
      toast.error("Erro ao carregar produto: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function updateVariant(idx: number, patch: Partial<VariantRow>) {
    setVariants((arr) => arr.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }

  function addVariant() {
    setVariants((arr) => [
      ...arr,
      {
        _isNew: true,
        color: "",
        size: "",
        cost_price_override: "",
        sale_price_override: "",
        weight_kg_override: "",
        current_stock: 0,
        original_stock: 0,
        is_active: true,
      },
    ]);
  }

  function generateMatrix() {
    const colors = matrixColors.split(",").map((c) => c.trim()).filter(Boolean);
    const sizes = matrixSizes.split(",").map((s) => s.trim()).filter(Boolean);
    if (!colors.length || !sizes.length) {
      toast.error("Informe pelo menos uma cor e um tamanho.");
      return;
    }
    const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    const stock = parseInt(batchStock, 10) || 0;
    const newRows: VariantRow[] = [];
    let skipped = 0;
    setVariants((arr) => {
      const existing = new Set(arr.map((v) => `${norm(v.color)}|${norm(v.size)}`));
      for (const c of colors) {
        for (const s of sizes) {
          const key = `${norm(c)}|${norm(s)}`;
          if (existing.has(key)) { skipped++; continue; }
          existing.add(key);
          newRows.push({
            _isNew: true,
            color: c,
            size: s,
            cost_price_override: batchCost.trim() || "",
            sale_price_override: "",
            weight_kg_override: "",
            current_stock: stock,
            original_stock: 0,
            is_active: true,
          });
        }
      }
      return [...arr, ...newRows];
    });
    setTimeout(() => {
      if (newRows.length === 0) {
        toast.info("Todas as combinações já existem neste produto.");
      } else {
        toast.success(
          `${newRows.length} variação(ões) gerada(s)${skipped ? ` · ${skipped} já existia(m), ignorada(s)` : ""}.`
        );
      }
    }, 0);
    setMatrixColors("");
    setMatrixSizes("");
  }

  function removeVariant(idx: number) {
    const v = variants[idx];
    if (v.id) setRemovedVariantIds((ids) => [...ids, v.id!]);
    setVariants((arr) => arr.filter((_, i) => i !== idx));
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("product-images")
        .upload(path, file, { contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      setImages((imgs) => [...imgs, data.publicUrl]);
    } catch (err: any) {
      toast.error("Erro ao enviar imagem: " + err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!masterId) return;
    if (!name.trim()) { toast.error("Informe o nome."); return; }

    // Valida formato de cor/tamanho em todas as variações preenchidas
    for (const v of variants) {
      if (!v.color && !v.size) continue;
      if (v.size && !isValidSize(v.size)) {
        toast.error(`Tamanho inválido: "${v.size}". Use números (39, 34/35) ou PP/P/M/G/GG.`);
        return;
      }
      if (v.color && !isValidColor(v.color)) {
        toast.error(`Cor inválida: "${v.color}". Cor não pode ser apenas números.`);
        return;
      }
    }


    const hasNewVariants = variants.some((v) => !v.id && v.color && v.size);
    if (hasNewVariants && !stockStoreId) {
      toast.error("Há variações novas: escolha a loja que recebe o estoque (no topo das Variações).");
      return;
    }

    // Validação de SKU/GTIN manuais nas variações novas
    const newRows = variants.filter((v) => !v.id && v.color && v.size);
    const manualSkus = newRows.map((v) => (v.sku || "").trim()).filter(Boolean);
    const manualGtins = newRows.map((v) => (v.gtin || "").trim()).filter(Boolean);

    // formato GTIN
    for (const g of manualGtins) {
      if (!isValidEan13(g)) {
        toast.error(`GTIN inválido: ${g}. Deve ser um EAN-13 válido (13 dígitos) ou deixe em branco para gerar automático.`);
        return;
      }
    }
    // duplicatas dentro do próprio lote
    const dupSku = manualSkus.find((s, i) => manualSkus.indexOf(s) !== i);
    if (dupSku) { toast.error(`SKU repetido nas novas variações: ${dupSku}`); return; }
    const dupGtin = manualGtins.find((g, i) => manualGtins.indexOf(g) !== i);
    if (dupGtin) { toast.error(`GTIN repetido nas novas variações: ${dupGtin}`); return; }

    // colisão com o banco (product_variants e pos_products)
    if (manualSkus.length || manualGtins.length) {
      const conflicts: { field: string; value: string }[] = [];
      if (manualSkus.length) {
        const [pv, pp] = await Promise.all([
          supabase.from("product_variants").select("sku").in("sku", manualSkus),
          supabase.from("pos_products").select("sku").in("sku", manualSkus),
        ]);
        for (const r of (pv.data || []) as any[]) conflicts.push({ field: "SKU", value: r.sku });
        for (const r of (pp.data || []) as any[]) conflicts.push({ field: "SKU", value: r.sku });
      }
      if (manualGtins.length) {
        const [pv, pp] = await Promise.all([
          supabase.from("product_variants").select("gtin").in("gtin", manualGtins),
          supabase.from("pos_products").select("barcode").in("barcode", manualGtins),
        ]);
        for (const r of (pv.data || []) as any[]) conflicts.push({ field: "GTIN", value: r.gtin });
        for (const r of (pp.data || []) as any[]) conflicts.push({ field: "GTIN", value: r.barcode });
      }
      if (conflicts.length) {
        const first = conflicts[0];
        toast.error(`${first.field} já cadastrado: ${first.value}. Use outro código ou deixe em branco para gerar automático.`);
        return;
      }
    }

    setSaving(true);
    const newVariantIds: string[] = [];
    try {
      // 1. Atualiza pai
      const { error: e1 } = await supabase
        .from("products_master")
        .update({
          name,
          description,
          brand,
          category,
          category_id: categoryId || null,
          ncm,
          cest,
          cost_price: parseFloat(costPrice) || 0,
          sale_price: parseFloat(salePrice) || 0,
          weight_kg: parseFloat(weight) || null,
          height_cm: parseFloat(height) || null,
          width_cm: parseFloat(width) || null,
          length_cm: parseFloat(length) || null,
          images,
          is_active: isActive,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", masterId);
      if (e1) throw e1;

      // 1b. Propaga categoria ao PDV (pos_products) pelas SKUs das variações
      const variantSkus = variants.map((v) => v.sku).filter(Boolean) as string[];
      if (variantSkus.length > 0) {
        await supabase
          .from("pos_products")
          .update({ category: category || null, category_id: categoryId || null })
          .in("sku", variantSkus);
      }

      // 2. Remove variações marcadas
      if (removedVariantIds.length > 0) {
        const { error: eDel } = await supabase
          .from("product_variants")
          .delete()
          .in("id", removedVariantIds);
        if (eDel) throw eDel;
      }

      // 3. Atualiza/insere variações
      for (const v of variants) {
        const stockDelta = v.current_stock - v.original_stock;

        if (v.id) {
          // existente: update + movimento se mudou
          const { error: eUp } = await supabase
            .from("product_variants")
            .update({
              color: v.color,
              size: v.size,
              cost_price_override: v.cost_price_override ? parseFloat(v.cost_price_override) : null,
              sale_price_override: v.sale_price_override ? parseFloat(v.sale_price_override) : null,
              weight_kg_override: v.weight_kg_override ? parseFloat(v.weight_kg_override) : null,
              initial_stock: v.current_stock,
              is_active: v.is_active,
            } as any)
            .eq("id", v.id);
          if (eUp) throw eUp;

          // Propaga nome corrigido + variação ao PDV (pos_products) pela SKU
          if (v.sku) {
            const variantLabel = `${v.color || ""} ${v.size || ""}`.trim().replace(/\s+/g, " ");
            const posName = `${name} - ${variantLabel}`.trim().replace(/\s+/g, " ");
            await supabase
              .from("pos_products")
              .update({
                name: posName,
                color: v.color || null,
                size: v.size || null,
                variant: variantLabel,
                last_sync_source: "pos",
              })
              .eq("sku", v.sku);
          }

          if (stockDelta !== 0) {
            await supabase.from("product_stock_movements").insert({
              variant_id: v.id,
              master_id: masterId,
              quantity: stockDelta,
              movement_type: "adjustment",
              reason: "Ajuste manual via edição",
            } as any);
          }
        } else {
          // nova: insert — usa SKU/GTIN manuais se informados; senão gera ÚNICOS via banco
          if (!v.color || !v.size) continue;
          const manualSku = (v.sku || "").trim();
          const manualGtin = (v.gtin || "").trim();
          let newSku = manualSku;
          let newGtin = manualGtin;
          if (!newSku) {
            const colorSlug = (v.color || "X").normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10) || "UN";
            const sizeSlug = (v.size || "U").replace(/[^A-Za-z0-9]/g, "") || "U";
            const baseSku = `${skuRoot}-${colorSlug}-${sizeSlug}`;
            const { data: skuData } = await supabase.rpc("gen_unique_variant_sku", { p_base: baseSku });
            newSku = (skuData as string) || baseSku;
          }
          if (!newGtin) {
            const { data: gtinData } = await supabase.rpc("gen_unique_ean13");
            newGtin = (gtinData as string) || generateEan13();
          }
          const { data: ins, error: eIns } = await supabase
            .from("product_variants")
            .insert({
              master_id: masterId,
              color: v.color,
              size: v.size,
              cost_price_override: v.cost_price_override ? parseFloat(v.cost_price_override) : null,
              sale_price_override: v.sale_price_override ? parseFloat(v.sale_price_override) : null,
              weight_kg_override: v.weight_kg_override ? parseFloat(v.weight_kg_override) : null,
              initial_stock: v.current_stock,
              gtin: newGtin,
              sku: newSku,
              is_active: v.is_active,
            } as any)
            .select("id")
            .single();
          if (eIns) throw eIns;
          if (ins) newVariantIds.push(ins.id);

          if (v.current_stock > 0 && ins) {
            await supabase.from("product_stock_movements").insert({
              variant_id: ins.id,
              master_id: masterId,
              quantity: v.current_stock,
              movement_type: "entry",
              reason: "Estoque inicial - variação criada na edição",
            } as any);
          }
        }
      }

      // 4. Empurra as variações NOVAS ao PDV (todas as lojas, estoque na loja escolhida)
      if (newVariantIds.length > 0 && stockStoreId) {
        const { data: posData, error: posErr } = await supabase.functions.invoke("pos-add-variants", {
          body: { master_id: masterId, store_id: stockStoreId, variant_ids: newVariantIds },
        });
        if (posErr || posData?.error) {
          toast.warning(
            "Variações salvas no cadastro, mas falhou ao enviar ao PDV: " +
            (posData?.error || posErr?.message || "erro desconhecido")
          );
        } else {
          const storeName = stores.find((s) => s.id === stockStoreId)?.name || "loja";
          toast.success(`${newVariantIds.length} variação(ões) nova(s) enviada(s) ao PDV (${storeName}).`);
        }
      }

      // 5. Propaga campos do PAI ao PDV automaticamente (todas as SKUs existentes deste master).
      // Sincroniza: category, category_id, price, cost_price (respeitando overrides da variação).
      try {
        const existingRows = variants.filter((v) => v.id && v.sku);
        if (existingRows.length > 0) {
          const masterCost = parseFloat(costPrice) || 0;
          const masterSale = parseFloat(salePrice) || 0;
          for (const v of existingRows) {
            const rowCost = v.cost_price_override ? parseFloat(v.cost_price_override) : masterCost;
            const rowSale = v.sale_price_override ? parseFloat(v.sale_price_override) : masterSale;
            const posPatch: Record<string, any> = {
              category: category || null,
              category_id: categoryId || null,
            };
            if (rowCost > 0) posPatch.cost_price = rowCost;
            if (rowSale > 0) posPatch.price = rowSale;
            await supabase.from("pos_products").update(posPatch).eq("sku", v.sku!);
          }
        }
      } catch (syncErr: any) {
        console.warn("Falha ao propagar campos ao PDV:", syncErr?.message);
      }


      toast.success("Produto atualizado!");
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao salvar: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!masterId) return;
    setSaving(true);
    try {
      // Remove variantes primeiro (FK)
      await supabase.from("product_variants").delete().eq("master_id", masterId);
      const { error } = await supabase.from("products_master").delete().eq("id", masterId);
      if (error) throw error;
      toast.success("Produto excluído.");
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao excluir: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Editar Produto {skuRoot && <span className="text-xs font-mono text-muted-foreground">SKU: {skuRoot}</span>}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Pai */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Dados do Produto</CardTitle>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Ativo</Label>
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <Label>Nome *</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <Label>Descrição</Label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
                </div>
                <div>
                  <Label>Marca</Label>
                  {newBrandMode ? (
                    <div className="flex gap-1">
                      <Input
                        value={brand}
                        onChange={(e) => setBrand(e.target.value)}
                        placeholder="Nova marca"
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => { setNewBrandMode(false); setBrand(""); }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <Select
                      value={brand ? (brands.find((b) => b.name.toLowerCase() === brand.toLowerCase())?.id || "__custom__") : ""}
                      onValueChange={(v) => {
                        if (v === "__new__") { setNewBrandMode(true); setBrand(""); return; }
                        const b = brands.find((x) => x.id === v);
                        if (b) setBrand(b.name);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a marca" />
                      </SelectTrigger>
                      <SelectContent>
                        {brand && !brands.some((b) => b.name.toLowerCase() === brand.toLowerCase()) && (
                          <SelectItem value="__custom__">{brand} (atual)</SelectItem>
                        )}
                        {brands.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                        <SelectItem value="__new__" className="text-primary font-medium">+ Criar nova marca</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label>Categoria</Label>
                  {newCategoryMode ? (
                    <div className="flex gap-1">
                      <Input
                        value={category}
                        onChange={(e) => { setCategory(e.target.value); setCategoryId(""); }}
                        placeholder="Nova categoria"
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => { setNewCategoryMode(false); setCategory(""); setCategoryId(""); }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <Select
                      value={categoryId || (category ? "__custom__" : "")}
                      onValueChange={(v) => {
                        if (v === "__new__") { setNewCategoryMode(true); setCategory(""); setCategoryId(""); return; }
                        const cat = categories.find((c) => c.id === v);
                        if (cat) { setCategoryId(cat.id); setCategory(cat.name); }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a categoria" />
                      </SelectTrigger>
                      <SelectContent>
                        {category && !categories.some((c) => c.name.toLowerCase() === category.toLowerCase()) && (
                          <SelectItem value="__custom__">{category} (atual)</SelectItem>
                        )}
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                        <SelectItem value="__new__" className="text-primary font-medium">+ Criar nova categoria</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label>NCM</Label>
                  <Input value={ncm} onChange={(e) => setNcm(e.target.value)} />
                </div>
                <div>
                  <Label>CEST</Label>
                  <Input value={cest} onChange={(e) => setCest(e.target.value)} />
                </div>
                <div>
                  <Label>Preço de Custo (R$)</Label>
                  <Input type="number" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
                </div>
                <div>
                  <Label>Preço de Venda (R$)</Label>
                  <Input type="number" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
                </div>
                <div>
                  <Label>Peso (kg)</Label>
                  <Input type="number" step="0.001" value={weight} onChange={(e) => setWeight(e.target.value)} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Alt (cm)</Label>
                    <Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
                  </div>
                  <div>
                    <Label>Larg</Label>
                    <Input type="number" value={width} onChange={(e) => setWidth(e.target.value)} />
                  </div>
                  <div>
                    <Label>Comp</Label>
                    <Input type="number" value={length} onChange={(e) => setLength(e.target.value)} />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <Label>Imagens</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {images.map((src, i) => (
                      <div key={i} className="relative w-20 h-20 rounded border overflow-hidden">
                        <img src={src} className="w-full h-full object-cover" />
                        <button
                          onClick={() => setImages((imgs) => imgs.filter((_, j) => j !== i))}
                          className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded-bl p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <label className="w-20 h-20 rounded border-2 border-dashed flex items-center justify-center cursor-pointer hover:bg-muted">
                      {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadImage(f);
                        }}
                      />
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Variações */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  Variações ({variants.length})
                </CardTitle>
                <Button onClick={addVariant} size="sm" variant="outline">
                  <Plus className="h-4 w-4 mr-1" /> Adicionar
                </Button>
              </CardHeader>
              <CardContent>
                {/* Gerador de variações em lote (Cor × Tamanho) */}
                <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 mb-3 space-y-2">
                  <Label className="flex items-center gap-1.5 text-sm">
                    <Sparkles className="h-4 w-4 text-primary" /> Gerar variações em lote (Cor × Tamanho)
                  </Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Cores (separadas por vírgula)</Label>
                      <Input className="h-8" value={matrixColors} onChange={(e) => setMatrixColors(e.target.value)} placeholder="Preto, Bege, Rosa" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Tamanhos (separados por vírgula)</Label>
                      <Input className="h-8" value={matrixSizes} onChange={(e) => setMatrixSizes(e.target.value)} placeholder="35, 36, 37, 38" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[11px] text-muted-foreground self-center">Grades rápidas:</span>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setMatrixSizes("33/34, 35/36, 37/38, 39/40")}>Chinelo (33/34…)</Button>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setMatrixSizes("25/26, 27/28, 29/30, 31/32, 33/34")}>Chinelo Infantil</Button>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setMatrixSizes("34, 35, 36, 37, 38, 39, 40")}>Numérico 34-40</Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Estoque inicial p/ cada</Label>
                      <Input className="h-8" type="number" min="0" value={batchStock} onChange={(e) => setBatchStock(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Custo R$ (opcional)</Label>
                      <Input className="h-8" type="number" step="0.01" value={batchCost} onChange={(e) => setBatchCost(e.target.value)} placeholder={costPrice || "—"} />
                    </div>
                    <Button type="button" size="sm" variant="secondary" className="h-8" onClick={generateMatrix}>
                      <Sparkles className="h-4 w-4 mr-1" /> Gerar variações
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Combinações que já existem neste produto são ignoradas (sem duplicar).
                  </p>
                </div>

                {/* Loja que recebe o estoque das variações novas */}
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 mb-3">
                  <Label className="flex items-center gap-1.5 text-sm mb-1">
                    <StoreIcon className="h-4 w-4 text-primary" /> Loja que recebe o estoque das variações novas
                  </Label>
                  <Select value={stockStoreId} onValueChange={setStockStoreId}>
                    <SelectTrigger className="max-w-sm h-9">
                      <SelectValue placeholder="Escolha a loja" />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Obrigatório só quando há variações novas. Elas ficam bipáveis em todas as lojas; o estoque entra nesta.
                  </p>
                </div>

                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {variants.map((v, idx) => {
                    const delta = v.current_stock - v.original_stock;
                    return (
                      <div key={v.id || `new-${idx}`} className="grid grid-cols-12 gap-2 items-end p-2 rounded bg-muted/40">
                        <div className="col-span-3">
                          <Label className="text-[10px] text-muted-foreground">Cor</Label>
                          <ColorSizeCombobox
                            kind="color"
                            value={v.color}
                            onChange={(val) => updateVariant(idx, { color: val })}
                          />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-[10px] text-muted-foreground">Tam</Label>
                          <ColorSizeCombobox
                            kind="size"
                            value={v.size}
                            onChange={(val) => updateVariant(idx, { size: val })}
                          />
                        </div>
                        <div className="col-span-1">
                          <Label className="text-[10px] text-muted-foreground">
                            Est{delta !== 0 && (
                              <span className={delta > 0 ? "text-green-600" : "text-destructive"}>
                                ({delta > 0 ? "+" : ""}{delta})
                              </span>
                            )}
                          </Label>
                          <Input
                            className="h-8"
                            type="number"
                            value={v.current_stock}
                            onChange={(e) => updateVariant(idx, { current_stock: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-[10px] text-muted-foreground">Custo R$</Label>
                          <Input
                            className="h-8"
                            type="number"
                            step="0.01"
                            value={v.cost_price_override}
                            onChange={(e) => updateVariant(idx, { cost_price_override: e.target.value })}
                            placeholder={costPrice || "—"}
                          />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-[10px] text-muted-foreground">Venda R$</Label>
                          <Input
                            className="h-8"
                            type="number"
                            step="0.01"
                            value={v.sale_price_override}
                            onChange={(e) => updateVariant(idx, { sale_price_override: e.target.value })}
                            placeholder={salePrice || "—"}
                          />
                        </div>
                        <div className="col-span-1 flex flex-col items-center">
                          <Label className="text-[10px] text-muted-foreground">Ativo</Label>
                          <Switch
                            checked={v.is_active}
                            onCheckedChange={(c) => updateVariant(idx, { is_active: c })}
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button size="icon" variant="ghost" onClick={() => removeVariant(idx)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        {v.id ? (
                          (v.sku || v.gtin) && (
                            <div className="col-span-12 text-[10px] font-mono text-muted-foreground -mt-1">
                              {v.sku && <>SKU: {v.sku}</>}
                              {v.sku && v.gtin && " · "}
                              {v.gtin && <>GTIN: {v.gtin}</>}
                            </div>
                          )
                        ) : (
                          <div className="col-span-12 grid grid-cols-2 gap-2 -mt-1">
                            <div>
                              <Label className="text-[10px] text-muted-foreground">SKU (opcional)</Label>
                              <Input
                                className="h-8 font-mono text-xs"
                                value={v.sku || ""}
                                onChange={(e) => updateVariant(idx, { sku: e.target.value })}
                                placeholder="Auto se vazio"
                              />
                            </div>
                            <div>
                              <Label className="text-[10px] text-muted-foreground">GTIN / EAN-13 (opcional)</Label>
                              <Input
                                className="h-8 font-mono text-xs"
                                value={v.gtin || ""}
                                onChange={(e) => updateVariant(idx, { gtin: e.target.value.replace(/\D/g, "").slice(0, 13) })}
                                placeholder="Auto se vazio"
                                inputMode="numeric"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  * Mudanças no estoque geram movimentação no histórico (tipo "ajuste").
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="sm:mr-auto" disabled={saving || loading}>
                <Trash2 className="h-4 w-4 mr-1" /> Excluir
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação remove o produto e todas as suas variações permanentemente.
                  Não afeta produtos já enviados ao PDV ou Shopify (esses precisam ser removidos lá).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar Alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
