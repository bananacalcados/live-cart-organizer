import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DollarSign, Package, Ruler, Loader2, Wand2, Save } from "lucide-react";

interface Category {
  id: string;
  name: string;
  slug: string;
  default_weight_kg: number | null;
  default_height_cm: number | null;
  default_width_cm: number | null;
  default_length_cm: number | null;
}

const BATCH_SIZE = 200;

export default function InventoryBulkActions() {
  // ====== CUSTO ======
  const [divisor, setDivisor] = useState<number>(2.5);
  const [previewCostPos, setPreviewCostPos] = useState<number | null>(null);
  const [previewCostMaster, setPreviewCostMaster] = useState<number | null>(null);
  const [loadingCostPreview, setLoadingCostPreview] = useState(false);
  const [applyingCost, setApplyingCost] = useState(false);
  const [confirmCostOpen, setConfirmCostOpen] = useState(false);

  // ====== PESO/DIMENSÕES ======
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [savingCatId, setSavingCatId] = useState<string | null>(null);
  const [previewDimMaster, setPreviewDimMaster] = useState<number | null>(null);
  const [loadingDimPreview, setLoadingDimPreview] = useState(false);
  const [applyingDim, setApplyingDim] = useState(false);
  const [confirmDimOpen, setConfirmDimOpen] = useState(false);

  // ============ LOAD CATEGORIES ============
  useEffect(() => {
    (async () => {
      setLoadingCats(true);
      const { data, error } = await supabase
        .from("product_categories")
        .select("id, name, slug, default_weight_kg, default_height_cm, default_width_cm, default_length_cm")
        .eq("is_active", true)
        .order("name");
      if (error) {
        toast.error("Erro ao carregar categorias");
      } else {
        setCategories((data || []) as Category[]);
      }
      setLoadingCats(false);
    })();
  }, []);

  // ============ PREVIEW CUSTO ============
  const loadCostPreview = async () => {
    setLoadingCostPreview(true);
    try {
      const [pos, master] = await Promise.all([
        supabase
          .from("pos_products")
          .select("id", { count: "exact", head: true })
          .or("cost_price.is.null,cost_price.eq.0")
          .gt("price", 0)
          .eq("is_active", true),
        supabase
          .from("products_master")
          .select("id", { count: "exact", head: true })
          .or("cost_price.is.null,cost_price.eq.0")
          .gt("sale_price", 0)
          .eq("is_active", true),
      ]);
      setPreviewCostPos(pos.count ?? 0);
      setPreviewCostMaster(master.count ?? 0);
    } catch (e) {
      toast.error("Erro ao calcular preview");
    } finally {
      setLoadingCostPreview(false);
    }
  };

  useEffect(() => {
    loadCostPreview();
    loadDimPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============ APLICAR CUSTO ============
  const applyCost = async () => {
    if (divisor <= 0) {
      toast.error("Divisor deve ser maior que zero");
      return;
    }
    setApplyingCost(true);
    let posUpdated = 0;
    let masterUpdated = 0;
    try {
      // pos_products
      let cursor: string | null = null;
      while (true) {
        let q = supabase
          .from("pos_products")
          .select("id, price")
          .or("cost_price.is.null,cost_price.eq.0")
          .gt("price", 0)
          .eq("is_active", true)
          .order("id", { ascending: true })
          .limit(BATCH_SIZE);
        if (cursor) q = q.gt("id", cursor);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;

        await Promise.all(
          data.map((p: any) => {
            const cost = Number((p.price / divisor).toFixed(2));
            return supabase.from("pos_products").update({ cost_price: cost }).eq("id", p.id);
          })
        );
        posUpdated += data.length;
        cursor = data[data.length - 1].id;
        if (data.length < BATCH_SIZE) break;
      }

      // products_master
      cursor = null;
      while (true) {
        let q = supabase
          .from("products_master")
          .select("id, sale_price")
          .or("cost_price.is.null,cost_price.eq.0")
          .gt("sale_price", 0)
          .eq("is_active", true)
          .order("id", { ascending: true })
          .limit(BATCH_SIZE);
        if (cursor) q = q.gt("id", cursor);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;

        await Promise.all(
          data.map((p: any) => {
            const cost = Number((p.sale_price / divisor).toFixed(2));
            return supabase.from("products_master").update({ cost_price: cost }).eq("id", p.id);
          })
        );
        masterUpdated += data.length;
        cursor = data[data.length - 1].id;
        if (data.length < BATCH_SIZE) break;
      }

      toast.success(`Custos preenchidos: ${posUpdated} SKUs + ${masterUpdated} produtos mestre`);
      setConfirmCostOpen(false);
      await loadCostPreview();
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    } finally {
      setApplyingCost(false);
    }
  };

  // ============ PREVIEW DIMENSÕES ============
  const loadDimPreview = async () => {
    setLoadingDimPreview(true);
    try {
      const { count } = await supabase
        .from("products_master")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .not("category_id", "is", null)
        .or(
          "weight_kg.is.null,height_cm.is.null,width_cm.is.null,length_cm.is.null"
        );
      setPreviewDimMaster(count ?? 0);
    } catch {
      setPreviewDimMaster(0);
    } finally {
      setLoadingDimPreview(false);
    }
  };

  // ============ SALVAR CATEGORIA ============
  const saveCategory = async (cat: Category) => {
    setSavingCatId(cat.id);
    const { error } = await supabase
      .from("product_categories")
      .update({
        default_weight_kg: cat.default_weight_kg,
        default_height_cm: cat.default_height_cm,
        default_width_cm: cat.default_width_cm,
        default_length_cm: cat.default_length_cm,
      })
      .eq("id", cat.id);
    setSavingCatId(null);
    if (error) toast.error("Erro ao salvar");
    else toast.success(`${cat.name} salvo`);
  };

  const updateCatField = (id: string, field: keyof Category, value: any) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  // ============ APLICAR DIMENSÕES ============
  const applyDimensions = async () => {
    setApplyingDim(true);
    let updated = 0;
    try {
      for (const cat of categories) {
        if (
          !cat.default_weight_kg &&
          !cat.default_height_cm &&
          !cat.default_width_cm &&
          !cat.default_length_cm
        )
          continue;

        let cursor: string | null = null;
        while (true) {
          let q = supabase
            .from("products_master")
            .select("id, weight_kg, height_cm, width_cm, length_cm")
            .eq("category_id", cat.id)
            .eq("is_active", true)
            .or("weight_kg.is.null,height_cm.is.null,width_cm.is.null,length_cm.is.null")
            .order("id", { ascending: true })
            .limit(BATCH_SIZE);
          if (cursor) q = q.gt("id", cursor);
          const { data, error } = await q;
          if (error) throw error;
          if (!data || data.length === 0) break;

          await Promise.all(
            data.map((p: any) => {
              const patch: any = {};
              if (p.weight_kg == null && cat.default_weight_kg) patch.weight_kg = cat.default_weight_kg;
              if (p.height_cm == null && cat.default_height_cm) patch.height_cm = cat.default_height_cm;
              if (p.width_cm == null && cat.default_width_cm) patch.width_cm = cat.default_width_cm;
              if (p.length_cm == null && cat.default_length_cm) patch.length_cm = cat.default_length_cm;
              if (Object.keys(patch).length === 0) return Promise.resolve();
              return supabase.from("products_master").update(patch).eq("id", p.id);
            })
          );
          updated += data.length;
          cursor = data[data.length - 1].id;
          if (data.length < BATCH_SIZE) break;
        }
      }
      toast.success(`Peso/dimensões preenchidos em ${updated} produtos`);
      setConfirmDimOpen(false);
      await loadDimPreview();
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    } finally {
      setApplyingDim(false);
    }
  };

  const totalCost = useMemo(
    () => (previewCostPos ?? 0) + (previewCostMaster ?? 0),
    [previewCostPos, previewCostMaster]
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wand2 className="h-6 w-6 text-primary" /> Ações em Massa
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Preencha automaticamente dados faltantes do catálogo. Cada ação afeta apenas produtos sem o dado preenchido.
        </p>
      </div>

      {/* CARD CUSTO */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-5 w-5 text-primary" /> Preencher Preço de Custo
          </CardTitle>
          <CardDescription>
            Calcula <code className="bg-muted px-1 rounded">custo = preço de venda ÷ divisor</code>. Aplica apenas em produtos com custo zerado/vazio e preço de venda &gt; 0.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label htmlFor="divisor">Divisor</Label>
              <Input
                id="divisor"
                type="number"
                step="0.1"
                min="0.1"
                value={divisor}
                onChange={(e) => setDivisor(Number(e.target.value))}
                className="w-28"
              />
            </div>
            <Button variant="outline" size="sm" onClick={loadCostPreview} disabled={loadingCostPreview}>
              {loadingCostPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : "Recalcular"}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">SKUs (pos_products)</p>
              <p className="text-2xl font-bold">
                {loadingCostPreview ? "…" : previewCostPos ?? "—"}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Produtos mestre</p>
              <p className="text-2xl font-bold">
                {loadingCostPreview ? "…" : previewCostMaster ?? "—"}
              </p>
            </div>
          </div>

          <Button
            onClick={() => setConfirmCostOpen(true)}
            disabled={totalCost === 0 || applyingCost || loadingCostPreview}
            className="w-full"
          >
            {applyingCost ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Aplicando…</>
            ) : (
              <>Preencher custo em {totalCost} produto(s)</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* CARD DIMENSÕES */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ruler className="h-5 w-5 text-primary" /> Preencher Peso e Dimensões
          </CardTitle>
          <CardDescription>
            Usa os valores padrão de cada categoria. Edite a tabela abaixo se quiser ajustar antes de aplicar. Afeta apenas <strong>produtos mestre</strong> com categoria definida e dado faltante.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingCats ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="w-24">Peso (kg)</TableHead>
                    <TableHead className="w-24">Alt (cm)</TableHead>
                    <TableHead className="w-24">Larg (cm)</TableHead>
                    <TableHead className="w-24">Comp (cm)</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((cat) => (
                    <TableRow key={cat.id}>
                      <TableCell className="font-medium text-sm">{cat.name}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={cat.default_weight_kg ?? ""}
                          onChange={(e) =>
                            updateCatField(cat.id, "default_weight_kg", e.target.value ? Number(e.target.value) : null)
                          }
                          className="h-8 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={cat.default_height_cm ?? ""}
                          onChange={(e) =>
                            updateCatField(cat.id, "default_height_cm", e.target.value ? Number(e.target.value) : null)
                          }
                          className="h-8 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={cat.default_width_cm ?? ""}
                          onChange={(e) =>
                            updateCatField(cat.id, "default_width_cm", e.target.value ? Number(e.target.value) : null)
                          }
                          className="h-8 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={cat.default_length_cm ?? ""}
                          onChange={(e) =>
                            updateCatField(cat.id, "default_length_cm", e.target.value ? Number(e.target.value) : null)
                          }
                          className="h-8 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => saveCategory(cat)}
                          disabled={savingCatId === cat.id}
                          className="h-8 w-8"
                        >
                          {savingCatId === cat.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <Package className="h-3 w-3" />
              {loadingDimPreview ? "…" : previewDimMaster ?? 0} produtos mestre com dados faltantes
            </Badge>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadDimPreview} disabled={loadingDimPreview}>
                Recalcular
              </Button>
              <Button
                onClick={() => setConfirmDimOpen(true)}
                disabled={!previewDimMaster || applyingDim}
              >
                {applyingDim ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Aplicando…</>
                ) : (
                  "Preencher peso/dimensões"
                )}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Dica: salve as alterações da categoria antes de aplicar para garantir que os novos defaults sejam usados.
          </p>
        </CardContent>
      </Card>

      {/* CONFIRM CUSTO */}
      <AlertDialog open={confirmCostOpen} onOpenChange={setConfirmCostOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar preenchimento de custo</AlertDialogTitle>
            <AlertDialogDescription>
              Serão atualizados <strong>{previewCostPos ?? 0} SKUs</strong> e <strong>{previewCostMaster ?? 0} produtos mestre</strong>, calculando <code>custo = venda ÷ {divisor}</code>. Esta operação não pode ser desfeita automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applyingCost}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); applyCost(); }} disabled={applyingCost}>
              {applyingCost ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* CONFIRM DIM */}
      <AlertDialog open={confirmDimOpen} onOpenChange={setConfirmDimOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar peso e dimensões</AlertDialogTitle>
            <AlertDialogDescription>
              Serão atualizados até <strong>{previewDimMaster ?? 0}</strong> produtos mestre usando os valores padrão de cada categoria. Apenas campos vazios serão preenchidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applyingDim}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); applyDimensions(); }} disabled={applyingDim}>
              {applyingDim ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
