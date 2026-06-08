import type { ServiceProvider, DeliveryCost, ProviderPayment } from "./deliveryProviders";
import { sourceLabel, PROVIDER_TYPE_LABEL } from "./deliveryProviders";

interface ReceiptData {
  provider: ServiceProvider;
  payment: ProviderPayment;
  costs: DeliveryCost[];
}

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Builds a consolidated receipt and opens the print dialog. */
export function printProviderReceipt({ provider, payment, costs }: ReceiptData) {
  const dt = new Date(payment.paid_at || Date.now());
  const rows = costs
    .map(
      (c) => `
      <tr>
        <td>${new Date(c.created_at).toLocaleDateString("pt-BR")}</td>
        <td>${sourceLabel(c.source)}</td>
        <td>${c.customer_name || "-"}</td>
        <td style="text-align:right">${brl(Number(c.amount || 0))}</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Recibo - ${provider.name}</title>
<style>
  * { font-family: Arial, Helvetica, sans-serif; box-sizing: border-box; }
  body { margin: 0; padding: 32px; color: #111; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 3px solid #FF6B00; padding-bottom: 12px; margin-bottom: 16px; }
  .brand { font-size: 22px; font-weight: 800; color:#FF6B00; }
  .sub { font-size: 12px; color:#555; }
  h1 { font-size: 18px; margin: 8px 0 4px; }
  .meta { font-size: 13px; color:#333; margin-bottom: 16px; line-height: 1.6; }
  table { width:100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }
  th { background:#f3f3f3; text-align:left; padding:8px; border-bottom: 2px solid #ddd; }
  td { padding:8px; border-bottom: 1px solid #eee; }
  .total { text-align:right; font-size: 18px; font-weight:800; margin-top: 8px; }
  .decl { font-size: 12px; color:#333; margin: 28px 0 60px; line-height:1.6; }
  .sign { border-top: 1px solid #333; width: 320px; margin: 0 auto; text-align:center; padding-top:6px; font-size:12px; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">Banana Calçados</div>
      <div class="sub">Recibo de Pagamento de Entregas</div>
    </div>
    <div class="sub" style="text-align:right">
      Emitido em<br/>${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
    </div>
  </div>

  <h1>Prestador: ${provider.name}</h1>
  <div class="meta">
    Tipo: ${PROVIDER_TYPE_LABEL[provider.provider_type]}<br/>
    ${provider.phone ? `Telefone: ${provider.phone}<br/>` : ""}
    ${provider.document ? `Documento: ${provider.document}<br/>` : ""}
    Total de corridas: ${costs.length}
  </div>

  <table>
    <thead>
      <tr><th>Data</th><th>Origem</th><th>Cliente</th><th style="text-align:right">Valor</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="total">Total pago: ${brl(Number(payment.total_amount || 0))}</div>

  <div class="decl">
    Declaro que recebi de <strong>Banana Calçados</strong> a importância de
    <strong>${brl(Number(payment.total_amount || 0))}</strong>, referente às entregas
    listadas acima, dando plena e total quitação.
  </div>

  <div class="sign">${provider.name}<br/>Assinatura do prestador</div>

  <script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
