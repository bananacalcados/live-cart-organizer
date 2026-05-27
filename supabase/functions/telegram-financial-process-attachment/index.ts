// Telegram Financial Agent — processa anexos (foto/PDF) via Lovable AI
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

async function sendMessage(chatId: string, text: string, extra: Record<string, unknown> = {}) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", ...extra, text }),
  });
}

async function downloadTelegramFile(fileId: string): Promise<{ bytes: Uint8Array; mime: string; path: string }> {
  const info = await (await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  })).json();
  if (!info.ok) throw new Error("getFile failed: " + JSON.stringify(info));
  const path: string = info.result.file_path;
  const resp = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${path}`);
  if (!resp.ok) throw new Error("download failed: " + resp.status);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mime = ext === "pdf" ? "application/pdf"
    : ext === "png" ? "image/png"
    : ext === "webp" ? "image/webp"
    : ext === "csv" ? "text/csv"
    : ext === "txt" ? "text/plain"
    : ext === "ofx" || ext === "qfx" ? "application/x-ofx"
    : ext === "xls" ? "application/vnd.ms-excel"
    : ext === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "image/jpeg";
  return { bytes, mime, path };
}

const EXTRACT_PROMPT = `Você é um extrator de comprovantes financeiros brasileiros (PIX, TED, DOC, boleto, cartão, recibos).
Extraia APENAS o que estiver visível. Retorne JSON estrito:
{
  "is_receipt": boolean,
  "type": "pix|ted|doc|boleto|card|deposit|withdrawal|invoice|other",
  "direction": "in|out|unknown",
  "amount": number|null,
  "date": "YYYY-MM-DD"|null,
  "time": "HH:MM"|null,
  "payer_name": string|null,
  "payer_doc": string|null,
  "receiver_name": string|null,
  "receiver_doc": string|null,
  "bank_or_institution": string|null,
  "transaction_id": string|null,
  "description": string|null,
  "confidence": number
}
Se não for comprovante, devolva is_receipt=false. Não invente dados.`;

async function callAI(messages: any[], options: any = {}): Promise<any> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", messages, ...options }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error("AI gateway: " + JSON.stringify(json));
  return json;
}

async function extractWithAI(bytes: Uint8Array, mime: string): Promise<{ data: any; raw: string; model: string }> {
  const b64 = btoa(String.fromCharCode(...bytes));
  const dataUrl = `data:${mime};base64,${b64}`;
  const json = await callAI([{
    role: "user",
    content: [
      { type: "text", text: EXTRACT_PROMPT },
      { type: "image_url", image_url: { url: dataUrl } },
    ],
  }], { response_format: { type: "json_object" } });
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  let data: any = {};
  try { data = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) data = JSON.parse(m[0]);
  }
  return { data, raw, model: "google/gemini-2.5-flash" };
}

async function categorizeEntry(
  supabase: any,
  direction: "in" | "out",
  ext: any,
  userCaption: string | null,
): Promise<{ category_id: string | null; category_name: string | null; confidence: number }> {
  const { data: cats } = await supabase.from("financial_categories")
    .select("id, name, parent_id, type")
    .eq("is_active", true)
    .eq("type", direction === "in" ? "income" : "expense");
  if (!cats || cats.length === 0) return { category_id: null, category_name: null, confidence: 0 };

  // build hierarchical labels
  const byId: Record<string, any> = Object.fromEntries(cats.map((c: any) => [c.id, c]));
  const labels = cats.map((c: any) => {
    const parent = c.parent_id ? byId[c.parent_id]?.name : null;
    return { id: c.id, label: parent ? `${parent} > ${c.name}` : c.name };
  });

  const prompt = `Você categoriza despesas/receitas de uma loja de calçados e acessórios (Banana Calçados).
Categorias disponíveis (escolha o ID mais específico possível, prefira subcategorias):
${labels.map((l) => `- ${l.id}: ${l.label}`).join("\n")}

Dados do comprovante: ${JSON.stringify(ext)}
Legenda do usuário (se houver): ${userCaption || "(nenhuma)"}

Retorne JSON: {"category_id": "<id>", "confidence": 0.0-1.0, "reasoning": "<curto>"}.
Se nenhuma encaixar, use {"category_id": null, "confidence": 0}.`;

  try {
    const json = await callAI([{ role: "user", content: prompt }], { response_format: { type: "json_object" } });
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const cat = parsed.category_id ? labels.find((l) => l.id === parsed.category_id) : null;
    return {
      category_id: cat?.id ?? null,
      category_name: cat?.label ?? null,
      confidence: Number(parsed.confidence) || 0,
    };
  } catch (e) {
    console.error("[categorize] failed", e);
    return { category_id: null, category_name: null, confidence: 0 };
  }
}

function fmtBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("iso-8859-1").decode(bytes);
  }
}

function normalize(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function extractStatementWithAI(text: string): Promise<{ transactions: any[]; bank_hint: string | null }> {
  const truncated = text.length > 60000 ? text.slice(0, 60000) : text;
  const prompt = `Você extrai transações de um extrato bancário brasileiro (CSV, OFX ou texto).
Retorne JSON estrito:
{
  "bank_hint": "<nome do banco/instituição se identificado, ex: Mercado Pago, Santander, Caixa, Itau, etc>" | null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "<descrição limpa>",
      "memo": "<info extra como id de referência>" | null,
      "amount": <number positivo>,
      "type": "credit" | "debit",
      "fitid": "<id único da transação se disponível>" | null
    }
  ]
}

Regras:
- "credit" = entrada (dinheiro entrou); "debit" = saída (dinheiro saiu).
- "amount" SEMPRE positivo. Use "type" pra direção.
- Ignore linhas de saldo, cabeçalhos, totalizadores.
- Datas brasileiras (DD-MM-YYYY ou DD/MM/YYYY) devem virar YYYY-MM-DD.
- Valores como "1.234,56" são R$ 1234.56.

Extrato:
\`\`\`
${truncated}
\`\`\``;

  const json = await callAI([{ role: "user", content: prompt }], {
    response_format: { type: "json_object" },
  });
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      bank_hint: parsed.bank_hint || null,
    };
  } catch {
    return { transactions: [], bank_hint: null };
  }
}

async function processBankStatement(
  supabase: any,
  bytes: Uint8Array,
  _mime: string,
  caption: string | null,
  chatId: string,
  receiptId: string,
) {
  await sendMessage(chatId, "📊 Lendo extrato bancário... isso pode levar alguns segundos.");

  const text = decodeText(bytes);
  const { data: accounts } = await supabase.from("bank_accounts").select("id, name");
  if (!accounts || accounts.length === 0) {
    await supabase.from("financial_agent_receipts").update({
      status: "failed", error: "Nenhuma conta bancária cadastrada",
    }).eq("id", receiptId);
    await sendMessage(chatId, "❌ Nenhuma conta bancária cadastrada no sistema. Cadastre antes de importar extratos.");
    return { ok: false };
  }

  // Extract transactions via AI
  const { transactions, bank_hint } = await extractStatementWithAI(text);

  if (!transactions.length) {
    await supabase.from("financial_agent_receipts").update({
      status: "failed", error: "Nenhuma transação extraída",
    }).eq("id", receiptId);
    await sendMessage(chatId, "🤔 Não consegui extrair transações desse arquivo. Verifique o formato.");
    return { ok: false };
  }

  // Match bank account: caption + bank_hint vs account names
  const searchStr = normalize(`${caption || ""} ${bank_hint || ""}`);
  const accountMatches = (accounts as any[]).map((a) => {
    const tokens = normalize(a.name).split(/\s+/).filter(Boolean);
    const score = tokens.reduce((acc, t) => acc + (searchStr.includes(t) ? 1 : 0), 0);
    return { ...a, score };
  }).sort((a, b) => b.score - a.score);

  const top = accountMatches[0];
  if (!top || top.score === 0) {
    await supabase.from("financial_agent_receipts").update({
      status: "failed",
      error: "Conta bancária não identificada",
      extracted: { transactions, bank_hint, caption },
    }).eq("id", receiptId);
    const list = (accounts as any[]).map((a) => `• ${a.name}`).join("\n");
    await sendMessage(chatId,
      `🏦 Extrato com ${transactions.length} transações lido, mas não identifiquei a conta. ` +
      `Reenvie com legenda contendo o nome da conta:\n\n${list}`);
    return { ok: false };
  }

  // Insert transactions
  const batchId = `tg_${receiptId}`;
  const rows = transactions
    .filter((t) => t.date && t.amount != null && t.description)
    .map((t) => ({
      bank_account_id: top.id,
      transaction_date: t.date,
      description: String(t.description).slice(0, 500),
      memo: t.memo ? String(t.memo).slice(0, 500) : null,
      amount: Math.abs(Number(t.amount)),
      type: t.type === "credit" ? "credit" : "debit",
      fitid: t.fitid ? String(t.fitid) : null,
      classification_status: "pending",
      import_batch_id: batchId,
    }));

  // Pre-dedupe against existing fitids for this account (partial unique index
  // on (bank_account_id, fitid) WHERE fitid IS NOT NULL can't be used by
  // PostgREST ON CONFLICT, so we filter manually).
  const incomingFitids = Array.from(new Set(rows.map((r) => r.fitid).filter(Boolean))) as string[];
  let existingFitids = new Set<string>();
  if (incomingFitids.length > 0) {
    const { data: existing } = await supabase
      .from("bank_transactions")
      .select("fitid")
      .eq("bank_account_id", top.id)
      .in("fitid", incomingFitids);
    existingFitids = new Set((existing || []).map((r: any) => r.fitid));
  }

  // Also dedupe within the batch by fitid (keep first occurrence)
  const seenInBatch = new Set<string>();
  const toInsert = rows.filter((r) => {
    if (!r.fitid) return true; // no fitid = always insert (rare)
    if (existingFitids.has(r.fitid)) return false;
    if (seenInBatch.has(r.fitid)) return false;
    seenInBatch.add(r.fitid);
    return true;
  });

  let inserted = 0;
  const insertedIds: string[] = [];
  const insertedRows: any[] = [];
  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100);
    const { data: ins, error } = await supabase
      .from("bank_transactions")
      .insert(chunk)
      .select("id, transaction_date, amount, type, description, memo, fitid");
    if (error) {
      console.error("[statement] insert error", error);
    } else if (ins) {
      inserted += ins.length;
      insertedIds.push(...ins.map((r: any) => r.id));
      insertedRows.push(...ins);
    }
  }

  // Mirror each bank_transaction into cash_flow_entries (ledger='realidade')
  // so they appear in the "Lançamentos" tab and update the account balance.
  if (insertedRows.length > 0) {
    const cfeRows = insertedRows.map((r: any) => ({
      bank_account_id: top.id,
      store_id: top.store_id || null,
      entry_date: r.transaction_date,
      direction: r.type === "credit" ? "in" : "out",
      amount: Math.abs(Number(r.amount)),
      description: r.description,
      source: "bank_statement",
      external_source: "ofx_import",
      external_id: r.id, // link 1:1 with bank_transactions.id
      bank_external_id: r.fitid || null,
      status: "pending_category",
      ledger: "realidade",
      metadata: { bank_transaction_id: r.id, memo: r.memo, batch: batchId },
    }));
    for (let i = 0; i < cfeRows.length; i += 100) {
      const chunk = cfeRows.slice(i, i + 100);
      const { error: cfeErr } = await supabase.from("cash_flow_entries").insert(chunk);
      if (cfeErr) console.error("[statement] cash_flow_entries insert error", cfeErr);
    }
  }

  await supabase.from("financial_agent_receipts").update({
    status: "linked",
    extracted: { bank_hint, account: top.name, count: transactions.length, inserted },
  }).eq("id", receiptId);

  // Kick off async AI classification (fire and forget)
  if (insertedIds.length > 0) {
    fetch(`${SUPABASE_URL}/functions/v1/ai-classify-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ transaction_ids: insertedIds }),
    }).catch((e) => console.error("[statement] classify dispatch failed", e));
  }


  const skipped = transactions.length - inserted;
  await sendMessage(chatId,
    `✅ <b>Extrato importado</b>\n` +
    `Conta: <b>${top.name}</b>\n` +
    `Transações novas: <b>${inserted}</b>\n` +
    (skipped > 0 ? `Duplicadas/ignoradas: ${skipped}\n` : "") +
    `\n🤖 Categorização automática em andamento. Revise no painel de Lançamentos.`);

  return { ok: true, inserted };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let receiptId: string | null = null;
  let chatId = "";

  try {
    const { chat_id, message_id, file_id, kind, caption } = await req.json();
    chatId = String(chat_id);
    const userCaption: string | null = caption || null;
    if (!chatId || !file_id) return new Response("missing args", { status: 400 });

    const { data: authUser } = await supabase
      .from("financial_agent_authorized_users")
      .select("chat_id, active").eq("chat_id", chatId).eq("active", true).maybeSingle();
    if (!authUser) return new Response("unauthorized", { status: 403 });

    await sendMessage(chatId, "🔍 Lendo o comprovante...");
    const { bytes, mime, path } = await downloadTelegramFile(file_id);

    const storagePath = `${chatId}/${Date.now()}-${path.split("/").pop()}`;
    await supabase.storage.from("financial-receipts").upload(storagePath, bytes, { contentType: mime, upsert: false });

    const { data: rcpt, error: rErr } = await supabase.from("financial_agent_receipts").insert({
      chat_id: chatId, telegram_message_id: message_id, telegram_file_id: file_id,
      mime_type: mime, storage_path: storagePath, status: "pending",
    }).select().single();
    if (rErr) throw rErr;
    receiptId = rcpt.id;

    if (mime === "application/pdf") {
      await supabase.from("financial_agent_receipts").update({
        status: "failed", error: "PDF processing pending implementation",
      }).eq("id", receiptId);
      await sendMessage(chatId, "📄 PDF recebido e salvo, mas o leitor de PDF ainda está em desenvolvimento. Envie como foto se possível.");
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    // Bank statement (CSV/TXT/OFX) — parse and bulk import into bank_transactions
    const isStatement = mime === "text/csv" || mime === "text/plain" || mime === "application/x-ofx"
      || path.toLowerCase().endsWith(".csv") || path.toLowerCase().endsWith(".ofx");
    if (isStatement) {
      const result = await processBankStatement(supabase, bytes, mime, userCaption, chatId, receiptId);
      return new Response(JSON.stringify(result), { headers: corsHeaders });
    }

    const { data: ext, raw, model } = await extractWithAI(bytes, mime);

    if (!ext.is_receipt) {
      await supabase.from("financial_agent_receipts").update({
        status: "ignored", extracted: ext, ai_raw: raw, ai_model: model,
      }).eq("id", receiptId);
      await sendMessage(chatId, "🤔 Não identifiquei um comprovante nessa imagem. Reenvie mais nítida?");
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    const amount: number | null = typeof ext.amount === "number" ? ext.amount : Number(ext.amount) || null;
    const dateStr: string | null = ext.date;
    const direction: "in" | "out" = ext.direction === "out" ? "out" : "in";

    // duplicate check
    let duplicateOf: string | null = null;
    if (amount && dateStr) {
      const { data: dup } = await supabase
        .from("cash_flow_entries")
        .select("id")
        .eq("direction", direction)
        .gte("amount", amount - 0.01).lte("amount", amount + 0.01)
        .gte("entry_date", new Date(new Date(dateStr).getTime() - 86400000).toISOString().slice(0, 10))
        .lte("entry_date", new Date(new Date(dateStr).getTime() + 86400000).toISOString().slice(0, 10))
        .limit(1);
      if (dup && dup.length > 0) duplicateOf = dup[0].id;
    }

    if (duplicateOf) {
      await supabase.from("financial_agent_receipts").update({
        status: "duplicate", duplicate_of: duplicateOf, extracted: ext, ai_raw: raw, ai_model: model,
      }).eq("id", receiptId);
      await sendMessage(chatId,
        `⚠️ <b>Possível duplicidade</b>\n${fmtBRL(amount!)} em ${dateStr} já consta. Não foi lançado de novo.`);
      return new Response(JSON.stringify({ ok: true, duplicate: true }), { headers: corsHeaders });
    }

    // auto-categorize
    const cat = await categorizeEntry(supabase, direction, ext, userCaption);

    // description: prefer user caption, else extract description, else generic
    const desc = userCaption?.trim()
      || ext.description
      || `${(ext.type || "comprovante").toUpperCase()}${ext.payer_name ? " — " + ext.payer_name : ""}${ext.receiver_name ? " → " + ext.receiver_name : ""}`;

    const { data: entry, error: eErr } = await supabase.from("cash_flow_entries").insert({
      entry_date: dateStr || new Date().toISOString().slice(0, 10),
      direction,
      amount: amount ?? 0,
      description: desc,
      payment_method: ext.type || null,
      category_id: cat.category_id,
      source: "telegram_receipt",
      external_source: "telegram_receipt",
      external_id: receiptId,
      status: cat.category_id && cat.confidence >= 0.7 ? "confirmed" : "pending_category",
      confidence: cat.confidence || (ext.confidence ?? 0.5),
      attachment_url: storagePath,
      metadata: { extracted: ext, user_caption: userCaption, category_reasoning: cat },
    }).select().single();
    if (eErr) throw eErr;

    await supabase.from("financial_agent_receipts").update({
      status: "linked", cash_flow_entry_id: entry.id, extracted: ext, ai_raw: raw, ai_model: model,
    }).eq("id", receiptId);

    const catLine = cat.category_name
      ? `Categoria: <b>${cat.category_name}</b>${cat.confidence < 0.7 ? " (revisar)" : ""}\n`
      : "Categoria: <i>pendente — revise no painel</i>\n";

    const baseMsg = `✅ <b>Lançado</b>\n` +
      `${direction === "in" ? "Entrada" : "Saída"}: <b>${amount ? fmtBRL(amount) : "?"}</b>\n` +
      `Data: ${dateStr ?? "?"}\n` +
      catLine +
      (userCaption ? `📝 Obs: ${userCaption}\n` : "");

    if (!userCaption) {
      // ask for observation
      await supabase.from("financial_agent_sessions").upsert({
        chat_id: Number(chatId),
        expected_action: `awaiting_description:${entry.id}`,
        updated_at: new Date().toISOString(),
      });
      await sendMessage(chatId, baseMsg + `\n💬 Quer adicionar uma observação? (responda com o texto, ou /skip)`);
    } else {
      await sendMessage(chatId, baseMsg);
    }

    return new Response(JSON.stringify({ ok: true, entry_id: entry.id }), { headers: corsHeaders });
  } catch (e) {
    console.error("[process-attachment]", e);
    if (receiptId) {
      await supabase.from("financial_agent_receipts").update({
        status: "failed", error: String((e as Error).message ?? e),
      }).eq("id", receiptId);
    }
    if (chatId) await sendMessage(chatId, "❌ Falha ao processar: " + String((e as Error).message ?? e));
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
