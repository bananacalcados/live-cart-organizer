import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, Trash2, Edit, Package } from "lucide-react";
import { toast } from "sonner";
import { parseNfeXml } from "@/lib/nfeXmlParser";
import { NfeDetailEditor } from "./NfeDetailEditor";

interface Invoice {
  id: string;
  nfe_key: string | null;
  invoice_number: string | null;
  supplier_name: string | null;
  emission_date: string | null;
  total_value: number | null;
  status: string;
  created_at: string;
}

export function NfeImporter() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_invoices")
      .select("id, nfe_key, invoice_number, supplier_name, emission_date, total_value, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast.error("Erro ao carregar NFs: " + error.message);
    } else {
      setInvoices((data || []) as any);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const xml = await file.text();
      const parsed = parseNfeXml(xml);

      // Verifica se já existe
      if (parsed.nfe_key) {
        const { data: existing } = await supabase
          .from("purchase_invoices")
          .select("id")
          .eq("nfe_key", parsed.nfe_key)
          .maybeSingle();
        if (existing) {
          toast.error("Esta NF-e já foi importada.");
          setUploading(false);
          return;
        }
      }

      const { data, error } = await supabase
        .from("purchase_invoices")
        .insert({
          nfe_key: parsed.nfe_key,
          invoice_number: parsed.invoice_number,
          invoice_series: parsed.invoice_series,
          supplier_name: parsed.supplier_name,
          supplier_cnpj: parsed.supplier_cnpj,
          supplier_ie: parsed.supplier_ie,
          supplier_address: parsed.supplier_address,
          emission_date: parsed.emission_date,
          total_value: parsed.total_value,
          total_products: parsed.total_products,
          total_taxes: parsed.total_taxes,
          total_freight: parsed.total_freight,
          total_discount: parsed.total_discount,
          payment_method: parsed.payment_method,
          raw_xml: xml,
          parsed_data: parsed as any,
          status: "draft",
        })
        .select()
        .single();
      if (error) throw error;

      // Insere itens
      if (parsed.items.length > 0) {
        const { error: itErr } = await supabase
          .from("purchase_invoice_items")
          .insert(
            parsed.items.map((it, idx) => ({
              invoice_id: data.id,
              line_number: it.line_number ?? idx + 1,
              supplier_product_code: it.supplier_product_code,
              description: it.description,
              ncm: it.ncm,
              cfop: it.cfop,
              unit: it.unit,
              quantity: it.quantity,
              unit_cost: it.unit_cost,
              total_cost: it.total_cost,
              ean: it.ean,
              parsed_color: it.parsed_color,
              parsed_size: it.parsed_size,
            }))
          );
        if (itErr) throw itErr;
      }

      // Insere parcelas
      if (parsed.installments.length > 0) {
        const { error: insErr } = await supabase
          .from("purchase_invoice_installments")
          .insert(
            parsed.installments.map((p) => ({
              invoice_id: data.id,
              installment_number: p.installment_number,
              due_date: p.due_date,
              amount: p.amount,
            }))
          );
        if (insErr) throw insErr;
      }

      toast.success(`NF-e importada: ${parsed.items.length} itens, ${parsed.installments.length} parcelas.`);
      setEditingId(data.id);
      load();
    } catch (err: any) {
      toast.error("Erro ao importar XML: " + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deleteInvoice(id: string) {
    if (!confirm("Tem certeza? A NF e seus itens serão removidos (mas os produtos já criados permanecem).")) return;
    const { error } = await supabase.from("purchase_invoices").delete().eq("id", id);
    if (error) {
      toast.error("Erro: " + error.message);
    } else {
      toast.success("NF removida.");
      load();
    }
  }

  const statusColor = (s: string) => {
    if (s === "draft") return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400";
    if (s === "reviewed") return "bg-blue-500/10 text-blue-700 dark:text-blue-400";
    if (s === "products_created") return "bg-green-500/10 text-green-700 dark:text-green-400";
    if (s === "integrated") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    return "bg-muted text-muted-foreground";
  };
  const statusLabel = (s: string) => ({
    draft: "Rascunho",
    reviewed: "Revisada",
    products_created: "Produtos Criados",
    integrated: "Integrada",
    cancelled: "Cancelada",
  } as any)[s] || s;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-5 w-5" /> Importar NF-e (XML)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <label className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-muted/40 transition">
            {uploading ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Processando XML...</p>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm font-medium">Clique para enviar o XML da NF-e</p>
                <p className="text-xs text-muted-foreground mt-1">Modelo 55, layout 4.00</p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notas Importadas</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              Nenhuma NF importada ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 p-3 rounded border hover:bg-muted/30">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {inv.supplier_name || "Sem fornecedor"}
                      </span>
                      <Badge className={statusColor(inv.status)} variant="outline">
                        {statusLabel(inv.status)}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      NF {inv.invoice_number || "—"} · {inv.emission_date ? new Date(inv.emission_date).toLocaleDateString("pt-BR") : "—"} · R$ {(inv.total_value || 0).toFixed(2)}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(inv.id)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteInvoice(inv.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {editingId && (
        <NfeDetailEditor
          invoiceId={editingId}
          open={!!editingId}
          onOpenChange={(v) => !v && setEditingId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
