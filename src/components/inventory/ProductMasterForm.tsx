import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, Loader2, Package, Sparkles, Upload, X, Store as StoreIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { generateEan13, normalizeColorForSku } from "@/lib/ean13";
import { sanitizeSizeInput, sanitizeColorInput, isValidSize, isValidColor } from "@/lib/variantValidation";
import { ColorSizeCombobox } from "@/components/inventory/ColorSizeCombobox";
import { ColorSizeMultiCombobox } from "@/components/inventory/ColorSizeMultiCombobox";

interface VariantRow {
  color: string;
  size: string;
  cost_price_override?: number;
  sale_price_override?: number;
  weight_kg_override?: number;
  initial_stock: number;
  preview_gtin: string;
}

interface ProductMasterFormProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (masterId: string) => void;
  initialStoreId?: string;
  initial?: {
    name?: string;
    description?: string;
    cost_price?: number;
    sale_price?: number;
    brand?: string;
    category?: string;
    ncm?: string;
    items?: Array<{ color?: string; size?: string; quantity?: number; unit_cost?: number }>;
  };
}

export function ProductMasterForm({ open, onOpenChange, onCreated, initial, initialStoreId }: ProductMasterFormProps) {
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Pai
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [brand, setBrand] = useState(initial?.brand || "");
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [newBrandMode, setNewBrandMode] = useState(false);
  const [category, setCategory] = useState(initial?.category || "");
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [newCategoryMode, setNewCategoryMode] = useState(false);
  const [ncm, setNcm] = useState(initial?.ncm || "64039900");
  const [cest, setCest] = useState("");
  const [costPrice, setCostPrice] = useState<string>(initial?.cost_price?.toString() || "");
  const [salePrice, setSalePrice] = useState<string>(initial?.sale_price?.toString() || "");
  const [weight, setWeight] = useState<string>("0.8");
  const [height, setHeight] = useState<string>("12");
  const [width, setWidth] = useState<string>("32");
  const [length, setLength] = useState<string>("22");
  const [images, setImages] = useState<string[]>([]);

  // Loja que recebe o estoque inicial / envio ao PDV
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [stockStoreId, setStockStoreId] = useState<string>(initialStoreId || "");

  useEffect(() => {
    if (!open) return;
    supabase
      .from("pos_stores")
      .select("id, name")
      .eq("is_active", true)
      .eq("is_simulation", false)
      .order("name")
      .then(({ data }) => setStores((data || []) as any));
    supabase
      .from("product_categories")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        const cats = (data || []) as { id: string; name: string }[];
        setCategories(cats);
        // Se a categoria inicial bater com uma existente, vincula o id
        if (initial?.category) {
          const match = cats.find((c) => c.name.toLowerCase() === initial.category!.toLowerCase());
          if (match) { setCategoryId(match.id); setCategory(match.name); }
          else setNewCategoryMode(true);
        }
      });
    supabase
      .from("product_brands" as any)
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        const bs = ((data || []) as any) as { id: string; name: string }[];
        setBrands(bs);
        if (initial?.brand) {
          const match = bs.find((b) => b.name.toLowerCase() === initial.brand!.toLowerCase());
          if (!match) setNewBrandMode(true);
        }
      });
  }, [open]);


  // Filhos
  const initialVariants: VariantRow[] = (initial?.items || []).map((it) => ({
    color: it.color || "",
    size: it.size || "",
    initial_stock: it.quantity || 0,
    cost_price_override: it.unit_cost,
    preview_gtin: generateEan13(),
  }));

  const [variants, setVariants] = useState<VariantRow[]>(
    initialVariants.length > 0 ? initialVariants : [
      { color: "", size: "", initial_stock: 0, preview_gtin: generateEan13() },
    ]
  );

  // Builder por matriz cor x tamanho
  const [matrixColors, setMatrixColors] = useState("");
  const [matrixSizes, setMatrixSizes] = useState("");

  function addVariant() {
    setVariants((v) => [
      ...v,
      { color: "", size: "", initial_stock: 0, preview_gtin: generateEan13() },
    ]);
  }

  function removeVariant(idx: number) {
    setVariants((v) => v.filter((_, i) => i !== idx));
  }

  function updateVariant(idx: number, patch: Partial<VariantRow>) {
    setVariants((v) => v.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  function generateMatrix() {
    const colors = matrixColors.split(",").map((c) => c.trim()).filter(Boolean);
    const sizes = matrixSizes.split(",").map((s) => s.trim()).filter(Boolean);
    if (!colors.length || !sizes.length) {
      toast.error("Informe pelo menos uma cor e um tamanho.");
      return;
    }
    const rows: VariantRow[] = [];
    for (const c of colors) {
      for (const s of sizes) {
        rows.push({
          color: c,
          size: s,
          initial_stock: 0,
          preview_gtin: generateEan13(),
        });
      }
    }
    setVariants(rows);
    toast.success(`${rows.length} variações geradas.`);
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

  const previewSkuRoot = "(será gerado)";
  const skuPreview = useMemo(() => {
    return variants.map((v) =>
      `${previewSkuRoot}-${normalizeColorForSku(v.color)}-${v.size || "U"}`
    );
  }, [variants]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Informe o nome do produto.");
      return;
    }
    if (!stockStoreId) {
      toast.error("Escolha a loja que receberá o estoque inicial (o produto será replicado em todas as lojas com estoque zero nas demais).");
      return;
    }
    if (!variants.length) {
      toast.error("Adicione pelo menos uma variação.");
      return;
    }
    for (const v of variants) {
      if (!v.color || !v.size) {
        toast.error("Todas as variações precisam de cor e tamanho.");
        return;
      }
      if (!isValidSize(v.size)) {
        toast.error(`Tamanho inválido: "${v.size}". Use números (39, 34/35) ou PP/P/M/G/GG.`);
        return;
      }
      if (!isValidColor(v.color)) {
        toast.error(`Cor inválida: "${v.color}". Cor não pode ser apenas números.`);
        return;
      }
    }

    setSaving(true);
    try {
      // Se digitou uma marca nova, cadastra no catálogo de marcas (idempotente)
      const brandTrim = brand.trim();
      if (brandTrim && !brands.some((b) => b.name.toLowerCase() === brandTrim.toLowerCase())) {
        const slug = brandTrim.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        await supabase.from("product_brands" as any).insert({ name: brandTrim, slug } as any);
      }
      const { data, error } = await supabase.rpc("create_product_with_variants", {
        p_master: {
          name,
          description,
          brand,
          category,
          category_id: categoryId || "",
          ncm,
          cest,
          cost_price: parseFloat(costPrice) || 0,
          sale_price: parseFloat(salePrice) || 0,
          weight_kg: weight,
          height_cm: height,
          width_cm: width,
          length_cm: length,
          images,
          is_active: true,
        } as any,
        p_variants: variants.map((v) => {
          // Herança automática: se a variação não tem preço próprio, herda do pai.
          const parentCost = parseFloat(costPrice);
          const parentSale = parseFloat(salePrice);
          const cost = v.cost_price_override ?? (isFinite(parentCost) ? parentCost : undefined);
          const sale = v.sale_price_override ?? (isFinite(parentSale) ? parentSale : undefined);
          return {
            color: v.color,
            size: v.size,
            cost_price_override: cost?.toString(),
            sale_price_override: sale?.toString(),
            weight_kg_override: v.weight_kg_override?.toString(),
            initial_stock: v.initial_stock,
            is_active: true,
          };
        }) as any,
      });
      if (error) throw error;
      const masterId = data as string;

      // Empurra ao PDV / catálogo unificado já com o estoque inicial na loja escolhida.
      // Envio SEMPRE obrigatório — replica em todas as lojas ativas (estoque zero nas outras).
      const { error: posErr } = await supabase.functions.invoke("create-master-product-pos", {
        body: { master_id: masterId, store_id: stockStoreId, stock_from_variants: true },
      });
      if (posErr) {
        toast.warning("Produto criado, mas falhou ao enviar ao PDV: " + posErr.message + ". Use 'Enviar ao PDV' na aba Legacy para reenviar.");
      } else {
        const storeName = stores.find((s) => s.id === stockStoreId)?.name || "loja";
        toast.success(`Produto criado e estoque lançado em ${storeName}!`);
      }

      onCreated?.(masterId);
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao criar produto: " + err.message);
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
            Novo Produto (Pai/Filhos)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Pai */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados do Produto Pai</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <Label>Nome *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tênis Nike Air Max" />
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
                    value={brand ? (brands.find((b) => b.name === brand)?.id || "__custom__") : ""}
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
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                      <SelectItem value="__new__" className="text-primary font-medium">+ Criar nova categoria</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="md:col-span-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                <Label className="flex items-center gap-1.5">
                  <StoreIcon className="h-4 w-4 text-primary" />
                  Lançar estoque na loja (PDV) *
                </Label>
                <Select value={stockStoreId} onValueChange={setStockStoreId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Escolha a loja que recebe o estoque" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  O produto vai para o PDV e Catálogo Unificado, com o estoque das variações entrando nesta loja. Sem loja selecionada, o produto fica só no cadastro (não aparece no PDV).
                </p>
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

              {/* Imagens */}
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

          {/* Matrix builder */}
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Gerador de Matriz Cor × Tamanho
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                <div>
                  <Label className="text-xs">Cores (separadas por vírgula)</Label>
                  <Input
                    value={matrixColors}
                    onChange={(e) => setMatrixColors(e.target.value)}
                    placeholder="Preto, Branco, Vermelho"
                  />
                </div>
                <div>
                  <Label className="text-xs">Tamanhos (separados por vírgula)</Label>
                  <Input
                    value={matrixSizes}
                    onChange={(e) => setMatrixSizes(e.target.value)}
                    placeholder="35, 36, 37, 38, 39, 40"
                  />
                </div>
                <Button onClick={generateMatrix} variant="secondary" size="sm">
                  <Sparkles className="h-4 w-4 mr-1" /> Gerar Variações
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[11px] text-muted-foreground self-center">Grades rápidas:</span>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => setMatrixSizes("33/34, 35/36, 37/38, 39/40")}>
                  Chinelo (33/34…)
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => setMatrixSizes("25/26, 27/28, 29/30, 31/32, 33/34")}>
                  Chinelo Infantil
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => setMatrixSizes("34, 35, 36, 37, 38, 39, 40")}>
                  Numérica 34–40
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => setMatrixSizes("37, 38, 39, 40, 41, 42, 43, 44")}>
                  Numérica 37–44
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Variações */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Variações ({variants.length})</CardTitle>
              <Button onClick={addVariant} size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {variants.map((v, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center p-2 rounded bg-muted/40">
                    <div className="col-span-3">
                      <Label className="text-[10px] text-muted-foreground">Cor</Label>
                      <ColorSizeCombobox
                        kind="color"
                        value={v.color}
                        onChange={(val) => updateVariant(idx, { color: val })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-[10px] text-muted-foreground">Tamanho</Label>
                      <ColorSizeCombobox
                        kind="size"
                        value={v.size}
                        onChange={(val) => updateVariant(idx, { size: val })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-[10px] text-muted-foreground">Estoque</Label>
                      <Input
                        className="h-8"
                        type="number"
                        value={v.initial_stock}
                        onChange={(e) => updateVariant(idx, { initial_stock: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-[10px] text-muted-foreground">Custo (R$)</Label>
                      <Input
                        className="h-8"
                        type="number"
                        step="0.01"
                        value={v.cost_price_override ?? ""}
                        onChange={(e) => updateVariant(idx, { cost_price_override: parseFloat(e.target.value) || undefined })}
                        placeholder={costPrice || "—"}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-[10px] text-muted-foreground">GTIN preview</Label>
                      <div className="font-mono text-[10px] truncate" title={v.preview_gtin}>{v.preview_gtin}</div>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button size="icon" variant="ghost" onClick={() => removeVariant(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                * SKU e GTIN finais serão gerados automaticamente pelo banco (sequencial + EAN-13 com prefixo 789).
              </p>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
            Criar Produto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
