import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Lock, Loader2, Download, FileText, RefreshCw, ArrowDownToLine, ArrowUpFromLine, FileArchive } from "lucide-react";
import { format } from "date-fns";
import { downloadCsv, brlCell, dateCell } from "@/lib/fiscal/exportFiscalReport";
import { generateFiscalPdf } from "@/lib/fiscal/exportFiscalPdf";
import { exportFiscalXmlZip } from "@/lib/fiscal/exportFiscalXml";
import { SintegraExportDialog } from "@/components/fiscal/SintegraExportDialog";

const FISCAL_PASSWORD = "joey102030";

interface Props {
  periodRange: { start: Date; end: Date; label: string };
}

interface CompanyRow {
  id: string; legal_name: string; cnpj: string; ie: string | null; ie_isento: boolean | null;
  address_street: string | null; address_number: string | null; address_complement: string | null;
  address_neighborhood: string | null; address_cep: string | null; address_city: string | null;
  address_state: string | null; phone: string | null;
}

interface SaleDoc {
  id: string; company_id: string; modelo: number; serie: number | null; numero: number | null;
  valor_total: number | null; nome_destinatario: string | null; cpf_destinatario: string | null;
  chave_acesso: string | null; data_autorizacao: string | null; status: string;
}
interface Entrada {
  id: string; invoice_number: string | null; invoice_series: string | null; nfe_key: string | null;
  supplier_name: string | null; supplier_cnpj: string | null; emission_date: string | null;
  total_value: number | null; total_products: number | null; total_taxes: number | null;
}

const BRL = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function POSFiscalTab({ periodRange }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [companyId, setCompanyId] = useState<string>("all");
  const [sales, setSales] = useState<SaleDoc[]>([]);
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [sintegraOpen, setSintegraOpen] = useState(false);

  const startIso = periodRange.start.toISOString();
  const endIso = useMemo(() => new Date(periodRange.end.getTime() + 86399999).toISOString(), [periodRange.end]);

  const load = async () => {
    if (!unlocked) return;
    setLoading(true);
    try {
      const { data: comps } = await supabase
        .from("companies")
        .select("id, legal_name, cnpj, ie, ie_isento, address_street, address_number, address_complement, address_neighborhood, address_cep, address_city, address_state, phone")
        .order("legal_name");
      setCompanies((comps as any) || []);

      let salesQ = supabase
        .from("fiscal_documents")
        .select("id, company_id, modelo, serie, numero, valor_total, nome_destinatario, cpf_destinatario, chave_acesso, data_autorizacao, status")
        .in("status", ["authorized", "autorizada", "autorizado"])
        .gte("data_autorizacao", startIso)
        .lte("data_autorizacao", endIso)
        .order("data_autorizacao", { ascending: false });
      if (companyId !== "all") salesQ = salesQ.eq("company_id", companyId);
      const { data: salesData } = await salesQ;
      setSales((salesData as any) || []);

      const { data: entData } = await supabase
        .from("purchase_invoices")
        .select("id, invoice_number, invoice_series, nfe_key, supplier_name, supplier_cnpj, emission_date, total_value, total_products, total_taxes")
        .gte("emission_date", startIso)
        .lte("emission_date", endIso)
        .order("emission_date", { ascending: false });
      setEntradas((entData as any) || []);
    } catch (err: any) {
      toast.error(err.message || "Erro ao carregar dados fiscais");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [unlocked, companyId, startIso, endIso]);

  const cnpjById = useMemo(() => {
    const m = new Map<string, string>();
    companies.forEach((c) => m.set(c.id, c.cnpj));
    return m;
  }, [companies]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    companies.forEach((c) => m.set(c.id, c.legal_name));
    return m;
  }, [companies]);

  // Agrupamento das SAÍDAS por CNPJ da empresa + modelo
  const salesSummary = useMemo(() => {
    const map = new Map<string, { cnpj: string; name: string; nfe: { qtd: number; val: number }; nfce: { qtd: number; val: number } }>();
    for (const s of sales) {
      const cnpj = cnpjById.get(s.company_id) || "—";
      const key = s.company_id;
      const cur = map.get(key) || { cnpj, name: nameById.get(s.company_id) || "—", nfe: { qtd: 0, val: 0 }, nfce: { qtd: 0, val: 0 } };
      const bucket = s.modelo === 65 ? cur.nfce : cur.nfe;
      bucket.qtd += 1;
      bucket.val += Number(s.valor_total) || 0;
      map.set(key, cur);
    }
    return Array.from(map.values());
  }, [sales, cnpjById, nameById]);

  // Agrupamento das ENTRADAS por CNPJ do fornecedor
  const entradasSummary = useMemo(() => {
    const map = new Map<string, { cnpj: string; name: string; qtd: number; val: number; prod: number; tax: number }>();
    for (const e of entradas) {
      const key = e.supplier_cnpj || "—";
      const cur = map.get(key) || { cnpj: key, name: e.supplier_name || "—", qtd: 0, val: 0, prod: 0, tax: 0 };
      cur.qtd += 1;
      cur.val += Number(e.total_value) || 0;
      cur.prod += Number(e.total_products) || 0;
      cur.tax += Number(e.total_taxes) || 0;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.val - a.val);
  }, [entradas]);

  const totalNfe = sales.filter((s) => s.modelo === 55).reduce((a, s) => a + (Number(s.valor_total) || 0), 0);
  const totalNfce = sales.filter((s) => s.modelo === 65).reduce((a, s) => a + (Number(s.valor_total) || 0), 0);
  const totalEntradas = entradas.reduce((a, e) => a + (Number(e.total_value) || 0), 0);

  const exportSalesCsv = () => {
    const rows = sales.map((s) => [
      dateCell(s.data_autorizacao), s.modelo === 65 ? "NFC-e" : "NF-e",
      cnpjById.get(s.company_id) || "", nameById.get(s.company_id) || "",
      `${s.serie ?? ""}/${s.numero ?? ""}`, s.chave_acesso || "",
      s.nome_destinatario || "", s.cpf_destinatario || "", brlCell(Number(s.valor_total) || 0),
    ]);
    downloadCsv(`vendas_fiscais_${format(periodRange.start, "yyyyMMdd")}_${format(periodRange.end, "yyyyMMdd")}`,
      ["Data", "Modelo", "CNPJ empresa", "Empresa", "Série/Número", "Chave", "Destinatário", "CPF/CNPJ", "Valor"], rows);
  };

  const exportEntradasCsv = () => {
    const rows = entradas.map((e) => [
      dateCell(e.emission_date), e.supplier_cnpj || "", e.supplier_name || "",
      `${e.invoice_series ?? ""}/${e.invoice_number ?? ""}`, e.nfe_key || "",
      brlCell(Number(e.total_products) || 0), brlCell(Number(e.total_taxes) || 0), brlCell(Number(e.total_value) || 0),
    ]);
    downloadCsv(`entradas_fiscais_${format(periodRange.start, "yyyyMMdd")}_${format(periodRange.end, "yyyyMMdd")}`,
      ["Data", "CNPJ fornecedor", "Fornecedor", "Série/Número", "Chave", "Produtos", "Impostos", "Total"], rows);
  };

  const exportPdf = () => {
    if (!sales.length && !entradas.length) {
      toast.error("Não há dados no período para gerar o PDF.");
      return;
    }
    const companyFilterLabel = companyId === "all"
      ? "Todas as empresas"
      : `${nameById.get(companyId) || "—"} — ${cnpjById.get(companyId) || ""}`;
    generateFiscalPdf({
      periodLabel: periodRange.label,
      companyFilterLabel,
      sales: sales.map((s) => ({
        modelo: s.modelo, serie: s.serie, numero: s.numero, valor_total: s.valor_total,
        nome_destinatario: s.nome_destinatario, cpf_destinatario: s.cpf_destinatario,
        chave_acesso: s.chave_acesso, data_autorizacao: s.data_autorizacao,
        companyName: nameById.get(s.company_id) || "—", companyCnpj: cnpjById.get(s.company_id) || "—",
      })),
      entradas: entradas.map((e) => ({
        invoice_number: e.invoice_number, invoice_series: e.invoice_series, nfe_key: e.nfe_key,
        supplier_name: e.supplier_name, supplier_cnpj: e.supplier_cnpj, emission_date: e.emission_date,
        total_value: e.total_value, total_products: e.total_products, total_taxes: e.total_taxes,
      })),
    });
    toast.success("Relatório PDF gerado.");
  };

  // ---- Gate ----
  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="p-4 rounded-2xl bg-zinc-800 border border-zinc-700">
          <Lock className="h-8 w-8 text-orange-400" />
        </div>
        <h3 className="text-lg font-bold text-zinc-100">Fiscal protegido</h3>
        <p className="text-sm text-zinc-400">Digite a senha para acessar os relatórios fiscais</p>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw === FISCAL_PASSWORD) { setUnlocked(true); setPw(""); }
            else toast.error("Senha incorreta");
          }}
        >
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Senha" autoFocus
            className="w-56 bg-zinc-800 border-zinc-700 text-zinc-100" />
          <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white">Entrar</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5 text-zinc-100">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="w-64 bg-zinc-800 border-zinc-700 text-zinc-100">
            <SelectValue placeholder="Empresa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as empresas</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.legal_name} — {c.cnpj}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-zinc-400">Período: {periodRange.label}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}
            className="gap-2 bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button size="sm" onClick={exportPdf} disabled={loading || (!sales.length && !entradas.length)}
            className="gap-2 bg-red-600 hover:bg-red-700 text-white">
            <FileText className="h-3.5 w-3.5" /> Relatório PDF
          </Button>
          <Button size="sm" onClick={() => setSintegraOpen(true)} className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
            <FileText className="h-3.5 w-3.5" /> Gerar Sintegra
          </Button>

        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Vendas NF-e (mod. 55)" value={BRL(totalNfe)} sub={`${sales.filter(s => s.modelo === 55).length} notas`} accent="text-emerald-400" />
            <Kpi label="Vendas NFC-e (mod. 65)" value={BRL(totalNfce)} sub={`${sales.filter(s => s.modelo === 65).length} notas`} accent="text-blue-400" />
            <Kpi label="Total de saídas" value={BRL(totalNfe + totalNfce)} sub={`${sales.length} notas`} accent="text-orange-400" />
            <Kpi label="Total de entradas" value={BRL(totalEntradas)} sub={`${entradas.length} notas`} accent="text-fuchsia-400" />
          </div>

          {/* SAÍDAS */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60">
            <header className="flex items-center justify-between p-3 border-b border-zinc-800">
              <h3 className="flex items-center gap-2 font-bold text-sm"><ArrowUpFromLine className="h-4 w-4 text-emerald-400" /> Saídas (vendas) por CNPJ</h3>
              <Button size="sm" variant="outline" onClick={exportSalesCsv} disabled={!sales.length}
                className="gap-2 bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700">
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-zinc-400 text-xs">
                  <tr className="border-b border-zinc-800">
                    <th className="text-left p-2">Empresa / CNPJ</th>
                    <th className="text-right p-2">NF-e (qtd)</th>
                    <th className="text-right p-2">NF-e (valor)</th>
                    <th className="text-right p-2">NFC-e (qtd)</th>
                    <th className="text-right p-2">NFC-e (valor)</th>
                    <th className="text-right p-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {salesSummary.map((r) => (
                    <tr key={r.cnpj + r.name} className="border-b border-zinc-800/60">
                      <td className="p-2"><div className="font-medium">{r.name}</div><div className="text-xs text-zinc-500 font-mono">{r.cnpj}</div></td>
                      <td className="text-right p-2">{r.nfe.qtd}</td>
                      <td className="text-right p-2">{BRL(r.nfe.val)}</td>
                      <td className="text-right p-2">{r.nfce.qtd}</td>
                      <td className="text-right p-2">{BRL(r.nfce.val)}</td>
                      <td className="text-right p-2 font-bold">{BRL(r.nfe.val + r.nfce.val)}</td>
                    </tr>
                  ))}
                  {!salesSummary.length && <tr><td colSpan={6} className="text-center text-zinc-500 py-8">Nenhuma venda no período.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {/* ENTRADAS */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60">
            <header className="flex items-center justify-between p-3 border-b border-zinc-800">
              <h3 className="flex items-center gap-2 font-bold text-sm"><ArrowDownToLine className="h-4 w-4 text-fuchsia-400" /> Entradas por CNPJ (fornecedor)</h3>
              <Button size="sm" variant="outline" onClick={exportEntradasCsv} disabled={!entradas.length}
                className="gap-2 bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700">
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-zinc-400 text-xs">
                  <tr className="border-b border-zinc-800">
                    <th className="text-left p-2">Fornecedor / CNPJ</th>
                    <th className="text-right p-2">Notas</th>
                    <th className="text-right p-2">Produtos</th>
                    <th className="text-right p-2">Impostos</th>
                    <th className="text-right p-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {entradasSummary.map((r) => (
                    <tr key={r.cnpj + r.name} className="border-b border-zinc-800/60">
                      <td className="p-2"><div className="font-medium">{r.name}</div><div className="text-xs text-zinc-500 font-mono">{r.cnpj}</div></td>
                      <td className="text-right p-2">{r.qtd}</td>
                      <td className="text-right p-2">{BRL(r.prod)}</td>
                      <td className="text-right p-2">{BRL(r.tax)}</td>
                      <td className="text-right p-2 font-bold">{BRL(r.val)}</td>
                    </tr>
                  ))}
                  {!entradasSummary.length && <tr><td colSpan={5} className="text-center text-zinc-500 py-8">Nenhuma nota de entrada no período. As entradas vêm do módulo Estoque (importação de NF-e).</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-[11px] text-zinc-500">
            Notas de prestadores de serviço (NFS-e) não são capturadas automaticamente pelo módulo de Estoque e por isso não aparecem nas entradas.
          </p>
        </>
      )}

      <SintegraExportDialog
        open={sintegraOpen}
        onOpenChange={setSintegraOpen}
        companies={companies}
        defaultCompanyId={companyId !== "all" ? companyId : undefined}
        defaultMonth={periodRange.start}
      />
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className={`text-lg font-bold ${accent || "text-zinc-100"}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}
