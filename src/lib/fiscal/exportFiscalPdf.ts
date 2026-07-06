// Gerador de relatórios fiscais em PDF (jsPDF puro, sem dependência de autotable).
// Layout claro para impressão, com cabeçalho, KPIs, tabelas agrupadas e detalhamento.

import jsPDF from "jspdf";

export interface FiscalSaleDoc {
  modelo: number;
  serie: number | null;
  numero: number | null;
  valor_total: number | null;
  nome_destinatario: string | null;
  cpf_destinatario: string | null;
  chave_acesso: string | null;
  data_autorizacao: string | null;
  companyName: string;
  companyCnpj: string;
}

export interface FiscalEntrada {
  invoice_number: string | null;
  invoice_series: string | null;
  nfe_key: string | null;
  supplier_name: string | null;
  supplier_cnpj: string | null;
  emission_date: string | null;
  total_value: number | null;
  total_products: number | null;
  total_taxes: number | null;
}

export interface FiscalPdfInput {
  periodLabel: string;
  companyFilterLabel: string; // "Todas as empresas" ou "Empresa — CNPJ"
  sales: FiscalSaleDoc[];
  entradas: FiscalEntrada[];
}

const BRL = (n: number) =>
  (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function dateBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

// Paleta (RGB)
const ORANGE: [number, number, number] = [234, 88, 12];
const DARK: [number, number, number] = [24, 24, 27];
const GRAY: [number, number, number] = [113, 113, 122];
const LIGHT: [number, number, number] = [244, 244, 245];
const BORDER: [number, number, number] = [212, 212, 216];

export function generateFiscalPdf(input: FiscalPdfInput): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - margin - 20) {
      addFooter();
      doc.addPage();
      y = margin;
    }
  };

  let pageCount = 1;
  const addFooter = () => {
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.setFont("helvetica", "normal");
    const stamp = new Date().toLocaleString("pt-BR");
    doc.text(`Gerado em ${stamp}`, margin, pageH - margin + 10);
    doc.text(`Página ${pageCount}`, pageW - margin, pageH - margin + 10, { align: "right" });
  };

  // ---------- Cabeçalho ----------
  doc.setFillColor(...ORANGE);
  doc.rect(0, 0, pageW, 6, "F");
  doc.setFontSize(18);
  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "bold");
  doc.text("Relatório Fiscal", margin, y + 14);
  doc.setFontSize(10);
  doc.setTextColor(...GRAY);
  doc.setFont("helvetica", "normal");
  y += 32;
  doc.text(`Período: ${input.periodLabel}`, margin, y);
  y += 14;
  doc.text(`Filtro: ${input.companyFilterLabel}`, margin, y);
  y += 20;

  // ---------- Totais ----------
  const totalNfe = input.sales.filter((s) => s.modelo === 55).reduce((a, s) => a + (Number(s.valor_total) || 0), 0);
  const totalNfce = input.sales.filter((s) => s.modelo === 65).reduce((a, s) => a + (Number(s.valor_total) || 0), 0);
  const qtdNfe = input.sales.filter((s) => s.modelo === 55).length;
  const qtdNfce = input.sales.filter((s) => s.modelo === 65).length;
  const totalEntradas = input.entradas.reduce((a, e) => a + (Number(e.total_value) || 0), 0);

  const kpis = [
    { label: "Vendas NF-e (mod. 55)", value: BRL(totalNfe), sub: `${qtdNfe} notas` },
    { label: "Vendas NFC-e (mod. 65)", value: BRL(totalNfce), sub: `${qtdNfce} notas` },
    { label: "Total de saídas", value: BRL(totalNfe + totalNfce), sub: `${input.sales.length} notas` },
    { label: "Total de entradas", value: BRL(totalEntradas), sub: `${input.entradas.length} notas` },
  ];
  const kpiGap = 8;
  const kpiW = (contentW - kpiGap * (kpis.length - 1)) / kpis.length;
  const kpiH = 46;
  ensureSpace(kpiH);
  kpis.forEach((k, i) => {
    const x = margin + i * (kpiW + kpiGap);
    doc.setFillColor(...LIGHT);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(x, y, kpiW, kpiH, 4, 4, "FD");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.setFont("helvetica", "normal");
    doc.text(k.label, x + 8, y + 14, { maxWidth: kpiW - 16 });
    doc.setFontSize(12);
    doc.setTextColor(...DARK);
    doc.setFont("helvetica", "bold");
    doc.text(k.value, x + 8, y + 30, { maxWidth: kpiW - 16 });
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.setFont("helvetica", "normal");
    doc.text(k.sub, x + 8, y + 41);
  });
  y += kpiH + 24;

  // ---------- Helper de tabela ----------
  interface Col { title: string; width: number; align?: "left" | "right"; }
  const drawTable = (
    title: string,
    cols: Col[],
    rows: string[][],
    totalRow?: string[],
  ) => {
    ensureSpace(48);
    doc.setFontSize(12);
    doc.setTextColor(...DARK);
    doc.setFont("helvetica", "bold");
    doc.text(title, margin, y);
    y += 12;

    const rowH = 18;
    const headerH = 20;
    // Cabeçalho
    const drawHeader = () => {
      doc.setFillColor(...DARK);
      doc.rect(margin, y, contentW, headerH, "F");
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      let cx = margin;
      cols.forEach((c) => {
        const tx = c.align === "right" ? cx + c.width - 6 : cx + 6;
        doc.text(c.title, tx, y + 13, { align: c.align === "right" ? "right" : "left" });
        cx += c.width;
      });
      y += headerH;
    };
    drawHeader();

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    rows.forEach((r, idx) => {
      if (y + rowH > pageH - margin - 20) {
        addFooter();
        doc.addPage();
        pageCount++;
        y = margin;
        drawHeader();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
      }
      if (idx % 2 === 1) {
        doc.setFillColor(...LIGHT);
        doc.rect(margin, y, contentW, rowH, "F");
      }
      let cx = margin;
      doc.setTextColor(...DARK);
      cols.forEach((c, ci) => {
        const tx = c.align === "right" ? cx + c.width - 6 : cx + 6;
        const txt = doc.splitTextToSize(r[ci] ?? "", c.width - 12)[0] || "";
        doc.text(String(txt), tx, y + 12, { align: c.align === "right" ? "right" : "left" });
        cx += c.width;
      });
      y += rowH;
    });

    if (totalRow) {
      if (y + rowH > pageH - margin - 20) {
        addFooter();
        doc.addPage();
        pageCount++;
        y = margin;
      }
      doc.setFillColor(...ORANGE);
      doc.rect(margin, y, contentW, rowH, "F");
      let cx = margin;
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      cols.forEach((c, ci) => {
        const tx = c.align === "right" ? cx + c.width - 6 : cx + 6;
        doc.text(String(totalRow[ci] ?? ""), tx, y + 12, { align: c.align === "right" ? "right" : "left" });
        cx += c.width;
      });
      y += rowH;
      doc.setFont("helvetica", "normal");
    }

    // Borda externa
    doc.setDrawColor(...BORDER);
    y += 18;
  };

  // ---------- Resumo Saídas por empresa ----------
  const salesByCompany = new Map<string, { name: string; cnpj: string; nfeQ: number; nfeV: number; nfceQ: number; nfceV: number }>();
  for (const s of input.sales) {
    const key = s.companyCnpj + "|" + s.companyName;
    const cur = salesByCompany.get(key) || { name: s.companyName, cnpj: s.companyCnpj, nfeQ: 0, nfeV: 0, nfceQ: 0, nfceV: 0 };
    if (s.modelo === 65) { cur.nfceQ++; cur.nfceV += Number(s.valor_total) || 0; }
    else { cur.nfeQ++; cur.nfeV += Number(s.valor_total) || 0; }
    salesByCompany.set(key, cur);
  }
  const salesCols: Col[] = [
    { title: "Empresa / CNPJ", width: contentW * 0.34 },
    { title: "NF-e qtd", width: contentW * 0.1, align: "right" },
    { title: "NF-e valor", width: contentW * 0.16, align: "right" },
    { title: "NFC-e qtd", width: contentW * 0.1, align: "right" },
    { title: "NFC-e valor", width: contentW * 0.15, align: "right" },
    { title: "Total", width: contentW * 0.15, align: "right" },
  ];
  const salesRows = Array.from(salesByCompany.values()).map((r) => [
    `${r.name}  (${r.cnpj})`,
    String(r.nfeQ),
    BRL(r.nfeV),
    String(r.nfceQ),
    BRL(r.nfceV),
    BRL(r.nfeV + r.nfceV),
  ]);
  drawTable(
    "Saídas (vendas) por CNPJ",
    salesCols,
    salesRows.length ? salesRows : [["Nenhuma venda no período.", "", "", "", "", ""]],
    salesRows.length ? ["TOTAL", String(qtdNfe), BRL(totalNfe), String(qtdNfce), BRL(totalNfce), BRL(totalNfe + totalNfce)] : undefined,
  );

  // ---------- Resumo Entradas por fornecedor ----------
  const entBySup = new Map<string, { name: string; cnpj: string; q: number; prod: number; tax: number; val: number }>();
  for (const e of input.entradas) {
    const key = e.supplier_cnpj || "—";
    const cur = entBySup.get(key) || { name: e.supplier_name || "—", cnpj: key, q: 0, prod: 0, tax: 0, val: 0 };
    cur.q++;
    cur.prod += Number(e.total_products) || 0;
    cur.tax += Number(e.total_taxes) || 0;
    cur.val += Number(e.total_value) || 0;
    entBySup.set(key, cur);
  }
  const entCols: Col[] = [
    { title: "Fornecedor / CNPJ", width: contentW * 0.4 },
    { title: "Notas", width: contentW * 0.12, align: "right" },
    { title: "Produtos", width: contentW * 0.16, align: "right" },
    { title: "Impostos", width: contentW * 0.16, align: "right" },
    { title: "Total", width: contentW * 0.16, align: "right" },
  ];
  const entRows = Array.from(entBySup.values()).sort((a, b) => b.val - a.val).map((r) => [
    `${r.name}  (${r.cnpj})`,
    String(r.q),
    BRL(r.prod),
    BRL(r.tax),
    BRL(r.val),
  ]);
  const totalProd = input.entradas.reduce((a, e) => a + (Number(e.total_products) || 0), 0);
  const totalTax = input.entradas.reduce((a, e) => a + (Number(e.total_taxes) || 0), 0);
  drawTable(
    "Entradas por CNPJ (fornecedor)",
    entCols,
    entRows.length ? entRows : [["Nenhuma nota de entrada no período.", "", "", "", ""]],
    entRows.length ? ["TOTAL", String(input.entradas.length), BRL(totalProd), BRL(totalTax), BRL(totalEntradas)] : undefined,
  );

  // ---------- Detalhamento das saídas ----------
  if (input.sales.length) {
    const detCols: Col[] = [
      { title: "Data", width: contentW * 0.1 },
      { title: "Tipo", width: contentW * 0.08 },
      { title: "Série/Nº", width: contentW * 0.1 },
      { title: "Destinatário", width: contentW * 0.24 },
      { title: "Chave de acesso", width: contentW * 0.36 },
      { title: "Valor", width: contentW * 0.12, align: "right" },
    ];
    const detRows = input.sales.map((s) => [
      dateBR(s.data_autorizacao),
      s.modelo === 65 ? "NFC-e" : "NF-e",
      `${s.serie ?? ""}/${s.numero ?? ""}`,
      s.nome_destinatario || "Consumidor",
      s.chave_acesso || "",
      BRL(Number(s.valor_total) || 0),
    ]);
    drawTable("Detalhamento das saídas", detCols, detRows,
      ["", "", "", "", "TOTAL", BRL(totalNfe + totalNfce)]);
  }

  // ---------- Detalhamento das entradas ----------
  if (input.entradas.length) {
    const detCols: Col[] = [
      { title: "Data", width: contentW * 0.1 },
      { title: "Série/Nº", width: contentW * 0.1 },
      { title: "Fornecedor", width: contentW * 0.28 },
      { title: "Chave de acesso", width: contentW * 0.4 },
      { title: "Total", width: contentW * 0.12, align: "right" },
    ];
    const detRows = input.entradas.map((e) => [
      dateBR(e.emission_date),
      `${e.invoice_series ?? ""}/${e.invoice_number ?? ""}`,
      e.supplier_name || "—",
      e.nfe_key || "",
      BRL(Number(e.total_value) || 0),
    ]);
    drawTable("Detalhamento das entradas", detCols, detRows,
      ["", "", "", "TOTAL", BRL(totalEntradas)]);
  }

  addFooter();

  const safeLabel = input.periodLabel.replace(/[^\w-]+/g, "_");
  doc.save(`relatorio_fiscal_${safeLabel}.pdf`);
}
