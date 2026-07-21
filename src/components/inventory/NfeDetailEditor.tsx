import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Save, Package, Plus, Trash2, FileText, Link2, Store as StoreIcon, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ProductMasterForm } from "./ProductMasterForm";
import { ExistingParentSearchDialog } from "./ExistingParentSearchDialog";
import { ColorSizeCombobox } from "./ColorSizeCombobox";

interface Invoice {
  id: string;
  invoice_number: string | null;
  invoice_series: string | null;
  nfe_key: string | null;
  supplier_name: string | null;
  supplier_cnpj: string | null;
  supplier_ie: string | null;
  emission_date: string | null;
  total_value: number | null;
  total_products: number | null;
  total_taxes: number | null;
  total_freight: number | null;
  total_discount: number | null;
  payment_method: string | null;
  status: string;
  notes: string | null;
}

interface Item {
  id: string;
  line_number: number | null;
  description: string;
  ncm: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  parsed_color: string | null;
  parsed_size: string | null;
  ean: string | null;
  variant_id: string | null;
  master_id: string | null;
  linked_parent_sku: string | null;
  linked_store_id: string | null;
  linked_at: string | null;
}

interface Installment {
  id: string;
  installment_number: number;
  due_date: string;
  amount: number;
  paid: boolean;
  paid_at: string | null;
}

interface GtinMatch {
  parent_sku: string;
  name: string;
}

const fixed = (value: unknown, digits = 2) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(digits) : (0).toFixed(digits);
};

export function NfeDetailEditor({
  invoiceId,
  open,
  onOpenChange,
  onChanged,
}: {
  invoiceId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Loja única que recebe o estoque desta NF
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [stockStoreId, setStockStoreId] = useState<string>("");

  // Seleção de linhas
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Match por GTIN: ean -> produto existente
  const [gtinMatches, setGtinMatches] = useState<Record<string, GtinMatch>>({});

  // Produto novo (subconjunto de linhas)
  const [showProductForm, setShowProductForm] = useState(false);
  const [productInitial, setProductInitial] = useState<any>(null);
  const [productFormItemIds, setProductFormItemIds] = useState<string[]>([]);

  // Vincular a pai existente
  const [showSearch, setShowSearch] = useState(false);
  const [linking, setLinking] = useState(false);

  // Prévia (novas vs atualizadas) antes de confirmar o vínculo
  const [linkPreview, setLinkPreview] = useState<{
    parentSku: string;
    parentName: string;
    ids: string[];
    created: string[];
    updated: string[];
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function loadGtinMatches(its: Item[]) {
    const eans = its.map((i) => i.ean).filter((e): e is string => !!e && /^\d{8,14}$/.test(e));
    if (eans.length === 0) {
      setGtinMatches({});
      return;
    }
    const { data } = await supabase
      .from("pos_products")
      .select("barcode, parent_sku, name")
      .in("barcode", eans)
      .not("parent_sku", "is", null);
    const map: Record<string, GtinMatch> = {};
    for (const r of (data || []) as any[]) {
      if (!r.barcode || map[r.barcode]) continue;
      const baseName = (r.name || "").includes(" - ")
        ? (r.name as string).slice(0, (r.name as string).lastIndexOf(" - "))
        : r.name;
      map[r.barcode] = { parent_sku: r.parent_sku, name: baseName || r.parent_sku };
    }
    setGtinMatches(map);
  }

  async function load() {
    setLoading(true);
    const [{ data: inv }, { data: its }, { data: ins }, { data: st }] = await Promise.all([
      supabase.from("purchase_invoices").select("*").eq("id", invoiceId).single(),
      supabase.from("purchase_invoice_items").select("*").eq("invoice_id", invoiceId).order("line_number", { ascending: true, nullsFirst: false }).order("created_at"),
      supabase.from("purchase_invoice_installments").select("*").eq("invoice_id", invoiceId).order("installment_number"),
      supabase.from("pos_stores").select("id, name").eq("is_active", true).order("name"),
    ]);
    setInvoice(inv as any);
    const itemsData = (its || []) as any as Item[];
    setItems(itemsData);
    setInstallments((ins || []) as any);
    setStores((st || []) as any);
    setSelectedIds(new Set());
    await loadGtinMatches(itemsData);
    setLoading(false);
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, open]);

  async function saveInvoice() {
    if (!invoice) return;
    setSaving(true);
    const { error } = await supabase
      .from("purchase_invoices")
      .update({
        supplier_name: invoice.supplier_name,
        supplier_cnpj: invoice.supplier_cnpj,
        invoice_number: invoice.invoice_number,
        emission_date: invoice.emission_date,
        total_value: invoice.total_value,
        payment_method: invoice.payment_method,
        notes: invoice.notes,
        status: invoice.status === "draft" ? "reviewed" : invoice.status,
      })
      .eq("id", invoice.id);
    setSaving(false);
    if (error) toast.error("Erro ao salvar: " + error.message);
    else { toast.success("NF salva."); onChanged?.(); }
  }

  async function updateItem(id: string, patch: Partial<Item>) {
    setItems((it) => it.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("purchase_invoice_items").update(patch).eq("id", id);
    if (error) toast.error("Erro: " + error.message);
  }

  function toggleSelect(id: string) {
    setSelectedIds((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const linkableItems = items.filter((i) => !i.master_id && !i.linked_parent_sku);
  function toggleSelectAll() {
    setSelectedIds((s) =>
      s.size === linkableItems.length && linkableItems.length > 0
        ? new Set()
        : new Set(linkableItems.map((i) => i.id))
    );
  }

  // ---- Criar novo produto pai a partir das linhas selecionadas ----
  function openCreateFromSelected() {
    if (!stockStoreId) { toast.error("Escolha a loja que recebe o estoque."); return; }
    const sel = items.filter((i) => selectedIds.has(i.id));
    if (!sel.length) return;
    setProductFormItemIds(sel.map((i) => i.id));
    setProductInitial({
      name: sel[0].description.replace(/\s+\d{2,3}$/, "").trim(),
      cost_price: sel[0].unit_cost,
      ncm: sel[0].ncm || "64039900",
      items: sel.map((it) => ({
        color: it.parsed_color || "",
        size: it.parsed_size || "",
        quantity: it.quantity,
        unit_cost: it.unit_cost,
      })),
    });
    setShowProductForm(true);
  }

  // ---- Vincular linhas selecionadas a um pai existente ----
  // Passo 1: prévia (dry_run) — mostra quais variações são NOVAS vs ATUALIZADAS antes de gravar.
  async function requestLink(parentSku: string, ids: string[], parentName = "") {
    if (!stockStoreId) { toast.error("Escolha a loja que recebe o estoque."); return; }
    if (!ids.length) return;
    setPreviewLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("nfe-link-items-pos", {
        body: { invoice_id: invoiceId, store_id: stockStoreId, parent_sku: parentSku, item_ids: ids, dry_run: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setShowSearch(false);
      setLinkPreview({
        parentSku,
        parentName: parentName || parentSku,
        ids,
        created: data?.created || [],
        updated: data?.updated || [],
      });
    } catch (err: any) {
      toast.error("Erro ao calcular prévia: " + (err.message || err));
    } finally {
      setPreviewLoading(false);
    }
  }

  // Passo 2: confirma e grava de fato.
  async function linkToParent(parentSku: string, ids: string[]) {
    if (!stockStoreId) { toast.error("Escolha a loja que recebe o estoque."); return; }
    if (!ids.length) return;
    setLinking(true);
    try {
      const { data, error } = await supabase.functions.invoke("nfe-link-items-pos", {
        body: { invoice_id: invoiceId, store_id: stockStoreId, parent_sku: parentSku, item_ids: ids },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data?.message || "Linhas vinculadas e estoque lançado.");
      setLinkPreview(null);
      setShowSearch(false);
      setSelectedIds(new Set());
      await load();
      onChanged?.();
    } catch (err: any) {
      toast.error("Erro ao vincular: " + (err.message || err));
    } finally {
      setLinking(false);
    }
  }

  function quickLinkLine(item: Item, match: GtinMatch) {
    requestLink(match.parent_sku, [item.id], match.name);
  }

  // ---- Parcelas ----
  async function addInstallment() {
    const next = installments.length + 1;
    const { data, error } = await supabase
      .from("purchase_invoice_installments")
      .insert({ invoice_id: invoiceId, installment_number: next, due_date: new Date().toISOString().slice(0, 10), amount: 0 })
      .select().single();
    if (error) toast.error("Erro: " + error.message);
    else setInstallments((i) => [...i, data as any]);
  }
  async function updateInstallment(id: string, patch: Partial<Installment>) {
    setInstallments((ins) => ins.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("purchase_invoice_installments").update(patch).eq("id", id);
    if (error) toast.error("Erro: " + error.message);
  }
  async function deleteInstallment(id: string) {
    const { error } = await supabase.from("purchase_invoice_installments").delete().eq("id", id);
    if (error) toast.error("Erro: " + error.message);
    else setInstallments((i) => i.filter((x) => x.id !== id));
  }
  async function togglePaid(inst: Installment) {
    const newPaid = !inst.paid;
    await updateInstallment(inst.id, { paid: newPaid, paid_at: newPaid ? new Date().toISOString() : null } as any);
  }

  const selectedStoreName = stores.find((s) => s.id === stockStoreId)?.name;
  const pendingCount = linkableItems.length;

  if (loading || !invoice) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl">
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              NF {invoice.invoice_number || "—"} · {invoice.supplier_name}
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="items">
            <TabsList className="w-full">
              <TabsTrigger value="header" className="flex-1">Cabeçalho</TabsTrigger>
              <TabsTrigger value="items" className="flex-1">Itens ({items.length})</TabsTrigger>
              <TabsTrigger value="installments" className="flex-1">Parcelas ({installments.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="header" className="space-y-3 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Fornecedor</Label>
                  <Input value={invoice.supplier_name || ""} onChange={(e) => setInvoice({ ...invoice, supplier_name: e.target.value })} />
                </div>
                <div>
                  <Label>CNPJ</Label>
                  <Input value={invoice.supplier_cnpj || ""} onChange={(e) => setInvoice({ ...invoice, supplier_cnpj: e.target.value })} />
                </div>
                <div>
                  <Label>Número NF</Label>
                  <Input value={invoice.invoice_number || ""} onChange={(e) => setInvoice({ ...invoice, invoice_number: e.target.value })} />
                </div>
                <div>
                  <Label>Emissão</Label>
                  <Input type="date" value={invoice.emission_date ? invoice.emission_date.slice(0, 10) : ""} onChange={(e) => setInvoice({ ...invoice, emission_date: e.target.value })} />
                </div>
                <div>
                  <Label>Valor Total (R$)</Label>
                  <Input type="number" step="0.01" value={invoice.total_value || 0} onChange={(e) => setInvoice({ ...invoice, total_value: parseFloat(e.target.value) })} />
                </div>
                <div>
                  <Label>Forma de Pagamento</Label>
                  <Input value={invoice.payment_method || ""} onChange={(e) => setInvoice({ ...invoice, payment_method: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <Label>Observações</Label>
                  <Input value={invoice.notes || ""} onChange={(e) => setInvoice({ ...invoice, notes: e.target.value })} />
                </div>
              </div>
              <Button onClick={saveInvoice} disabled={saving} size="sm">
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Salvar Cabeçalho
              </Button>
            </TabsContent>

            <TabsContent value="items" className="space-y-3 mt-4">
              {/* Loja única da NF */}
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <Label className="flex items-center gap-1.5 mb-1">
                  <StoreIcon className="h-4 w-4 text-primary" />
                  Loja que recebe o estoque desta NF *
                </Label>
                <Select value={stockStoreId} onValueChange={setStockStoreId}>
                  <SelectTrigger className="max-w-sm">
                    <SelectValue placeholder="Escolha a loja" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  O estoque de entrada entra nesta loja. Os produtos ficam bipáveis em todas as lojas (estoque compartilhado para Shopify).
                </p>
              </div>

              {/* Barra de seleção / ações */}
              <div className="flex flex-wrap items-center justify-between gap-2 sticky top-0 z-10 bg-background py-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={pendingCount > 0 && selectedIds.size === pendingCount}
                    onCheckedChange={toggleSelectAll}
                    disabled={pendingCount === 0}
                  />
                  <span className="text-sm text-muted-foreground">
                    {selectedIds.size > 0 ? `${selectedIds.size} selecionada(s)` : `Selecionar todas (${pendingCount})`}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedIds.size === 0 || linking || previewLoading}
                    onClick={() => setShowSearch(true)}
                  >
                    <Link2 className="h-4 w-4 mr-1" /> Vincular a pai existente
                  </Button>
                  <Button
                    size="sm"
                    disabled={selectedIds.size === 0 || linking}
                    onClick={openCreateFromSelected}
                  >
                    <Sparkles className="h-4 w-4 mr-1" /> Criar novo produto pai
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Marque as linhas de um mesmo modelo e agrupe-as em um produto pai (novo ou existente).
              </p>

              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {items.map((it) => {
                  const isLinked = !!it.master_id || !!it.linked_parent_sku;
                  const match = it.ean ? gtinMatches[it.ean] : undefined;
                  return (
                    <Card key={it.id} className={isLinked ? "opacity-70" : selectedIds.has(it.id) ? "ring-2 ring-primary" : ""}>
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            className="mt-1"
                            checked={selectedIds.has(it.id)}
                            onCheckedChange={() => toggleSelect(it.id)}
                            disabled={isLinked}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{it.description}</div>
                            <div className="text-xs text-muted-foreground">
                              NCM {it.ncm || "—"} · EAN {it.ean || "—"}
                            </div>
                            {match && !isLinked && (
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30">
                                  GTIN encontrado: {match.name}
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs"
                                  disabled={linking || previewLoading}
                                  onClick={() => quickLinkLine(it, match)}
                                >
                                  <Link2 className="h-3 w-3 mr-1" /> Vincular esta
                                </Button>
                              </div>
                            )}
                          </div>
                          {isLinked && (
                            <Badge variant="secondary" className="shrink-0">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              {it.master_id ? "Produto criado" : "Vinculado"}
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pl-7">
                          <div>
                            <Label className="text-[10px]">Qtd</Label>
                            <Input className="h-8" type="number" value={it.quantity} disabled={isLinked}
                              onChange={(e) => updateItem(it.id, { quantity: parseFloat(e.target.value) || 0 })} />
                          </div>
                          <div>
                            <Label className="text-[10px]">Custo Unit.</Label>
                            <Input className="h-8" type="number" step="0.01" value={it.unit_cost} disabled={isLinked}
                              onChange={(e) => updateItem(it.id, { unit_cost: parseFloat(e.target.value) || 0 })} />
                          </div>
                          <div>
                            <Label className="text-[10px]">Cor</Label>
                            <ColorSizeCombobox
                              kind="color"
                              value={it.parsed_color || ""}
                              disabled={isLinked}
                              onChange={(val) => updateItem(it.id, { parsed_color: val })}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Tamanho</Label>
                            <ColorSizeCombobox
                              kind="size"
                              value={it.parsed_size || ""}
                              disabled={isLinked}
                              onChange={(val) => updateItem(it.id, { parsed_size: val })}
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="installments" className="space-y-3 mt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Total a pagar: R$ {fixed(installments.reduce((s, i) => s + Number(i.amount ?? 0), 0))}
                </p>
                <Button size="sm" onClick={addInstallment}>
                  <Plus className="h-4 w-4 mr-1" /> Nova Parcela
                </Button>
              </div>
              <div className="space-y-2">
                {installments.map((inst) => (
                  <div key={inst.id} className="grid grid-cols-12 gap-2 items-center p-2 rounded bg-muted/30">
                    <div className="col-span-1 text-center font-mono text-sm">{inst.installment_number}</div>
                    <div className="col-span-4">
                      <Label className="text-[10px]">Vencimento</Label>
                      <Input className="h-8" type="date" value={inst.due_date} onChange={(e) => updateInstallment(inst.id, { due_date: e.target.value })} />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-[10px]">Valor</Label>
                      <Input className="h-8" type="number" step="0.01" value={inst.amount} onChange={(e) => updateInstallment(inst.id, { amount: parseFloat(e.target.value) || 0 })} />
                    </div>
                    <div className="col-span-3 flex items-end">
                      <Button size="sm" variant={inst.paid ? "default" : "outline"} className="w-full h-8" onClick={() => togglePaid(inst)}>
                        {inst.paid ? "✓ Pago" : "Marcar Pago"}
                      </Button>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button size="icon" variant="ghost" onClick={() => deleteInstallment(inst.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                {installments.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-6">Nenhuma parcela cadastrada.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showProductForm && productInitial && (
        <ProductMasterForm
          open={showProductForm}
          initialStoreId={stockStoreId}
          onOpenChange={(v) => { setShowProductForm(v); if (!v) load(); }}
          initial={productInitial}
          onCreated={async (masterId) => {
            if (productFormItemIds.length > 0) {
              await supabase
                .from("purchase_invoice_items")
                .update({ master_id: masterId })
                .in("id", productFormItemIds);
            }
            await supabase.from("purchase_invoices").update({ status: "products_created" }).eq("id", invoiceId);
            setProductFormItemIds([]);
            setSelectedIds(new Set());
            toast.success("Produto criado e linhas vinculadas.");
          }}
        />
      )}

      <ExistingParentSearchDialog
        open={showSearch}
        onOpenChange={setShowSearch}
        onSelect={(parentSku, name) => requestLink(parentSku, [...selectedIds], name)}
      />

      {/* Confirmação com prévia de variações novas vs atualizadas */}
      <Dialog open={!!linkPreview} onOpenChange={(v) => { if (!v) setLinkPreview(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" /> Confirmar vínculo
            </DialogTitle>
          </DialogHeader>
          {linkPreview && (
            <div className="space-y-3 text-sm">
              <p>
                Vincular <strong>{linkPreview.ids.length}</strong> linha(s) ao pai{" "}
                <strong>{linkPreview.parentName}</strong>. Estoque entra em{" "}
                <strong>{selectedStoreName || "loja"}</strong>.
              </p>
              {linkPreview.created.length > 0 && (
                <div className="rounded-md border border-green-500/30 bg-green-500/10 p-2">
                  <div className="font-medium text-green-700 dark:text-green-400 flex items-center gap-1 mb-1">
                    <Sparkles className="h-3.5 w-3.5" /> {linkPreview.created.length} variação(ões) NOVA(S)
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {linkPreview.created.map((c, i) => (
                      <Badge key={i} variant="outline" className="bg-green-500/10 border-green-500/30">{c}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {linkPreview.updated.length > 0 && (
                <div className="rounded-md border bg-muted/40 p-2">
                  <div className="font-medium flex items-center gap-1 mb-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {linkPreview.updated.length} já existe(m) — soma estoque
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {linkPreview.updated.map((u, i) => (
                      <Badge key={i} variant="secondary">{u}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkPreview(null)} disabled={linking}>Cancelar</Button>
            <Button
              onClick={() => linkPreview && linkToParent(linkPreview.parentSku, linkPreview.ids)}
              disabled={linking}
            >
              {linking ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2 className="h-4 w-4 mr-1" />}
              Confirmar e lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
