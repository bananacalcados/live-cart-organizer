// Pacote fiscal mensal para o contador: ZIP (XMLs + Sintegra + resumo CSV) salvo
// no storage privado e enviado por e-mail. Modos: "manual" (admin, botão
// "Enviar agora") e "scheduled" (cron diário 08:00 SP; envia no 2º dia útil e
// re-tenta falhas nos dias úteis seguintes, até 3 tentativas).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";
import { DOMParser } from "npm:linkedom@0.18.5";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { adminClient, requireAdminOrService, sendEmail } from "../_shared/email-send.ts";
import { isAuthorizedCron } from "../_shared/cron-guard.ts";
import { assembleSintegra, type SintegraCompany } from "../_shared/fiscal/sintegra-core.ts";
import { parseSaleXmlWith } from "../_shared/fiscal/sale-xml.ts";
import { XmlPackage } from "../_shared/fiscal/xml-package.ts";
import { buildCsv, brlCell, dateCell, SALES_CSV_HEADERS } from "../_shared/fiscal/fiscal-csv.ts";
import { businessDayIndex, previousMonth, spToday } from "./business-days.ts";

const BUCKET = "accountant-packages";
const MAX_ATTACH = 15 * 1024 * 1024;
const SIGNED_TTL = 30 * 24 * 3600;
const MAX_AUTO_ATTEMPTS = 3;
const AUTH_STATUSES = ["authorized", "autorizada", "autorizado"];

const sb = adminClient();
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function monthBounds(ref: string) {
  const [y, m] = ref.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 3)); // 00:00 em São Paulo
  const end = new Date(Date.UTC(y, m, 1, 3) - 1);
  return { start, end, startIso: start.toISOString(), endIso: end.toISOString() };
}

const fmtCnpj = (c: string) => {
  const d = (c || "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c;
};
const BRL = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function paged<T>(build: (from: number, to: number) => any, size = 100): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

async function buildPackage(companyId: string, ref: string) {
  const { data: company, error: cErr } = await sb.from("companies")
    .select("id, legal_name, trade_name, cnpj, ie, ie_isento, address_street, address_number, address_complement, address_neighborhood, address_cep, address_city, address_state, phone")
    .eq("id", companyId).single();
  if (cErr || !company) throw new Error("Empresa não encontrada");
  const { start, end, startIso, endIso } = monthBounds(ref);

  const docs = await paged<any>((f, t) => sb.from("fiscal_documents")
    .select("id, modelo, serie, numero, valor_total, nome_destinatario, cpf_destinatario, chave_acesso, data_autorizacao, xml_content, cancellation_xml, cancelled_at")
    .eq("company_id", companyId).in("status", AUTH_STATUSES)
    .gte("data_autorizacao", startIso).lte("data_autorizacao", endIso)
    .order("data_autorizacao", { ascending: true }).order("id").range(f, t));

  // Entradas: mesma regra do botão "Baixar XMLs"/Sintegra (notas de compra não têm empresa vinculada).
  const entradas = await paged<any>((f, t) => sb.from("purchase_invoices")
    .select("id, invoice_number, invoice_series, nfe_key, supplier_cnpj, supplier_ie, emission_date, total_value, raw_xml")
    .gte("emission_date", startIso).lte("emission_date", endIso)
    .order("emission_date", { ascending: true }).order("id").range(f, t));

  const counts = {
    nfe: { qtd: 0, valor: 0 }, nfce: { qtd: 0, valor: 0 }, entradas: { qtd: entradas.length, valor: 0 }, canceladas: 0,
  };
  for (const d of docs) {
    const b = d.modelo === 65 ? counts.nfce : counts.nfe;
    b.qtd++; b.valor += Number(d.valor_total) || 0;
    if (d.cancelled_at) counts.canceladas++;
  }
  for (const e of entradas) counts.entradas.valor += Number(e.total_value) || 0;
  const total = docs.length + entradas.length;
  if (total === 0) return { company, counts, total, empty: true as const };

  // XMLs
  const pkg = new XmlPackage();
  for (const d of docs) pkg.addSaida(d);
  for (const e of entradas) pkg.addEntrada(e);

  // Sintegra (mesma montagem do navegador)
  const ids = entradas.map((e) => e.id);
  const entradaItems: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("purchase_invoice_items")
      .select("invoice_id, line_number, supplier_product_code, description, ncm, cfop, unit, quantity, unit_cost, total_cost")
      .in("invoice_id", ids.slice(i, i + 200));
    if (error) throw error;
    entradaItems.push(...(data || []));
  }
  const sCompany: SintegraCompany = {
    cnpj: company.cnpj, ie: company.ie || "", ie_isento: !!company.ie_isento, legal_name: company.legal_name,
    city: company.address_city || "", uf: company.address_state || "", street: company.address_street || "",
    number: company.address_number || "", complement: company.address_complement || "",
    neighborhood: company.address_neighborhood || "", cep: company.address_cep || "",
    contact_name: "", contact_phone: company.phone || "",
  };
  const sintegra = assembleSintegra({
    company: sCompany, periodStart: start, periodEnd: end, natureza: "3", finalidade: "1",
    docs55: docs.filter((d) => d.modelo === 55), docs65: docs.filter((d) => d.modelo === 65),
    entradas, entradaItems, parseXml: (x) => parseSaleXmlWith(DOMParser as any, x),
  });

  // Resumo CSV (mesmas colunas do CSV de vendas) + totais por modelo
  const rows: unknown[][] = docs.map((s) => [
    dateCell(s.data_autorizacao), s.modelo === 65 ? "NFC-e" : "NF-e", company.cnpj, company.legal_name,
    `${s.serie ?? ""}/${s.numero ?? ""}`, s.chave_acesso || "", s.nome_destinatario || "", s.cpf_destinatario || "",
    brlCell(Number(s.valor_total) || 0),
  ]);
  rows.push([], ["TOTAIS"], ["NF-e (mod. 55)", counts.nfe.qtd, "", "", "", "", "", "", brlCell(counts.nfe.valor)],
    ["NFC-e (mod. 65)", counts.nfce.qtd, "", "", "", "", "", "", brlCell(counts.nfce.valor)],
    ["Entradas", counts.entradas.qtd, "", "", "", "", "", "", brlCell(counts.entradas.valor)]);
  const csv = "\ufeff" + buildCsv(SALES_CSV_HEADERS, rows);

  const cnpjDigits = (company.cnpj || "").replace(/\D/g, "");
  const files: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(pkg.files)) files[`XMLS/${k}`] = strToU8(v);
  files["XMLS/LEIA-ME.txt"] = strToU8(pkg.manifest(`${ref}-01`, new Date(end.getTime() - 3 * 3600 * 1000).toISOString(), `${company.legal_name} — ${company.cnpj}`));
  files[`SINTEGRA_${cnpjDigits}_${ref.replace("-", "")}.txt`] = strToU8(sintegra.content);
  if (sintegra.warnings.length) files["SINTEGRA_AVISOS.txt"] = strToU8(sintegra.warnings.join("\r\n"));
  files[`RESUMO_${ref}.csv`] = strToU8(csv);
  const zip = zipSync(files, { level: 6 });

  const path = `${companyId}/${ref}.zip`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, zip, { contentType: "application/zip", upsert: true });
  if (upErr) throw new Error(`Falha ao salvar ZIP: ${upErr.message}`);
  return { company, counts, total, empty: false as const, zip, path };
}

async function runSend(companyId: string, ref: string, historyId: string) {
  try {
    const [{ data: recips }, { data: cfg }] = await Promise.all([
      sb.from("accountant_recipients").select("email").eq("company_id", companyId).eq("ativo", true),
      sb.from("accountant_send_config").select("cc_emails").eq("company_id", companyId).maybeSingle(),
    ]);
    const to = (recips || []).map((r: any) => r.email);
    const cc = cfg?.cc_emails ?? ["administrativo@bananacalcados.com"];
    if (!to.length) throw new Error("Nenhum e-mail de contador ativo");

    const p = await buildPackage(companyId, ref);
    if (p.empty) {
      await sb.from("accountant_send_history").update({ status: "sem_notas", recipients: to, cc, counts: p.counts, notes_count: 0 }).eq("id", historyId);
      return { status: "sem_notas" };
    }
    const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(p.path, SIGNED_TTL);
    const link = signed?.signedUrl || "";
    const attach = p.zip.byteLength <= MAX_ATTACH;
    const name = p.company.legal_name;
    const filename = `arquivos_fiscais_${ref}_${(p.company.cnpj || "").replace(/\D/g, "")}.zip`;
    const c = p.counts;
    const lines = [
      `NF-e (modelo 55): ${c.nfe.qtd} nota(s) — ${BRL(c.nfe.valor)}`,
      `NFC-e (modelo 65): ${c.nfce.qtd} nota(s) — ${BRL(c.nfce.valor)}`,
      `Entradas (NF-e de compra): ${c.entradas.qtd} nota(s) — ${BRL(c.entradas.valor)}`,
      ...(c.canceladas ? [`Canceladas no período (incluídas com XML de cancelamento quando houver): ${c.canceladas}`] : []),
      `Total de saídas: ${BRL(c.nfe.valor + c.nfce.valor)}`,
    ];
    const text = [
      "Olá,", "", `Seguem os arquivos fiscais de ${ref} da empresa ${name} (CNPJ ${fmtCnpj(p.company.cnpj)}).`, "",
      ...lines, "",
      attach ? "O pacote (XMLs, Sintegra e resumo CSV) está anexado." : "O pacote ficou grande demais para anexo; baixe pelo link abaixo.",
      `Link de download (válido por 30 dias): ${link}`, "", "Banana Calçados - Fiscal",
    ].join("\n");
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<p>Olá,</p><p>Seguem os arquivos fiscais de <b>${ref}</b> da empresa <b>${esc(name)}</b> (CNPJ ${fmtCnpj(p.company.cnpj)}).</p>
<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<p>${attach ? "O pacote (XMLs, Sintegra e resumo CSV) está anexado." : "O pacote ficou grande demais para anexo; baixe pelo link abaixo."}</p>
<p><a href="${link}">Baixar pacote (link válido por 30 dias)</a></p><p>Banana Calçados - Fiscal</p></div>`;

    const r = await sendEmail({
      categoria: "fiscal", to, cc, company_id: companyId,
      subject: `Arquivos fiscais ${ref} — ${name} — CNPJ ${fmtCnpj(p.company.cnpj)}`,
      html, text,
      attachments: attach ? [{ filename, content_base64: encodeBase64(p.zip) }] : undefined,
      metadata: { reference_month: ref, history_id: historyId, zip_bytes: p.zip.byteLength },
    });
    await sb.from("accountant_send_history").update({
      status: r.ok ? "sent" : "failed", error: r.ok ? null : r.error, email_log_id: r.log_id,
      recipients: to, cc, counts: p.counts, notes_count: p.total, storage_path: p.path, attached: attach,
    }).eq("id", historyId);
    return { status: r.ok ? "sent" : "failed", error: r.error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("accountant_send_history").update({ status: "failed", error: msg.slice(0, 2000) }).eq("id", historyId);
    return { status: "failed", error: msg };
  }
}

async function scheduled() {
  const today = spToday();
  const { data: hol } = await sb.from("fiscal_holidays").select("date")
    .gte("date", `${today.slice(0, 7)}-01`).lte("date", `${today.slice(0, 7)}-31`);
  const holidays = new Set((hol || []).map((h: any) => h.date));
  const idx = businessDayIndex(today, holidays);
  if (idx === null || idx < 2) return { today, business_day: idx, action: "nada a fazer" };
  const ref = previousMonth(today);

  // Libera envios automáticos travados há mais de 1 h (queda da função).
  await sb.from("accountant_send_history").update({ status: "failed", error: "Interrompido (tempo esgotado)" })
    .eq("trigger_type", "auto").eq("status", "processing").lt("created_at", new Date(Date.now() - 3600_000).toISOString());

  const { data: cfgs } = await sb.from("accountant_send_config").select("company_id").eq("auto_send_enabled", true);
  const results: any[] = [];
  for (const { company_id } of cfgs || []) {
    const { count: active } = await sb.from("accountant_recipients").select("id", { count: "exact", head: true })
      .eq("company_id", company_id).eq("ativo", true);
    if (!active) continue;
    const { data: hist } = await sb.from("accountant_send_history").select("status, created_at")
      .eq("company_id", company_id).eq("reference_month", ref).eq("trigger_type", "auto");
    const h = hist || [];
    if (h.some((r: any) => r.status !== "failed")) continue; // já enviado / sem notas / em andamento
    const failed = h.length;
    if (failed >= MAX_AUTO_ATTEMPTS) continue;
    if (failed === 0 && idx !== 2) continue; // 1ª tentativa só no 2º dia útil
    if (failed > 0 && h.some((r: any) => spToday(new Date(r.created_at)) === today)) continue; // 1 tentativa por dia
    const { data: row, error } = await sb.from("accountant_send_history").insert({
      company_id, reference_month: ref, trigger_type: "auto", status: "processing", attempt: failed + 1,
    }).select("id").single();
    if (error || !row) continue; // outra execução já reservou
    results.push({ company_id, ...(await runSend(company_id, ref, row.id)) });
  }
  return { today, business_day: idx, reference_month: ref, results };
}

const Manual = z.object({
  mode: z.literal("manual"),
  company_id: z.string().uuid(),
  reference_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  force: z.boolean().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.mode === "scheduled") {
      if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);
      return json(await scheduled());
    }
    const who = await requireAdminOrService(req);
    if (!who) return json({ error: "Somente administradores" }, 401);
    const parsed = Manual.safeParse(body);
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { company_id, reference_month, force } = parsed.data;
    if (!force) {
      const { count } = await sb.from("accountant_send_history").select("id", { count: "exact", head: true })
        .eq("company_id", company_id).eq("reference_month", reference_month).eq("status", "sent");
      if (count) return json({ needs_confirmation: true });
    }
    const { data: row, error } = await sb.from("accountant_send_history").insert({
      company_id, reference_month, trigger_type: "manual", status: "processing",
      created_by: who === "service" ? null : who,
    }).select("id").single();
    if (error || !row) throw error || new Error("Falha ao registrar envio");
    return json(await runSend(company_id, reference_month, row.id));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
