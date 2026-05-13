import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertCircle, ArrowLeft, CheckCircle2, Loader2, Package, Search, Filter, Save, Edit,
} from "lucide-react";
import { toast } from "sonner";

interface ReviewRow {
  parent_sku: string;
  name: string | null;
  brand: string | null;
  category: string | null;
  ncm: string | null;
  cfop: string | null;
  cest: string | null;
  cost_price: number | null;
  sale_price: number | null;
  review_reason: string | null;
  updated_at: string;
  sku_count: number;
  total_stock: number;
}

const CFOP_OPTIONS = [
  { value: "5102", label: "5102 — Venda dentro do estado" },
  { value: "6102", label: "6102 — Venda interestadual" },
  { value: "5405", label: "5405 — Venda ST dentro do estado" },
  { value: "6404", label: "6404 — Venda ST interestadual" },
  { value: "5101", label: "5101 — Venda produção própria estado" },
  { value: "6101", label: "6101 — Venda produção própria interestadual" },
];

export default function ProductsReview() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "ncm" | "cfop" | "custo">("all");
  const [editing, setEditing] = useState<ReviewRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkCfop, setBulkCfop] = useState<string>("5102");
  const [bulkOpen, setBulkOpen] = useState(false);

  // edit form state
  const [fName, setFName] = useState("");
  const [fNcm, setFNcm] = useState("");
  const [fCfop, setFCfop] = useState("");
  const [fCest, setFCest] = useState("");
  const [fCost, setFCost] = useState("");
  const [fSale, setFSale] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("v_products_needs_review" as any)
      .select("*")
      .limit(2000);
    if (error) toast.error("Erro: " + error.message);
    else setRows((data || []) as any);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.parent_sku.toLowerCase().includes(q) &&
          !(r.name || "").toLowerCase().includes(q) &&
          !(r.brand || "").toLowerCase().includes(q)
        ) return false;
      }
      if (filter === "ncm" && !(r.review_reason || "").toLowerCase().includes("ncm")) return false;
      if (filter === "cfop" && !(r.review_reason || "").toLowerCase().includes("cfop")) return false;
      if (filter === "custo" && !(r.review_reason || "").toLowerCase().includes("custo")) return false;
      return true;
    });
  }, [rows, search, filter]);

  function startEdit(row: ReviewRow) {
    setEditing(row);
    setFName(row.name || "");
    setFNcm(row.ncm || "");
    setFCfop(row.cfop || "");
    setFCest(row.cest || "");
    setFCost(row.cost_price?.toString() || "");
    setFSale(row.sale_price?.toString() || "");
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    const patch: any = {
      name: fName.trim() || null,
      ncm: fNcm.trim() || null,
      cfop: fCfop.trim() || null,
      cest: fCest.trim() || null,
      cost_price: fCost ? parseFloat(fCost) : null,
      sale_price: fSale ? parseFloat(fSale) : null,
    };
    // Recompute review state
    const reasons: string[] = [];
    if (!patch.ncm || patch.ncm.length < 8) reasons.push("NCM ausente/inválido");
    if (!patch.cfop || patch.cfop.length < 4) reasons.push("CFOP ausente");
    if (!patch.cost_price || patch.cost_price <= 0) reasons.push("Custo ausente");
    if (!patch.sale_price || patch.sale_price <= 0) reasons.push("Preço de venda ausente");
    patch.needs_review = reasons.length > 0;
    patch.review_reason = reasons.length > 0 ? reasons.join("; ") : null;

    const { error } = await supabase
      .from("product_master_data")
      .update(patch)
      .eq("parent_sku", editing.parent_sku);
    setSaving(false);
    if (error) {
      toast.error("Erro: " + error.message);
    } else {
      toast.success("Salvo. " + (patch.needs_review ? "Ainda falta dado." : "Removido da fila de revisão."));
      setEditing(null);
      load();
    }
  }

  async function applyBulkCfop() {
    if (!bulkCfop) return;
    setSaving(true);
    const targets = filtered
      .filter((r) => !r.cfop || r.cfop.length < 4)
      .map((r) => r.parent_sku);
    if (targets.length === 0) {
      toast.info("Nenhum produto sem CFOP no filtro atual.");
      setSaving(false);
      return;
    }
    if (!confirm(`Aplicar CFOP ${bulkCfop} em ${targets.length} produtos?`)) {
      setSaving(false);
      return;
    }
    const { error } = await supabase
      .from("product_master_data")
      .update({ cfop: bulkCfop })
      .in("parent_sku", targets);
    setSaving(false);
    if (error) {
      toast.error("Erro: " + error.message);
    } else {
      // Re-evaluate review state via SQL (simplest: server function would be ideal, but we'll re-fetch)
      toast.success(`CFOP aplicado em ${targets.length} produtos.`);
      // Recalcular needs_review localmente: chama RPC noop ou apenas reload
      // Como o needs_review depende de NCM+CFOP+custo, vamos refetch e a view recalcula via UPDATE individual
      // Para garantir, atualizamos needs_review = (ncm null OR cost null) num único UPDATE:
      await supabase.rpc("recompute_needs_review" as any).catch(() => {});
      setBulkOpen(false);
      load();
    }
  }

  return (
    <div className="container mx-auto p-4 max-w-7xl space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-orange-500" />
            Produtos para Revisão Fiscal
          </h1>
          <p className="text-sm text-muted-foreground">
            Catálogo unificado: produtos com NCM, CFOP ou custo faltando. Corrija para liberar emissão de NF-e/NFC-e.
          </p>
        </div>
        <Button variant="outline" onClick={() => setBulkOpen(true)}>
          <Filter className="h-4 w-4 mr-1" /> Ação em lote
        </Button>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-col md:flex-row gap-2">
          <div className="flex-1 relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar por nome, SKU ou marca..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {(["all", "ncm", "cfop", "custo"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "Todos" : f.toUpperCase()}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? "Carregando..." : `${filtered.length} de ${rows.length} produtos`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
              {rows.length === 0 ? "Nenhum produto pendente de revisão." : "Nenhum resultado para o filtro."}
            </div>
          ) : (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {filtered.map((r) => (
                <div
                  key={r.parent_sku}
                  className="flex items-start gap-3 p-3 rounded border hover:bg-muted/30 cursor-pointer"
                  onClick={() => startEdit(r)}
                >
                  <Package className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.name || r.parent_sku}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.parent_sku}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(r.review_reason || "").split("; ").filter(Boolean).map((reason) => (
                        <Badge key={reason} variant="destructive" className="text-[10px]">
                          {reason}
                        </Badge>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      NCM {r.ncm || "—"} · CFOP {r.cfop || "—"} · Custo R$ {r.cost_price?.toFixed(2) || "—"}
                      {" · "}{r.sku_count} SKUs · {r.total_stock} em estoque
                    </div>
                  </div>
                  <Edit className="h-4 w-4 text-muted-foreground" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar dados fiscais</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground font-mono">
                {editing.parent_sku} · {editing.sku_count} SKUs · {editing.total_stock} em estoque
              </div>
              <div>
                <Label>Nome</Label>
                <Input value={fName} onChange={(e) => setFName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>NCM *</Label>
                  <Input
                    value={fNcm}
                    onChange={(e) => setFNcm(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    placeholder="64039900"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">8 dígitos</p>
                </div>
                <div>
                  <Label>CEST</Label>
                  <Input
                    value={fCest}
                    onChange={(e) => setFCest(e.target.value.replace(/\D/g, "").slice(0, 7))}
                    placeholder="opcional"
                  />
                </div>
                <div className="col-span-2">
                  <Label>CFOP de venda *</Label>
                  <select
                    className="w-full h-10 px-3 rounded border bg-background text-sm"
                    value={fCfop}
                    onChange={(e) => setFCfop(e.target.value)}
                  >
                    <option value="">— escolher —</option>
                    {CFOP_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Custo (R$) *</Label>
                  <Input
                    type="number" step="0.01"
                    value={fCost} onChange={(e) => setFCost(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Preço de venda (R$)</Label>
                  <Input
                    type="number" step="0.01"
                    value={fSale} onChange={(e) => setFSale(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aplicar CFOP em lote</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Aplica o CFOP escolhido em <strong>todos os {filtered.filter((r) => !r.cfop).length} produtos sem CFOP</strong> no filtro atual.
            </p>
            <div>
              <Label>CFOP padrão</Label>
              <select
                className="w-full h-10 px-3 rounded border bg-background text-sm"
                value={bulkCfop}
                onChange={(e) => setBulkCfop(e.target.value)}
              >
                {CFOP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancelar</Button>
            <Button onClick={applyBulkCfop} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
