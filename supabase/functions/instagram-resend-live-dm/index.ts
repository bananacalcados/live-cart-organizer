import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_API = "https://graph.instagram.com/v25.0";

interface DmButton {
  label: string;
  type: "link" | "reply";
  url?: string | null;
  tags?: string[];
  reply_message?: string | null;
  flow_id?: string | null;
}

function buildButtonPayload(ruleId: string, buttons: DmButton[]): any[] {
  const out: any[] = [];
  (buttons || []).slice(0, 3).forEach((b, idx) => {
    if (!b?.label) return;
    if (b.type === "link" && b.url) {
      out.push({ type: "web_url", url: b.url, title: b.label.slice(0, 20) });
    } else if (b.type === "reply") {
      out.push({ type: "postback", title: b.label.slice(0, 20), payload: `igbtn:${ruleId}:${idx}` });
    }
  });
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Auth: require an authenticated user (internal admin tool) ──
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Sessão inválida" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = Deno.env.get("META_PAGE_ACCESS_TOKEN");
    if (!token) {
      return new Response(JSON.stringify({ error: "META_PAGE_ACCESS_TOKEN not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const ruleId: string = body.ruleId || "6b31218c-2dd6-43c3-bfc0-f6c1a4013813";
    const hoursBack: number = Math.min(Math.max(Number(body.hoursBack) || 12, 1), 72);
    // Prefixo da mensagem ERRADA usado para localizar quem recebeu.
    const wrongPrefix: string = body.wrongPrefix ||
      "Oii, que legal que quer participar da Live! Pra receber";
    const dryRun: boolean = body.dryRun !== false; // default true (segurança)
    const delayMs: number = Math.min(Math.max(Number(body.delayMs) || 5000, 1500), 30000);

    // ── Mensagem CORRETA: vem da regra atual ──
    const { data: rule, error: ruleErr } = await supabase
      .from("instagram_comment_rules")
      .select("id, name, dm_message_text, dm_buttons")
      .eq("id", ruleId)
      .maybeSingle();

    if (ruleErr || !rule) {
      return new Response(JSON.stringify({ error: "Regra não encontrada", details: ruleErr }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const correctText: string = body.correctText || rule.dm_message_text;
    if (!correctText) {
      return new Response(JSON.stringify({ error: "Regra sem mensagem configurada" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Localizar destinatários que receberam a mensagem ERRADA na janela ──
    const sinceIso = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    const { data: rows, error: rowsErr } = await supabase
      .from("whatsapp_messages")
      .select("phone, sender_name, created_at")
      .eq("channel", "instagram")
      .eq("direction", "outgoing")
      .like("message", `${wrongPrefix}%`)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false });

    if (rowsErr) {
      return new Response(JSON.stringify({ error: "Falha ao buscar destinatários", details: rowsErr }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Dedup por phone (igsid); manter username não-nulo mais recente
    const map = new Map<string, { phone: string; username: string | null; last: string }>();
    for (const r of rows || []) {
      const phone = String(r.phone || "");
      if (!/^\d+$/.test(phone)) continue; // só ids numéricos do IG (igsid)
      const existing = map.get(phone);
      if (!existing) {
        map.set(phone, { phone, username: r.sender_name || null, last: r.created_at });
      } else if (!existing.username && r.sender_name) {
        existing.username = r.sender_name;
      }
    }
    let recipients = Array.from(map.values());

    // Pular quem JÁ recebeu a correção com sucesso (evita duplicar)
    const { data: alreadySent } = await supabase
      .from("instagram_comment_actions")
      .select("comment_id")
      .eq("rule_id", rule.id)
      .eq("action_type", "dm_resend")
      .eq("status", "sent");
    const sentSet = new Set((alreadySent || []).map((a: any) => String(a.comment_id)));
    const skipped = recipients.filter((r) => sentSet.has(r.phone)).map((r) => r.username);
    recipients = recipients.filter((r) => !sentSet.has(r.phone));

    if (dryRun) {
      return new Response(JSON.stringify({
        dryRun: true,
        rule: rule.name,
        hoursBack,
        wrongPrefix,
        correctTextPreview: correctText.slice(0, 120),
        totalRecipients: recipients.length,
        alreadySentSkipped: skipped,
        recipients: recipients.map((r) => ({ username: r.username, igsid: r.phone, last: r.last })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Envio real, aos poucos ──
    const dmButtons = buildButtonPayload(rule.id, (rule.dm_buttons as DmButton[]) || []);
    const messagePayload = dmButtons.length > 0
      ? {
          attachment: {
            type: "template",
            payload: { template_type: "button", text: correctText.slice(0, 640), buttons: dmButtons },
          },
        }
      : { text: correctText };

    const results: any[] = [];
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i++) {
      const rcpt = recipients[i];
      try {
        const res = await fetch(`${META_API}/me/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: rcpt.phone },
            message: messagePayload,
            messaging_type: "RESPONSE",
          }),
        });
        const data = await res.json();
        if (res.ok) {
          sent++;
          results.push({ username: rcpt.username, igsid: rcpt.phone, status: "sent", message_id: data.message_id });

          // Espelhar no histórico do chat
          await supabase.from("whatsapp_messages").insert({
            phone: rcpt.phone,
            message: correctText,
            direction: "outgoing",
            channel: "instagram",
            status: "sent",
            message_id: data.message_id || null,
            sender_name: rcpt.username,
            media_type: "text",
            is_group: false,
            source: "resend_correction",
          });

          // Log da ação
          await supabase.from("instagram_comment_actions").insert({
            comment_id: rcpt.phone,
            rule_id: rule.id,
            action_type: "dm_resend",
            status: "sent",
          });
        } else {
          failed++;
          console.warn(`[ig-resend] falha @${rcpt.username} (${rcpt.phone}):`, JSON.stringify(data));
          results.push({ username: rcpt.username, igsid: rcpt.phone, status: "error", error: data?.error?.message || JSON.stringify(data) });
          await supabase.from("instagram_comment_actions").insert({
            comment_id: rcpt.phone,
            rule_id: rule.id,
            action_type: "dm_resend",
            status: "error",
            error_message: JSON.stringify(data),
          });
        }
      } catch (e: any) {
        failed++;
        results.push({ username: rcpt.username, igsid: rcpt.phone, status: "error", error: e?.message });
      }

      // Throttle entre envios (não dorme após o último)
      if (i < recipients.length - 1) await sleep(delayMs);
    }

    return new Response(JSON.stringify({
      dryRun: false,
      rule: rule.name,
      totalRecipients: recipients.length,
      sent,
      failed,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[ig-resend] error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
