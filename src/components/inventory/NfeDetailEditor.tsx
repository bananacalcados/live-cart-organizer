import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Save, Package, Plus, Trash2, Calendar, FileText } from "lucide-react";
import { toast } from "sonner";
import { ProductMasterForm } from "./ProductMasterForm";

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
}

interface Installment {
  id: string;
  installment_number: number;
  due_date: string;
  amount: number;
  paid: boolean;
  paid_at: string | null;
}

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
  const [showProductForm, setShowProductForm] = useState(false);
  const [productInitial, setProductInitial] = useState<any>(null);

  async function load() {
    setLoading(true);
    const [{ data: inv }, { data: its }, { data: ins }] = await Promise.all([
      supabase.from("purchase_invoices").select("*").eq("id", invoiceId).single(),
      supabase.from("purchase_invoice_items").select("*").eq("invoice_id", invoiceId).order("created_at"),
      supabase.from("purchase_invoice_installments").select("*").eq("invoice_id", invoiceId).order("installment_number"),
    ]);
    setInvoice(inv as any);
    setItems((its || []) as any);
    setInstallments((ins || []) as any);
    setLoading(false);
  }

  useEffect(() => {
    if (open) load();
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
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
    } else {
      toast.success("NF salva.");
      onChanged?.();
    }
  }

  async function updateItem(id: string, patch: Partial<Item>) {
    setItems((it) => it.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("purchase_invoice_items").update(patch).eq("id", id);
    if (error) toast.error("Erro: " + error.message);
  }

  async function addInstallment() {
    const next = installments.length + 1;
    const { data, error } = await supabase
      .from("purchase_invoice_installments")
      .insert({
        invoice_id: invoiceId,
        installment_number: next,
        due_date: new Date().toISOString().slice(0, 10),
        amount: 0,
      })
      .select()
      .single();
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
    await updateInstallment(inst.id, {
      paid: newPaid,
      paid_at: newPaid ? new Date().toISOString() : null,
    } as any);
  }

  function openCreateProductFromItem(item: Item) {
    setProductInitial({
      name: item.description,
      cost_price: item.unit_cost,
      ncm: item.ncm || "64039900",
      items: [
        {
          color: item.parsed_color || "",
          size: item.parsed_size || "",
          quantity: item.quantity,
          unit_cost: item.unit_cost,
        },
      ],
    });
    setShowProductForm(true);
  }

  function openCreateAllProducts() {
    if (!items.length) return;
    setProductInitial({
      name: items[0].description.split(" ").slice(0, 4).join(" "),
      cost_price: items[0].unit_cost,
      ncm: items[0].ncm || "64039900",
      items: items.map((it) => ({
        color: it.parsed_color || "",
        size: it.parsed_size || "",
        quantity: it.quantity,
        unit_cost: it.unit_cost,
      })),
    });
    setShowProductForm(true);
  }

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

          <Tabs defaultValue="header">
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
                  <Input
                    type="date"
                    value={invoice.emission_date ? invoice.emission_date.slice(0, 10) : ""}
                    onChange={(e) => setInvoice({ ...invoice, emission_date: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Valor Total (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={invoice.total_value || 0}
                    onChange={(e) => setInvoice({ ...invoice, total_value: parseFloat(e.target.value) })}
                  />
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
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {items.length} itens · Total R$ {items.reduce((s, i) => s + (i.total_cost || 0), 0).toFixed(2)}
                </p>
                <Button size="sm" onClick={openCreateAllProducts} disabled={!items.length}>
                  <Package className="h-4 w-4 mr-1" /> Criar Produto a partir de todos
                </Button>
              </div>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {items.map((it) => (
                  <Card key={it.id}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{it.description}</div>
                          <div className="text-xs text-muted-foreground">
                            NCM {it.ncm || "—"} · EAN {it.ean || "—"}
                          </div>
                        </div>
                        {it.master_id && <Badge variant="secondary">Produto criado</Badge>}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        <div>
                          <Label className="text-[10px]">Qtd</Label>
                          <Input
                            className="h-8"
                            type="number"
                            value={it.quantity}
                            onChange={(e) => updateItem(it.id, { quantity: parseFloat(e.target.value) || 0 })}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px]">Custo Unit.</Label>
                          <Input
                            className="h-8"
                            type="number"
                            step="0.01"
                            value={it.unit_cost}
                            onChange={(e) => updateItem(it.id, { unit_cost: parseFloat(e.target.value) || 0 })}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px]">Cor</Label>
                          <Input
                            className="h-8"
                            value={it.parsed_color || ""}
                            onChange={(e) => updateItem(it.id, { parsed_color: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px]">Tamanho</Label>
                          <Input
                            className="h-8"
                            value={it.parsed_size || ""}
                            onChange={(e) => updateItem(it.id, { parsed_size: e.target.value })}
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full h-8 text-xs"
                            onClick={() => openCreateProductFromItem(it)}
                            disabled={!!it.master_id}
                          >
                            <Package className="h-3 w-3 mr-1" /> Criar
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="installments" className="space-y-3 mt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Total a pagar: R$ {installments.reduce((s, i) => s + (i.amount || 0), 0).toFixed(2)}
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
                      <Input
                        className="h-8"
                        type="date"
                        value={inst.due_date}
                        onChange={(e) => updateInstallment(inst.id, { due_date: e.target.value })}
                      />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-[10px]">Valor</Label>
                      <Input
                        className="h-8"
                        type="number"
                        step="0.01"
                        value={inst.amount}
                        onChange={(e) => updateInstallment(inst.id, { amount: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="col-span-3 flex items-end">
                      <Button
                        size="sm"
                        variant={inst.paid ? "default" : "outline"}
                        className="w-full h-8"
                        onClick={() => togglePaid(inst)}
                      >
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
                  <p className="text-center text-sm text-muted-foreground py-6">
                    Nenhuma parcela cadastrada.
                  </p>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showProductForm && productInitial && (
        <ProductMasterForm
          open={showProductForm}
          onOpenChange={(v) => {
            setShowProductForm(v);
            if (!v) load();
          }}
          initial={productInitial}
          onCreated={async (masterId) => {
            // Marca itens como vinculados
            await supabase
              .from("purchase_invoices")
              .update({ status: "products_created" })
              .eq("id", invoiceId);
            toast.success("NF marcada como 'Produtos Criados'.");
          }}
        />
      )}
    </>
  );
}
