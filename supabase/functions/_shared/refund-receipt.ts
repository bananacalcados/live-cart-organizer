// Comprovante interno de estorno (Fase 3). Gerado SÓ no servidor, SÓ para
// estorno "concluido", uma vez por estorno: o PDF fica no bucket privado
// refund-receipts e as próximas chamadas reaproveitam o mesmo arquivo/código.
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { BANANA_LOGO_PNG_BASE64 } from "./banana-logo.ts";
import { externalRefundEvidence } from "./external-refund-evidence.ts";

const BUCKET = "refund-receipts";
const TZ = "America/Sao_Paulo";

const REASON_LABELS: Record<string, string> = {
  cancelamento_antes_envio: "Cancelamento antes do envio",
  devolucao: "Devolução",
  troca_com_diferenca: "Troca com diferença",
  outro: "Outro",
};

function brl(n: number) {
  return "R$ " + n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function fmtDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "-";
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" };
  return new Date(iso).toLocaleString("pt-BR", opts) + (withTime ? " (horário de Brasília)" : "");
}
export function maskCpf(cpf: string | null | undefined): string | null {
  const d = String(cpf || "").replace(/\D/g, "");
  if (d.length !== 11) return null;
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}
function fmtCnpj(c: string | null | undefined) {
  const d = String(c || "").replace(/\D/g, "");
  if (d.length !== 14) return c ? String(c) : null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
// Fontes padrão do PDF usam WinAnsi: remove o que não for representável.
function safe(s: string) {
  return String(s ?? "").replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2022]/g, "");
}

async function loadPurchase(supabase: any, row: any) {
  if (row.source === "pos_sale") {
    const { data } = await supabase.from("pos_sales")
      .select("id, total, created_at, customer_name, customer_cpf, tiny_order_number")
      .eq("id", row.source_id).maybeSingle();
    return {
      channel: "PDV",
      number: data?.tiny_order_number ? String(data.tiny_order_number) : String(row.source_id).slice(0, 8).toUpperCase(),
      createdAt: data?.created_at || null,
      total: Number(data?.total || 0),
      customerName: data?.customer_name || null,
      cpf: data?.customer_cpf || null,
    };
  }
  const { data } = await supabase.from("orders")
    .select("id, products, discount_type, discount_value, free_shipping, shipping_cost, created_at, pos_sale_id, customer:customers(full_name)")
    .eq("id", row.source_id).maybeSingle();
  const productsTotal = (Array.isArray(data?.products) ? data.products : []).reduce(
    (s: number, p: any) => s + (Number(p?.price) || 0) * (Number(p?.quantity) || 0), 0);
  const discount = data?.discount_type && data?.discount_value
    ? (data.discount_type === "percentage" ? productsTotal * (Number(data.discount_value) / 100) : Number(data.discount_value)) : 0;
  const shipping = data?.free_shipping ? 0 : Number(data?.shipping_cost || 0);
  let cpf: string | null = null;
  if (data?.pos_sale_id) {
    const { data: sale } = await supabase.from("pos_sales").select("customer_cpf").eq("id", data.pos_sale_id).maybeSingle();
    cpf = sale?.customer_cpf || null;
  }
  return {
    channel: "Live",
    number: String(row.source_id).slice(0, 8).toUpperCase(),
    createdAt: data?.created_at || null,
    total: Math.max(0, productsTotal - discount + shipping),
    customerName: data?.customer?.full_name || null,
    cpf,
  };
}

/** Gera (uma vez) e devolve o caminho do comprovante. Só para status "concluido". */
// Layout atual (sem "Emitido por"). Comprovantes gerados antes disso são regerados
// no mesmo caminho e com o mesmo código pelo worker.
export const RECEIPT_LAYOUT_SINCE = "2026-10-20T01:00:00Z";

export async function ensureRefundReceipt(supabase: any, refundId: string, regenerate = false): Promise<{ ok: boolean; path?: string; code?: string; error?: string }> {
  const { data: row } = await supabase.from("gateway_refunds").select("*").eq("id", refundId).maybeSingle();
  if (!row) return { ok: false, error: "Estorno não encontrado." };
  if (!["concluido","concluido_manual"].includes(row.status)) return { ok: false, error: "Comprovante só pode ser gerado para estorno concluído." };
  if (row.receipt_path && row.receipt_code && !regenerate) return { ok: true, path: row.receipt_path, code: row.receipt_code };

  const { data: account } = await supabase.from("mercadopago_accounts")
    .select("name, cnpj, access_token").eq("id", row.mp_account_id).maybeSingle();
  const isPix = !row.card_brand;
  const isAppmax = row.gateway === "appmax";
  const gwName = row.gateway === "austpay" ? "AustPay" : isAppmax ? "Appmax" : "Mercado Pago";

  // Pix sem E2E: busca de novo no MP antes de gerar; nunca inventa.
  let e2e: string | null = row.e2e_id || null;
  if (row.gateway === "mercadopago" && isPix && !e2e && row.refund_id && account?.access_token) {
    try {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${row.payment_id}/refunds/${row.refund_id}`, {
        headers: { Authorization: `Bearer ${account.access_token}` },
      });
      if (r.ok) {
        const j = await r.json();
        if (j?.e2e_id) {
          e2e = String(j.e2e_id);
          await supabase.from("gateway_refunds").update({ e2e_id: e2e }).eq("id", row.id).is("e2e_id", null);
        }
      }
    } catch (_) { /* segue com "não informado" */ }
  }

  const { data: cfg } = await supabase.from("refund_settings").select("receipt_footer_contact").eq("id", true).maybeSingle();
  const purchase = await loadPurchase(supabase, row);
  const external = externalRefundEvidence(row);

  // Código: reaproveita se já existir (geração anterior interrompida).
  const code = row.receipt_code || randomCode();

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.12, 0.12);
  const muted = rgb(0.42, 0.42, 0.42);
  const line = rgb(0.85, 0.85, 0.85);
  const M = 56;
  const W = 595.28 - M * 2;
  let y = 841.89 - 48;

  const logoBytes = Uint8Array.from(atob(BANANA_LOGO_PNG_BASE64), (c) => c.charCodeAt(0));
  const logo = await pdf.embedPng(logoBytes);
  const lw = 150, lh = (logo.height / logo.width) * lw;
  page.drawImage(logo, { x: M, y: y - lh, width: lw, height: lh });
  page.drawText(safe("Código de verificação"), { x: M + W - 150, y: y - 18, size: 9, font, color: muted });
  page.drawText(code, { x: M + W - 150, y: y - 36, size: 16, font: bold, color: ink });
  y -= lh + 22;

  page.drawText(safe("Comprovante de Estorno"), { x: M, y, size: 22, font: bold, color: ink });
  y -= 14;

  const section = (title: string) => {
    y -= 24;
    page.drawLine({ start: { x: M, y: y + 14 }, end: { x: M + W, y: y + 14 }, thickness: 0.8, color: line });
    page.drawText(safe(title.toUpperCase()), { x: M, y, size: 10, font: bold, color: muted });
    y -= 6;
  };
  const wrap = (text: string, f: any, size: number, maxW: number) => {
    const words = safe(text).split(/\s+/);
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(t, size) > maxW && cur) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  };
  const field = (label: string, value: string) => {
    const lines = wrap(value, bold, 11, W - 190);
    y -= 18;
    page.drawText(safe(label), { x: M, y, size: 10, font, color: muted });
    lines.forEach((l, i) => page.drawText(l, { x: M + 190, y: y - i * 14, size: 11, font: bold, color: ink }));
    y -= (lines.length - 1) * 14;
  };
  const para = (text: string, size = 9.5, color = muted) => {
    for (const l of wrap(text, font, size, W)) { y -= size + 4; page.drawText(l, { x: M, y, size, font, color }); }
  };


  section("Cliente");
  field("Nome", purchase.customerName || "-");
  const cpf = maskCpf(purchase.cpf);
  if (cpf) field("CPF", cpf);

  section("Compra");
  field("Canal", purchase.channel);
  field(purchase.channel === "Live" ? "Pedido" : "Venda", purchase.number);
  field("Data da compra", fmtDate(purchase.createdAt));
  field("Valor original pago", brl(external?.paidAmount ?? purchase.total));

  section("Estorno");
  if (row.status==='concluido_manual') para(`Estorno registrado manualmente · protocolo ${row.manual_reference}`,10,ink);
  field("Valor estornado", brl(Number(row.amount)));
  field("Tipo", row.refund_type === "integral" ? "Integral" : "Parcial");
  field("Concluído em", external ? external.displayedDate : fmtDate(row.completed_at || row.updated_at, true));
  const reason = REASON_LABELS[row.reason] || row.reason;
  field("Motivo", row.reason === "outro" && row.reason_text ? `Outro — ${row.reason_text}` : reason);

  section(isPix ? "Pagamento — Pix" : "Pagamento — Cartão");
  if (row.gateway === "austpay") {
    field("Gateway", "AustPay");
    field("ID da transação", String(row.payment_id || "-"));
  }
  if (isAppmax) {
    field("Gateway", "Appmax");
    field("ID do pedido Appmax", String(row.payment_id || "-"));
  }
  if (isPix) {
    field("Código da devolução Pix (E2E)", e2e || (isAppmax ? "E2E não informado pelo gateway" : "E2E não informado pelo Mercado Pago"));
    field("ID do reembolso", row.refund_id || "-");
  } else {
    field("Bandeira", String(row.card_brand || "-").toUpperCase());
    if (row.card_last4) field("Final do cartão", `**** ${row.card_last4}`);
    if (row.installments) field("Parcelas", `${row.installments}x`);
    field("ID do reembolso", row.refund_id || "-");
    y -= 10;
    para("O valor será creditado na fatura do cartão conforme o prazo do banco emissor, podendo aparecer na fatura atual ou na seguinte.", 10, ink);
  }

  // Rodapé
  y = 110;
  page.drawLine({ start: { x: M, y: y + 12 }, end: { x: M + W, y: y + 12 }, thickness: 0.8, color: line });
  page.drawText("Banana Calçados", { x: M, y: y - 4, size: 11, font: bold, color: ink });
  y -= 4;
  const contact = String(cfg?.receipt_footer_contact || "").trim();
  if (contact) para(contact);
  para(row.status==='concluido_manual'?`Documento interno: devolução no painel ${gwName} declarada pelo administrador, protocolo ${row.manual_reference}. Não representa nova devolução nem confirmação automática da operadora.`:`Documento interno gerado pelo sistema a partir dos dados da transação no ${gwName}.`);
  para(`Código de verificação: ${code}`);

  const bytes = await pdf.save();
  const path = (regenerate && row.receipt_path) ? row.receipt_path : `${row.id}/comprovante-${code}.pdf`;
  const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) return { ok: false, error: `Falha ao salvar o comprovante: ${up.error.message}` };

  if (regenerate && row.receipt_path) {
    await supabase.from("gateway_refunds").update({ receipt_generated_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: true, path, code };
  }


  const { data: saved } = await supabase.from("gateway_refunds").update({
    receipt_code: code, receipt_path: path, receipt_generated_at: new Date().toISOString(),
  }).eq("id", row.id).is("receipt_path", null).select("receipt_path, receipt_code").maybeSingle();
  if (!saved) {
    // Outra geração simultânea venceu: usa a dela.
    const { data: again } = await supabase.from("gateway_refunds").select("receipt_path, receipt_code").eq("id", row.id).maybeSingle();
    if (again?.receipt_path && again.receipt_path !== path) await supabase.storage.from(BUCKET).remove([path]);
    return { ok: true, path: again?.receipt_path, code: again?.receipt_code };
  }
  return { ok: true, path: saved.receipt_path, code: saved.receipt_code };
}

export async function signedReceiptUrl(supabase: any, path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600, { download: true });
  if (error) return null;
  return data?.signedUrl || null;
}
