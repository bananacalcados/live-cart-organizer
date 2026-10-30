import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, FileDown, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import {
  assembleSintegra, downloadSintegra, fiscalMonthBounds, type SintegraInput, type SintegraNote,
  type SintegraItem, type SintegraNfceDay, type SintegraProduct, type SintegraCompany,
} from "@/lib/fiscal/sintegra";
import { parseSaleXml } from "@/lib/fiscal/parseSaleXml";

interface CompanyRow {
  id: string; legal_name: string; cnpj: string; ie: string | null; ie_isento: boolean | null;
  address_street: string | null; address_number: string | null; address_complement: string | null;
  address_neighborhood: string | null; address_cep: string | null; address_city: string | null;
  address_state: string | null; phone: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: CompanyRow[];
  defaultCompanyId?: string;
  defaultMonth?: Date;
}

export function SintegraExportDialog({ open, onOpenChange, companies, defaultCompanyId, defaultMonth }: Props) {
  const [companyId, setCompanyId] = useState<string>(defaultCompanyId || companies[0]?.id || "");
  const [monthStr, setMonthStr] = useState<string>(format(defaultMonth || new Date(), "yyyy-MM"));
  const [natureza, setNatureza] = useState<"1" | "2" | "3">("3");
  const [finalidade, setFinalidade] = useState<"1" | "2" | "3">("1");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ stats: Record<string, number>; warnings: string[] } | null>(null);

  const company = useMemo(() => companies.find((c) => c.id === companyId), [companies, companyId]);

  // Campos editáveis da empresa (pré-preenchidos)
  const [form, setForm] = useState<Partial<CompanyRow>>({});
  useEffect(() => {
    if (company) {
      setForm({ ...company });
      setContactPhone(company.phone || "");
    }
  }, [company]);

  const setF = (k: keyof CompanyRow, v: string) => setForm((p) => ({ ...p, [k]: v }));

  // Mesmo período do pacote do contador (mês fechado em Brasília).
  const periodBounds = useMemo(() => fiscalMonthBounds(monthStr), [monthStr]);

  const generate = async () => {
    if (!company) { toast.error("Selecione a empresa"); return; }
    setGenerating(true);
    setResult(null);
    try {
      const { startIso, endIso } = periodBounds;
      const warnings: string[] = [];

      // 1) Saídas NF-e (modelo 55) autorizadas
      const { data: docs55 } = await supabase
        .from("fiscal_documents")
        .select("id, modelo, serie, numero, valor_total, cpf_destinatario, data_autorizacao, chave_acesso, xml_content, status")
        .eq("company_id", company.id)
        .eq("modelo", 55)
        .in("status", ["authorized", "autorizada", "autorizado"])
        .gte("data_autorizacao", startIso)
        .lte("data_autorizacao", endIso)
        .order("data_autorizacao", { ascending: true })
        .order("id", { ascending: true }); // mesma ordem do pacote do contador

      // 2) Saídas NFC-e (modelo 65) — resumo diário para registro 60
      const { data: docs65 } = await supabase
        .from("fiscal_documents")
        .select("serie, numero, valor_total, data_autorizacao, status")
        .eq("company_id", company.id)
        .eq("modelo", 65)
        .in("status", ["authorized", "autorizada", "autorizado"])
        .gte("data_autorizacao", startIso)
        .lte("data_autorizacao", endIso)
        .order("data_autorizacao", { ascending: true });

      // 3) Entradas (purchase_invoices + itens) — registro 50/54 com emitente T
      const { data: entradas } = await supabase
        .from("purchase_invoices")
        .select("id, invoice_number, invoice_series, supplier_cnpj, supplier_ie, emission_date, total_value")
        .gte("emission_date", startIso)
        .lte("emission_date", endIso)
        .order("emission_date", { ascending: true });

      const entradaIds = (entradas || []).map((e) => e.id);
      let entradaItems: any[] = [];
      if (entradaIds.length) {
        const { data: items } = await supabase
          .from("purchase_invoice_items")
          .select("invoice_id, line_number, supplier_product_code, description, ncm, cfop, unit, quantity, unit_cost, total_cost")
          .in("invoice_id", entradaIds);
        entradaItems = items || [];
      }
      const companyInput: SintegraCompany = {
        cnpj: form.cnpj || company.cnpj,
        ie: form.ie || company.ie || "",
        ie_isento: !!company.ie_isento,
        legal_name: form.legal_name || company.legal_name,
        city: form.address_city || company.address_city || "",
        uf: form.address_state || company.address_state || "",
        street: form.address_street || company.address_street || "",
        number: form.address_number || company.address_number || "",
        complement: form.address_complement || company.address_complement || "",
        neighborhood: form.address_neighborhood || company.address_neighborhood || "",
        cep: form.address_cep || company.address_cep || "",
        contact_name: contactName,
        contact_phone: contactPhone,
      };

      const res = assembleSintegra({
        company: companyInput, periodStart: periodBounds.start, periodEnd: periodBounds.end,
        natureza, finalidade, docs55: docs55 || [], docs65: docs65 || [],
        entradas: entradas || [], entradaItems, parseXml: parseSaleXml,
      });
      res.warnings.unshift(...warnings);

      if (!res.noteCount && !res.nfceDayCount) {
        toast.error("Nenhuma nota encontrada no período para esta empresa.");
        setGenerating(false);
        return;
      }

      const fname = `SINTEGRA_${(companyInput.cnpj || "").replace(/\D/g, "")}_${monthStr.replace("-", "")}`;
      downloadSintegra(res.content, fname);
      setResult({ stats: res.stats, warnings: res.warnings });
      toast.success("Arquivo Sintegra gerado.");
    } catch (err: any) {
      console.error("[sintegra]", err);
      toast.error(err.message || "Erro ao gerar Sintegra");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerar arquivo Sintegra</DialogTitle>
          <DialogDescription>
            Padrão nacional (Convênio ICMS 57/95). Valide o arquivo no validador da SEFAZ e com sua contabilidade antes de entregar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Empresa (CNPJ)</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.legal_name} — {c.cnpj}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Mês de referência</Label>
            <Input type="month" value={monthStr} onChange={(e) => setMonthStr(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Natureza das operações</Label>
            <Select value={natureza} onValueChange={(v) => setNatureza(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Somente entradas</SelectItem>
                <SelectItem value="2">Somente saídas</SelectItem>
                <SelectItem value="3">Entradas e saídas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Finalidade do arquivo</Label>
            <Select value={finalidade} onValueChange={(v) => setFinalidade(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Normal</SelectItem>
                <SelectItem value="2">Retificação total</SelectItem>
                <SelectItem value="3">Retificação aditiva</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-2 border-t pt-3">
          <p className="text-xs font-bold uppercase text-muted-foreground mb-2">Dados da empresa (confira)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Razão social</Label><Input value={form.legal_name || ""} onChange={(e) => setF("legal_name", e.target.value)} /></div>
            <div className="space-y-1"><Label>Inscrição Estadual</Label><Input value={form.ie || ""} onChange={(e) => setF("ie", e.target.value)} /></div>
            <div className="space-y-1"><Label>Logradouro</Label><Input value={form.address_street || ""} onChange={(e) => setF("address_street", e.target.value)} /></div>
            <div className="space-y-1"><Label>Número</Label><Input value={form.address_number || ""} onChange={(e) => setF("address_number", e.target.value)} /></div>
            <div className="space-y-1"><Label>Bairro</Label><Input value={form.address_neighborhood || ""} onChange={(e) => setF("address_neighborhood", e.target.value)} /></div>
            <div className="space-y-1"><Label>CEP</Label><Input value={form.address_cep || ""} onChange={(e) => setF("address_cep", e.target.value)} /></div>
            <div className="space-y-1"><Label>Município</Label><Input value={form.address_city || ""} onChange={(e) => setF("address_city", e.target.value)} /></div>
            <div className="space-y-1"><Label>UF</Label><Input maxLength={2} value={form.address_state || ""} onChange={(e) => setF("address_state", e.target.value)} /></div>
            <div className="space-y-1"><Label>Responsável (contato)</Label><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
            <div className="space-y-1"><Label>Telefone do responsável</Label><Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /></div>
          </div>
        </div>

        {result && (
          <div className="mt-2 rounded-md border bg-muted/40 p-3 text-xs space-y-1">
            <p className="font-bold">Conferência</p>
            <p>Total de registros: {result.stats.total_registros}</p>
            <p>Registros 50 (NF-e): {result.stats.registros_50} · 54 (itens): {result.stats.registros_54} · 60 (NFC-e): {result.stats.registros_60} · 75 (produtos): {result.stats.registros_75}</p>
            {result.warnings.length > 0 && (
              <div className="mt-1 text-amber-700 space-y-0.5">
                {result.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{w}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button onClick={generate} disabled={generating} className="gap-2">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Gerar Sintegra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
