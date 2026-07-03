// Comprovante de Condicional (impressão) — no padrão de providerReceipt.ts.
// Gera um HTML imprimível com a lista de produtos, preços, dados do cliente e
// dois campos de assinatura: conferência da vendedora e recebimento da cliente.

export interface ConditionalReceiptItem {
  name: string;
  variant?: string;
  size?: string;
  sku?: string;
  quantity: number;
  price: number;
}

export interface ConditionalReceiptCustomer {
  name?: string;
  cpf?: string;
  whatsapp?: string;
  email?: string;
  cep?: string;
  address?: string;
  address_number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export interface ConditionalReceiptData {
  storeName?: string;
  sellerName?: string;
  saleId?: string;
  items: ConditionalReceiptItem[];
  customer: ConditionalReceiptCustomer;
}

function brl(v: number) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function esc(s?: string) {
  return String(s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string),
  );
}

export function printConditionalReceipt({
  storeName,
  sellerName,
  saleId,
  items,
  customer,
}: ConditionalReceiptData) {
  const dt = new Date();
  const total = items.reduce((acc, i) => acc + Number(i.price || 0) * Number(i.quantity || 0), 0);

  const rows = items
    .map(
      (i) => `
      <tr>
        <td>${esc(i.name)}${i.variant ? ` · ${esc(i.variant)}` : ""}${i.size ? ` · ${esc(i.size)}` : ""}</td>
        <td style="text-align:center">${Number(i.quantity || 0)}</td>
        <td style="text-align:right">${brl(Number(i.price || 0))}</td>
        <td style="text-align:right">${brl(Number(i.price || 0) * Number(i.quantity || 0))}</td>
      </tr>`,
    )
    .join("");

  const addrLine = [
    customer.address,
    customer.address_number ? `nº ${customer.address_number}` : "",
    customer.complement,
    customer.neighborhood,
    [customer.city, customer.state].filter(Boolean).join("/"),
    customer.cep ? `CEP ${customer.cep}` : "",
  ]
    .filter(Boolean)
    .map(esc)
    .join(" · ");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Condicional - ${esc(customer.name) || "Cliente"}</title>
<style>
  * { font-family: Arial, Helvetica, sans-serif; box-sizing: border-box; }
  body { margin: 0; padding: 32px; color: #111; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 3px solid #22c55e; padding-bottom: 12px; margin-bottom: 16px; }
  .brand { font-size: 22px; font-weight: 800; color:#16a34a; }
  .sub { font-size: 12px; color:#555; }
  .tag { display:inline-block; background:#dcfce7; color:#166534; font-weight:700; font-size:12px; padding:3px 10px; border-radius:999px; margin-top:6px; }
  h1 { font-size: 18px; margin: 8px 0 4px; }
  .meta { font-size: 13px; color:#333; margin-bottom: 16px; line-height: 1.6; }
  table { width:100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
  th { background:#f3f3f3; text-align:left; padding:8px; border-bottom: 2px solid #ddd; }
  td { padding:8px; border-bottom: 1px solid #eee; }
  .total { text-align:right; font-size: 18px; font-weight:800; margin-top: 4px; }
  .decl { font-size: 12px; color:#333; margin: 20px 0 8px; line-height:1.6; }
  .signs { display:flex; gap:40px; margin-top: 64px; }
  .sign { flex:1; border-top: 1px solid #333; text-align:center; padding-top:6px; font-size:12px; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">Banana Calçados</div>
      <div class="sub">Comprovante de Condicional</div>
      <div class="tag">📦 CONDICIONAL — não é comprovante de venda</div>
    </div>
    <div class="sub" style="text-align:right">
      Emitido em<br/>${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      ${storeName ? `<br/>Loja: ${esc(storeName)}` : ""}
      ${sellerName ? `<br/>Vendedora: ${esc(sellerName)}` : ""}
      ${saleId ? `<br/>Ref: ${esc(saleId.slice(0, 8))}` : ""}
    </div>
  </div>

  <h1>Cliente: ${esc(customer.name) || "-"}</h1>
  <div class="meta">
    ${customer.cpf ? `CPF: ${esc(customer.cpf)}<br/>` : ""}
    ${customer.whatsapp ? `Telefone: ${esc(customer.whatsapp)}<br/>` : ""}
    ${customer.email ? `Email: ${esc(customer.email)}<br/>` : ""}
    ${addrLine ? `Endereço: ${addrLine}` : ""}
  </div>

  <table>
    <thead>
      <tr><th>Produto</th><th style="text-align:center">Qtd</th><th style="text-align:right">Unit.</th><th style="text-align:right">Total</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="total">Valor total dos produtos: ${brl(total)}</div>

  <div class="decl">
    Os produtos acima foram enviados em <strong>condicional</strong> para experimentação.
    A cliente deve devolver os que não desejar. Os produtos mantidos serão cobrados na
    finalização do condicional.
  </div>

  <div class="signs">
    <div class="sign">${esc(sellerName) || ""}<br/>Conferência da vendedora</div>
    <div class="sign">${esc(customer.name) || ""}<br/>Assinatura da cliente (no recebimento)</div>
  </div>

  <script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
