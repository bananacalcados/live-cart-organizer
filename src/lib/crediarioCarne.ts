import { supabase } from "@/integrations/supabase/client";

export interface CarneInstallment {
  installment_number: number;
  installments_total: number;
  amount: number;
  due_date: string | null;
  code: string | null;
  status?: string | null;
  paid_amount?: number | null;
}

export interface CarneData {
  storeName: string;
  storeAddress?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerCpf?: string | null;
  orderLabel: string;
  saleDate?: string | null;
  gateway?: string | null;
  installments: CarneInstallment[];
}

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const fmtMoney = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  if (!y || !m || !day) return "—";
  return `${day}/${m}/${y}`;
};

const fmtPhone = (p?: string | null) => {
  const digits = String(p || "").replace(/\D/g, "");
  if (digits.length < 10) return p || "—";
  const local = digits.slice(-11);
  return local.length === 11
    ? local.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3")
    : local.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
};

export function buildCarneHtml(data: CarneData): string {
  const total = data.installments.reduce((s, i) => s + Number(i.amount || 0), 0);
  const slips = data.installments
    .map((inst) => {
      const paid = Number(inst.paid_amount || 0) > 0 || inst.status === "paid";
      return `
      <div class="slip">
        <div class="slip-head">
          <div>
            <div class="store">${esc(data.storeName)}</div>
            ${data.storeAddress ? `<div class="muted">${esc(data.storeAddress)}</div>` : ""}
          </div>
          <div class="parcel">${inst.installment_number}/${inst.installments_total}</div>
        </div>
        <div class="grid">
          <div><span class="lbl">Cliente</span><span class="val">${esc(data.customerName || "Consumidor Final")}</span></div>
          <div><span class="lbl">Telefone</span><span class="val">${esc(fmtPhone(data.customerPhone))}</span></div>
          <div><span class="lbl">CPF</span><span class="val">${esc(data.customerCpf || "—")}</span></div>
          <div><span class="lbl">Pedido</span><span class="val">${esc(data.orderLabel)}</span></div>
          <div><span class="lbl">Data da compra</span><span class="val">${data.saleDate ? esc(new Date(data.saleDate).toLocaleDateString("pt-BR")) : "—"}</span></div>
          <div><span class="lbl">Crediário</span><span class="val">${esc(data.gateway || "Crediário")}</span></div>
        </div>
        <div class="amount-row">
          <div>
            <div class="lbl">Vencimento</div>
            <div class="big">${fmtDate(inst.due_date)}</div>
          </div>
          <div class="right">
            <div class="lbl">Valor da parcela</div>
            <div class="big">${fmtMoney(inst.amount)}</div>
          </div>
        </div>
        <div class="code-box">
          <span class="lbl">Código da parcela</span>
          <span class="code">${esc(inst.code || "—")}</span>
        </div>
        ${paid ? `<div class="paid">PARCELA JÁ PAGA</div>` : ""}
        <div class="foot">Informe o código acima no caixa para localizar o pagamento. Total da compra no crediário: ${fmtMoney(total)} em ${data.installments.length}x.</div>
      </div>`;
    })
    .join("");

  return `<html><head><meta charset="utf-8"><title>Carnê de Compra</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 12px; margin: 0; }
    .slip { border: 2px dashed #333; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; page-break-inside: avoid; }
    .slip-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #ccc; padding-bottom: 6px; margin-bottom: 8px; }
    .store { font-size: 16px; font-weight: bold; }
    .muted { color: #555; font-size: 11px; }
    .parcel { font-size: 22px; font-weight: bold; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; font-size: 12px; }
    .lbl { display: block; color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
    .val { font-weight: 600; }
    .amount-row { display: flex; justify-content: space-between; margin-top: 10px; border-top: 1px solid #eee; padding-top: 8px; }
    .right { text-align: right; }
    .big { font-size: 19px; font-weight: bold; }
    .code-box { margin-top: 10px; padding: 8px; background: #f4f4f4; border: 1px solid #ddd; border-radius: 6px; text-align: center; }
    .code { display: block; font-family: 'Courier New', monospace; font-size: 20px; font-weight: bold; letter-spacing: 2px; }
    .paid { margin-top: 8px; text-align: center; font-weight: bold; color: #15803d; border: 1px solid #15803d; border-radius: 4px; padding: 3px; font-size: 12px; }
    .foot { margin-top: 8px; font-size: 10px; color: #555; }
    @media print { body { padding: 0; } .slip { margin-bottom: 8px; } }
  </style></head><body>
    ${slips}
    <script>window.onload=()=>window.print()</script>
  </body></html>`;
}

export function printCarne(data: CarneData): boolean {
  if (!data.installments.length) return false;
  const w = window.open("", "_blank", "width=680,height=880");
  if (!w) return false;
  w.document.write(buildCarneHtml(data));
  w.document.close();
  return true;
}

/** Carrega as parcelas do crediário da venda e imprime o carnê. */
export async function printCarneForSale(
  saleId: string,
  fallback?: Partial<CarneData>,
): Promise<{ ok: boolean; error?: string }> {
  const { data: rows, error } = await supabase
    .from("pos_crediario_installments" as any)
    .select("installment_number,installments_total,amount,due_date,code,status,paid_amount,customer_name,customer_phone,customer_cpf,gateway,store_id")
    .eq("sale_id", saleId)
    .order("installment_number", { ascending: true });

  if (error) return { ok: false, error: error.message };
  const list = (rows || []) as any[];
  if (!list.length) return { ok: false, error: "Nenhuma parcela de crediário encontrada para esta venda." };

  let storeName = fallback?.storeName || "Banana Calçados";
  let storeAddress = fallback?.storeAddress || null;
  const storeId = list[0].store_id;
  if (storeId) {
    const { data: store } = await supabase
      .from("pos_stores")
      .select("name,address")
      .eq("id", storeId)
      .maybeSingle();
    if (store?.name) storeName = store.name;
    if (store?.address) storeAddress = store.address;
  }

  const ok = printCarne({
    storeName,
    storeAddress,
    customerName: fallback?.customerName || list[0].customer_name,
    customerPhone: fallback?.customerPhone || list[0].customer_phone,
    customerCpf: fallback?.customerCpf || list[0].customer_cpf,
    orderLabel: fallback?.orderLabel || `Venda ${saleId.slice(0, 8).toUpperCase()}`,
    saleDate: fallback?.saleDate || null,
    gateway: list[0].gateway || fallback?.gateway || null,
    installments: list.map((r) => ({
      installment_number: r.installment_number,
      installments_total: r.installments_total,
      amount: Number(r.amount || 0),
      due_date: r.due_date,
      code: r.code,
      status: r.status,
      paid_amount: Number(r.paid_amount || 0),
    })),
  });

  return ok ? { ok: true } : { ok: false, error: "Não foi possível abrir a janela de impressão (pop-up bloqueado)." };
}

/** Verifica se a venda possui parcelas de crediário (para exibir o botão de reimpressão). */
export async function saleHasCrediarioInstallments(saleId: string): Promise<boolean> {
  const { count } = await supabase
    .from("pos_crediario_installments" as any)
    .select("id", { count: "exact", head: true })
    .eq("sale_id", saleId);
  return (count || 0) > 0;
}
