import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import QRCode from "https://esm.sh/qrcode@1.5.3";
import { getActiveMpAccount } from "../_shared/mp-account.ts";

// Boleto Mercado Pago sob demanda (vendedor no chat do PDV).
// Fluxo:
//  1) valida payload completo (payer + address).
//  2) cria pos_boletos (pending).
//  3) chama MP /v1/payments com payment_method_id=bolbradesco + payer.address (regra do usuário).
//  4) opcional: cria um PIX MP gêmeo para incluir QR + copia-e-cola no mesmo PDF.
//  5) gera PDF com pdf-lib (dados do cliente, valor, vencimento, linha digitável, link do
//     boleto oficial MP, QR PIX se houver), sobe no bucket privado `boletos` e retorna URL assinada.
//  6) atualiza pos_boletos com todos os IDs.

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function isAllowedOrigin(origin: string) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:") return false;
    return hostname.endsWith(".lovable.app") || hostname.endsWith(".lovableproject.com");
  } catch {
    return false;
  }
}

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function cleanDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

function required(obj: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    const v = obj[f];
    if (v === undefined || v === null || String(v).trim() === "") return f;
  }
  return null;
}

// Formatar data ISO com timezone -03:00 (padrão MP)
function formatMpDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  return `${yyyy}-${mm}-${dd}T23:59:59.000-03:00`;
}

// Formata linha digitável do boleto (44/47 dígitos) em blocos legíveis
function formatBarcode(raw: string): string {
  const digits = cleanDigits(raw);
  if (digits.length !== 47 && digits.length !== 48) return raw;
  // Boleto de arrecadação (48) ou boleto bancário (47) — formatação simplificada
  return digits.match(/.{1,4}/g)?.join(" ") ?? digits;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });

  const headers = { ...cors(req), "Content-Type": "application/json" };

  try {
    const body = await req.json();
    const {
      storeId,
      sellerId,
      customer_name,
      customer_cpf,
      customer_email,
      customer_phone,
      address_zip,
      address_street,
      address_number,
      address_complement,
      address_neighborhood,
      address_city,
      address_state,
      amount,
      description,
      due_date, // ISO date "YYYY-MM-DD"
      include_pix,
    } = body || {};

    const missing = required(body, [
      "customer_name",
      "customer_cpf",
      "customer_email",
      "address_zip",
      "address_street",
      "address_number",
      "address_neighborhood",
      "address_city",
      "address_state",
      "amount",
      "due_date",
    ]);
    if (missing) throw new Error(`Campo obrigatório ausente: ${missing}`);

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error("Valor inválido");

    const cpf = cleanDigits(customer_cpf);
    if (cpf.length !== 11) throw new Error("CPF inválido (11 dígitos)");
    const zip = cleanDigits(address_zip);
    if (zip.length !== 8) throw new Error("CEP inválido (8 dígitos)");
    const uf = String(address_state).toUpperCase().slice(0, 2);
    if (uf.length !== 2) throw new Error("UF inválida");

    // Data de vencimento: mínimo hoje+1
    const dueParts = String(due_date).split("-").map(Number);
    if (dueParts.length !== 3) throw new Error("Vencimento inválido");
    const dueDate = new Date(dueParts[0], dueParts[1] - 1, dueParts[2]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dueDate < tomorrow) throw new Error("Vencimento deve ser a partir de amanhã");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const mpAccount = await getActiveMpAccount(supabase);
    if (!mpAccount) throw new Error("Nenhuma conta Mercado Pago ativa configurada");

    // Split de nome
    const nameParts = String(customer_name).trim().split(/\s+/);
    const firstName = nameParts.shift() || "Cliente";
    const lastName = nameParts.join(" ") || "Banana";

    // 1) INSERT pos_boletos (pending)
    const authHeader = req.headers.get("authorization") || "";
    let createdBy: string | null = null;
    if (authHeader.startsWith("Bearer ")) {
      try {
        const { data: userRes } = await supabase.auth.getUser(authHeader.slice(7));
        createdBy = userRes?.user?.id ?? null;
      } catch { /* ignore */ }
    }

    const { data: boleto, error: insertErr } = await supabase
      .from("pos_boletos")
      .insert({
        store_id: storeId || null,
        seller_id: sellerId || null,
        created_by: createdBy,
        customer_name,
        customer_cpf: cpf,
        customer_email,
        customer_phone: customer_phone || null,
        address_zip: zip,
        address_street,
        address_number: String(address_number),
        address_complement: address_complement || null,
        address_neighborhood,
        address_city,
        address_state: uf,
        amount: amountNum,
        description: description || null,
        due_date,
        mp_account_id: mpAccount.account_id,
        status: "pending",
      })
      .select("id")
      .single();
    if (insertErr || !boleto) throw new Error(`Falha ao registrar boleto: ${insertErr?.message}`);
    const boletoId = boleto.id as string;
    const externalRef = `boleto:${boletoId}`;

    // 2) Cria pagamento boleto no MP
    const payerAddress = {
      zip_code: zip,
      street_name: String(address_street),
      street_number: String(address_number),
      neighborhood: String(address_neighborhood),
      city: String(address_city),
      federal_unit: uf,
    };

    const boletoBody = {
      transaction_amount: Math.round(amountNum * 100) / 100,
      description: description || `Boleto Banana Calçados — ${customer_name}`,
      payment_method_id: "bolbradesco",
      date_of_expiration: formatMpDate(dueDate),
      external_reference: externalRef,
      notification_url: `${supabaseUrl}/functions/v1/payment-webhook?gateway=mercadopago`,
      payer: {
        email: String(customer_email),
        first_name: firstName,
        last_name: lastName,
        identification: { type: "CPF", number: cpf },
        address: payerAddress,
      },
    };

    const mpBoletoRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpAccount.access_token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `boleto-${boletoId}`,
      },
      body: JSON.stringify(boletoBody),
    });
    const mpBoletoData = await mpBoletoRes.json();
    if (!mpBoletoRes.ok) {
      const errMsg = mpBoletoData?.message || mpBoletoData?.cause?.[0]?.description || `MP ${mpBoletoRes.status}`;
      await supabase.from("pos_boletos")
        .update({ status: "error", error_message: errMsg })
        .eq("id", boletoId);
      throw new Error(`Mercado Pago rejeitou o boleto: ${errMsg}`);
    }

    const mpPaymentId = String(mpBoletoData.id);
    const mpBoletoUrl = mpBoletoData?.transaction_details?.external_resource_url || null;
    const mpBarcode = mpBoletoData?.barcode?.content || null;

    // 3) Opcional: PIX gêmeo
    let pixPaymentId: string | null = null;
    let pixQrCode: string | null = null;
    let pixQrBase64: string | null = null;
    if (include_pix) {
      try {
        const pixBody = {
          transaction_amount: Math.round(amountNum * 100) / 100,
          description: description || `PIX — ${customer_name}`,
          payment_method_id: "pix",
          date_of_expiration: formatMpDate(dueDate),
          external_reference: externalRef,
          notification_url: `${supabaseUrl}/functions/v1/payment-webhook?gateway=mercadopago`,
          payer: {
            email: String(customer_email),
            first_name: firstName,
            last_name: lastName,
            identification: { type: "CPF", number: cpf },
          },
        };
        const pixRes = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mpAccount.access_token}`,
            "Content-Type": "application/json",
            "X-Idempotency-Key": `boleto-pix-${boletoId}`,
          },
          body: JSON.stringify(pixBody),
        });
        const pixData = await pixRes.json();
        if (pixRes.ok) {
          pixPaymentId = String(pixData.id);
          pixQrCode = pixData?.point_of_interaction?.transaction_data?.qr_code || null;
          pixQrBase64 = pixData?.point_of_interaction?.transaction_data?.qr_code_base64 || null;
        } else {
          console.warn("[boleto] PIX gêmeo falhou (segue sem):", pixData);
        }
      } catch (e) {
        console.warn("[boleto] PIX gêmeo erro:", e);
      }
    }

    // 4) Gera PDF com pdf-lib
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const { width } = page.getSize();
    let y = 800;

    const drawText = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number } = {}) => {
      const size = opts.size ?? 10;
      const color = opts.color ?? [0.1, 0.1, 0.1];
      page.drawText(text, {
        x: opts.x ?? 40,
        y,
        size,
        font: opts.bold ? bold : font,
        color: rgb(color[0], color[1], color[2]),
      });
    };

    drawText("BANANA CALÇADOS", { size: 18, bold: true, color: [0.85, 0.65, 0.05] }); y -= 24;
    drawText("Boleto Bancário — Mercado Pago", { size: 11, bold: true }); y -= 20;

    // Cliente
    drawText("PAGADOR", { size: 9, bold: true, color: [0.4, 0.4, 0.4] }); y -= 14;
    drawText(String(customer_name), { size: 11, bold: true }); y -= 14;
    drawText(`CPF: ${cpf}`); y -= 12;
    drawText(`E-mail: ${customer_email}`); y -= 12;
    drawText(`Endereço: ${address_street}, ${address_number}${address_complement ? " - " + address_complement : ""}`); y -= 12;
    drawText(`${address_neighborhood} — ${address_city}/${uf} — CEP ${zip}`); y -= 22;

    // Valor + vencimento
    drawText("VALOR", { size: 9, bold: true, color: [0.4, 0.4, 0.4] });
    drawText("VENCIMENTO", { size: 9, bold: true, color: [0.4, 0.4, 0.4], x: 300 });
    y -= 14;
    drawText(`R$ ${amountNum.toFixed(2).replace(".", ",")}`, { size: 14, bold: true });
    drawText(dueDate.toLocaleDateString("pt-BR"), { size: 14, bold: true, x: 300 });
    y -= 24;

    if (description) {
      drawText("DESCRIÇÃO", { size: 9, bold: true, color: [0.4, 0.4, 0.4] }); y -= 12;
      drawText(String(description)); y -= 18;
    }

    // Linha digitável
    drawText("LINHA DIGITÁVEL", { size: 9, bold: true, color: [0.4, 0.4, 0.4] }); y -= 14;
    if (mpBarcode) {
      drawText(formatBarcode(mpBarcode), { size: 11, bold: true }); y -= 16;
    } else {
      drawText("(gerada pelo Mercado Pago — use o link abaixo)"); y -= 14;
    }
    y -= 8;

    if (mpBoletoUrl) {
      drawText("Boleto oficial (com código de barras impresso):", { size: 9, color: [0.4, 0.4, 0.4] }); y -= 12;
      drawText(mpBoletoUrl, { size: 8, color: [0.1, 0.3, 0.7] }); y -= 20;
    }

    // PIX (se houver)
    if (pixQrCode) {
      y -= 6;
      drawText("PAGAR COM PIX (mesmo valor, mais rápido)", { size: 11, bold: true, color: [0.05, 0.6, 0.4] }); y -= 16;

      // QR image
      if (pixQrBase64) {
        try {
          const bytes = Uint8Array.from(atob(pixQrBase64), (c) => c.charCodeAt(0));
          const png = await pdf.embedPng(bytes);
          const dim = 140;
          page.drawImage(png, { x: 40, y: y - dim, width: dim, height: dim });
        } catch (e) {
          console.warn("[boleto] falha ao embutir QR PIX PNG:", e);
        }
      } else {
        try {
          const qrDataUrl = await QRCode.toDataURL(pixQrCode, { margin: 1, width: 240 });
          const b64 = qrDataUrl.split(",")[1];
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const png = await pdf.embedPng(bytes);
          const dim = 140;
          page.drawImage(png, { x: 40, y: y - dim, width: dim, height: dim });
        } catch (e) {
          console.warn("[boleto] fallback QR falhou:", e);
        }
      }

      // Copia e cola ao lado
      const codeX = 200;
      let codeY = y - 10;
      page.drawText("PIX Copia e Cola:", { x: codeX, y: codeY, size: 9, font: bold });
      codeY -= 14;
      const chunks = pixQrCode.match(/.{1,42}/g) || [pixQrCode];
      for (const c of chunks.slice(0, 8)) {
        page.drawText(c, { x: codeX, y: codeY, size: 7, font });
        codeY -= 9;
      }
      y -= 155;
    }

    y = Math.max(y, 80);
    drawText("Após o pagamento a confirmação pode levar até 2 horas úteis.", { size: 8, color: [0.5, 0.5, 0.5] });

    const pdfBytes = await pdf.save();

    // 5) Upload no bucket
    const pdfPath = `${boletoId}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("boletos")
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) console.warn("[boleto] upload PDF falhou:", upErr);

    const { data: signed } = await supabase.storage
      .from("boletos")
      .createSignedUrl(pdfPath, 60 * 60 * 24 * 7); // 7 dias

    // 6) Atualiza registro
    await supabase.from("pos_boletos")
      .update({
        mp_payment_id: mpPaymentId,
        mp_boleto_url: mpBoletoUrl,
        mp_barcode: mpBarcode,
        mp_pix_payment_id: pixPaymentId,
        mp_pix_qr_code: pixQrCode,
        mp_pix_qr_base64: pixQrBase64,
        pdf_path: pdfPath,
      })
      .eq("id", boletoId);

    return new Response(
      JSON.stringify({
        ok: true,
        boletoId,
        mpPaymentId,
        boletoUrl: mpBoletoUrl,
        barcode: mpBarcode,
        pdfUrl: signed?.signedUrl || null,
        pixQrCode,
        pixQrBase64,
        amount: amountNum,
        dueDate: due_date,
      }),
      { headers, status: 200 },
    );
  } catch (err) {
    console.error("[mercadopago-create-boleto]", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { headers, status: 400 },
    );
  }
});
