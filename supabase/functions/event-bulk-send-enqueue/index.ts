// Envio em massa de Template API / Cross-sell por etapa do Kanban (Eventos).
// Resolve variáveis por destinatário, aplica supressões (bloqueio, opt-out,
// chargeback), anti-duplicidade e instância vinculada; grava a fila e
// dispara o worker. `dry_run` devolve só o planejamento (tela de revisão).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { loadBlockedSuffixes, isBlocked, phoneKey } from "../_shared/blocked-guard.ts";
import { issueMagicLink } from "../_shared/member-magic-link.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RecipientIn {
  order_id?: string | null;
  phone: string;
  customer_name?: string | null;
  vars?: Record<string, string>; // nome, instagram, valor_compra, qtd_itens, primeiro_produto, link_checkout ...
}

interface Body {
  event_id: string;
  kind: "template" | "crossell";
  template_name: string;
  template_language?: string;
  template_label?: string;
  whatsapp_number_id?: string | null; // instância selecionada / do template
  stages?: string[];
  allow_resend?: boolean;
  variable_map?: Record<string, unknown>;
  base_components?: unknown[]; // textos podem conter {{var:chave}}
  recipients: RecipientIn[];
  dry_run?: boolean;
  created_by_name?: string | null;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TOKEN_RE = /\{\{\s*var:([a-z_0-9]+)\s*\}\}/gi;

function collectTokens(node: unknown, out: Set<string>) {
  if (typeof node === "string") {
    for (const m of node.matchAll(TOKEN_RE)) out.add(m[1].toLowerCase());
  } else if (Array.isArray(node)) node.forEach((n) => collectTokens(n, out));
  else if (node && typeof node === "object") Object.values(node as Record<string, unknown>).forEach((v) => collectTokens(v, out));
}

function substitute(node: unknown, vars: Record<string, string>): unknown {
  if (typeof node === "string") {
    return node.replace(TOKEN_RE, (_m, k: string) => vars[k.toLowerCase()] ?? "");
  }
  if (Array.isArray(node)) return node.map((n) => substitute(n, vars));
  if (node && typeof node === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) o[k] = substitute(v, vars);
    return o;
  }
  return node;
}

function normPhone(p: string): string {
  let d = (p || "").replace(/\D/g, "");
  if (!d) return "";
  if (!d.startsWith("55")) d = "55" + d;
  // injeta 9º dígito em celular BR de 12 dígitos
  if (d.length === 12) d = d.slice(0, 4) + "9" + d.slice(4);
  return d;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Usuário autenticado (uso interno)
    const authHeader = req.headers.get("Authorization") || "";
    let userId: string | null = null;
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (token !== SERVICE_KEY) {
        const { data } = await supabase.auth.getUser(token);
        userId = data?.user?.id || null;
        if (!userId) return json({ error: "unauthorized" }, 401);
      }
    } else {
      return json({ error: "unauthorized" }, 401);
    }

    const body = (await req.json()) as Body;
    if (!body?.event_id || !body.kind || !body.template_name || !Array.isArray(body.recipients) || body.recipients.length === 0) {
      return json({ error: "event_id, kind, template_name e recipients são obrigatórios" }, 400);
    }
    if (body.recipients.length > 2000) return json({ error: "máximo de 2000 destinatários por disparo" }, 400);

    const baseComponents = Array.isArray(body.base_components) ? body.base_components : [];
    const tokens = new Set<string>();
    collectTokens(baseComponents, tokens);
    const needsMagicLink = tokens.has("link_area_membros");

    // Dedupe por telefone dentro da própria lista
    const seen = new Set<string>();
    const recipients: RecipientIn[] = [];
    for (const r of body.recipients) {
      const p = normPhone(r.phone);
      if (!p) continue;
      const k = phoneKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      recipients.push({ ...r, phone: p });
    }

    // Supressões
    const blocked = await loadBlockedSuffixes(supabase);

    // Já recebeu este template neste evento?
    let alreadyKeys = new Set<string>();
    if (!body.allow_resend) {
      const { data: prevSends } = await supabase
        .from("event_bulk_sends")
        .select("id")
        .eq("event_id", body.event_id)
        .eq("template_name", body.template_name);
      const ids = (prevSends || []).map((s: { id: string }) => s.id);
      if (ids.length > 0) {
        const { data: prevItems } = await supabase
          .from("event_bulk_send_items")
          .select("phone")
          .in("send_id", ids)
          .eq("status", "sent");
        alreadyKeys = new Set((prevItems || []).map((i: { phone: string }) => phoneKey(i.phone)));
      }
    }

    // Instância vinculada por telefone (regra telefone+instância)
    const phones = recipients.map((r) => r.phone);
    const boundByKey = new Map<string, string>();
    for (let i = 0; i < phones.length; i += 200) {
      const chunk = phones.slice(i, i + 200);
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("phone, whatsapp_number_id, created_at")
        .in("phone", chunk)
        .not("whatsapp_number_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(chunk.length * 5);
      for (const m of data || []) {
        const k = phoneKey((m as { phone: string }).phone);
        if (!boundByKey.has(k)) boundByKey.set(k, (m as { whatsapp_number_id: string }).whatsapp_number_id);
      }
    }

    const selectedInstance = body.whatsapp_number_id || null;

    type Planned = {
      order_id: string | null;
      phone: string;
      customer_name: string | null;
      whatsapp_number_id: string | null;
      components: unknown[];
      status: "pending" | "skipped";
      reason: string | null;
    };

    const planned: Planned[] = await mapLimit(recipients, 8, async (r) => {
      const k = phoneKey(r.phone);
      const base: Planned = {
        order_id: r.order_id || null,
        phone: r.phone,
        customer_name: r.customer_name || null,
        whatsapp_number_id: null,
        components: [],
        status: "pending",
        reason: null,
      };
      if (isBlocked(blocked, r.phone)) return { ...base, status: "skipped", reason: "bloqueado / opt-out" };
      if (alreadyKeys.has(k)) return { ...base, status: "skipped", reason: "já recebeu este template neste evento" };

      // Chargeback
      try {
        const { data: gate } = await supabase.rpc("chargeback_gate", { p_phone: r.phone });
        if (gate && (gate as { blocked?: boolean }).blocked) {
          return { ...base, status: "skipped", reason: "risco de chargeback" };
        }
      } catch (_e) { /* fail-open */ }

      const bound = boundByKey.get(k) || null;
      const instance = bound || selectedInstance;
      if (!instance) return { ...base, status: "skipped", reason: "sem instância" };
      if (selectedInstance && bound && bound !== selectedInstance) {
        return { ...base, whatsapp_number_id: bound, status: "skipped", reason: "instância diferente da do template" };
      }

      const vars: Record<string, string> = { telefone: r.phone, ...(r.vars || {}) };
      Object.keys(vars).forEach((key) => { vars[key.toLowerCase()] = String(vars[key] ?? ""); });
      if (needsMagicLink && !body.dry_run) {
        try { vars["link_area_membros"] = await issueMagicLink(supabase, r.phone); } catch (_e) { vars["link_area_membros"] = ""; }
      } else if (needsMagicLink) {
        vars["link_area_membros"] = "https://checkout.bananacalcados.com.br/minha-area?ml=…";
      }

      const components = substitute(baseComponents, vars) as unknown[];
      return { ...base, whatsapp_number_id: instance, components };
    });

    const summary = {
      total: planned.length,
      ready: planned.filter((p) => p.status === "pending").length,
      skipped: planned.filter((p) => p.status === "skipped").length,
      reasons: planned.reduce<Record<string, number>>((acc, p) => {
        if (p.reason) acc[p.reason] = (acc[p.reason] || 0) + 1;
        return acc;
      }, {}),
    };

    if (body.dry_run) {
      return json({
        ok: true,
        summary,
        items: planned.map((p) => ({ order_id: p.order_id, phone: p.phone, customer_name: p.customer_name, status: p.status, reason: p.reason, whatsapp_number_id: p.whatsapp_number_id })),
        sample: planned.find((p) => p.status === "pending")?.components || null,
      });
    }

    if (summary.ready === 0) return json({ error: "Nenhum destinatário apto para envio", summary }, 400);

    const { data: send, error: sendErr } = await supabase
      .from("event_bulk_sends")
      .insert({
        event_id: body.event_id,
        kind: body.kind,
        template_name: body.template_name,
        template_language: body.template_language || "pt_BR",
        template_label: body.template_label || null,
        whatsapp_number_id: selectedInstance,
        stages: body.stages || [],
        variable_map: body.variable_map || {},
        base_components: baseComponents,
        allow_resend: !!body.allow_resend,
        status: "queued",
        total_count: planned.length,
        skipped_count: summary.skipped,
        created_by: userId,
        created_by_name: body.created_by_name || null,
      })
      .select("id")
      .single();
    if (sendErr || !send) throw new Error(sendErr?.message || "falha ao criar disparo");

    const rows = planned.map((p) => ({
      send_id: send.id,
      order_id: p.order_id,
      phone: p.phone,
      customer_name: p.customer_name,
      whatsapp_number_id: p.whatsapp_number_id,
      components: p.components,
      status: p.status,
      reason: p.reason,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("event_bulk_send_items").insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    // Dispara o worker imediatamente (cron cobre o restante)
    fetch(`${SUPABASE_URL}/functions/v1/event-bulk-send-worker`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ send_id: send.id }),
    }).catch(() => {});

    return json({ ok: true, send_id: send.id, summary });
  } catch (e) {
    console.error("[event-bulk-send-enqueue]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
