// deno-lint-ignore-file no-explicit-any
// Avisos automáticos na live do Instagram quando um carrinho é montado no Eventos.
// Fila: ig_live_cart_notifications (preenchida por trigger em orders).
// Ordem de envio: comentário público na live -> resposta ao último comentário dela -> direct (private reply).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { globalIgToken } from "../_shared/instagram-account.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const HOSTS = ["https://graph.instagram.com/v25.0", "https://graph.facebook.com/v25.0"];
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function g(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const t = await r.text();
  let d: any = null;
  try { d = JSON.parse(t); } catch { /* */ }
  return { ok: r.ok && !d?.error, status: r.status, d, err: d?.error?.message || t.slice(0, 200) };
}

function render(tpl: string, handle: string) {
  let m = tpl.replace(/\{\{\s*(arroba|instagram|usuario)\s*\}\}/gi, `@${handle}`);
  if (!m.includes(`@${handle}`)) m = `@${handle} ${m}`;
  return m.trim();
}

async function findLive(accounts: any[]) {
  for (const a of accounts) {
    const token = a.access_token || globalIgToken();
    for (const h of HOSTS) {
      for (const p of [`/${a.instagram_account_id}/live_media`, "/me/live_media"]) {
        const r = await g(`${h}${p}?fields=id&limit=1&access_token=${encodeURIComponent(token)}`);
        const id = r.ok ? r.d?.data?.[0]?.id : null;
        if (id) return { mediaId: id, token };
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const secret = req.headers.get("x-cron-secret");
  const { data: s } = await sb.from("internal_function_secrets").select("value").eq("key", "cron_secret").maybeSingle();
  if (!secret || secret !== s?.value) return json({ error: "unauthorized" }, 401);

  const started = Date.now();
  const results: any[] = [];
  let live: { mediaId: string; token: string } | null | undefined;
  let accounts: any[] | null = null;

  while (Date.now() - started < 50_000) {
    const { data: jobs } = await sb.rpc("claim_ig_live_cart_notifications", { p_limit: 3 });
    if (!jobs?.length) { await new Promise((r) => setTimeout(r, 4000)); continue; }

    if (!accounts) {
      const { data } = await sb.from("whatsapp_numbers")
        .select("id, instagram_account_id, access_token").eq("provider", "instagram").eq("is_active", true)
        .not("instagram_account_id", "is", null);
      accounts = data || [];
    }
    if (live === undefined) live = await findLive(accounts);

    for (const job of jobs as any[]) {
      const fail = async (error: string) => {
        await sb.from("ig_live_cart_notifications").update({ status: "failed", error }).eq("id", job.id);
        results.push({ id: job.id, error });
      };
      // pedido ainda válido?
      const { data: order } = await sb.from("orders").select("stage, phone_last4").eq("id", job.order_id).maybeSingle();
      if (!order || ["cancelled", "paid", "completed", "shipped"].includes(order.stage)) { await fail("pedido não está mais aberto"); continue; }
      if (job.kind === "live_cart_missing_last4" && /^\d{4}$/.test(order.phone_last4 || "")) {
        await sb.from("ig_live_cart_notifications").update({ status: "skipped", error: "4 dígitos já preenchidos" }).eq("id", job.id);
        continue;
      }
      const { data: rule } = await sb.from("instagram_comment_rules")
        .select("reply_comment_text, reply_comment_variations, is_active").eq("id", job.rule_id).maybeSingle();
      if (!rule?.is_active) { await fail("automação desativada"); continue; }
      const pool = [rule.reply_comment_text, ...(rule.reply_comment_variations || [])].filter((t: any) => t && String(t).trim());
      if (!pool.length) { await fail("automação sem texto"); continue; }
      const message = render(pool[Math.floor(Math.random() * pool.length)], job.instagram_handle);

      if (!live) { await fail("nenhuma live no ar no Instagram"); continue; }
      const token = live.token;
      const errs: string[] = [];
      let channel: string | null = null;

      // 1) comentário público na live
      for (const h of HOSTS) {
        const r = await g(`${h}/${live.mediaId}/comments?message=${encodeURIComponent(message)}&access_token=${encodeURIComponent(token)}`, { method: "POST" });
        if (r.ok) { channel = "live_comment"; break; }
        errs.push(`comentário: ${r.err}`);
      }
      // último comentário dela nesta live
      let commentId: string | null = null;
      if (!channel) {
        const { data: c } = await sb.from("live_comments").select("comment_id")
          .eq("event_id", job.event_id).ilike("username", job.instagram_handle)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        commentId = c?.comment_id && /^\d+$/.test(c.comment_id) ? c.comment_id : null;
      }
      // 2) resposta ao comentário dela
      if (!channel && commentId) {
        const r = await g(`${HOSTS[0]}/${commentId}/replies?message=${encodeURIComponent(message)}&access_token=${encodeURIComponent(token)}`, { method: "POST" });
        if (r.ok) channel = "comment_reply"; else errs.push(`resposta: ${r.err}`);
      }
      // 3) direct (resposta privada ao comentário)
      if (!channel && commentId) {
        const r = await g(`${HOSTS[0]}/me/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: message } }),
        });
        if (r.ok) channel = "private_reply"; else errs.push(`direct: ${r.err}`);
      }
      if (!channel && !commentId) errs.push("cliente ainda não comentou nesta live (sem direct possível)");

      if (channel) {
        await sb.from("ig_live_cart_notifications").update({ status: "sent", channel, message, sent_at: new Date().toISOString(), error: errs.join(" | ") || null }).eq("id", job.id);
        results.push({ id: job.id, channel });
      } else {
        await sb.from("ig_live_cart_notifications").update({ message }).eq("id", job.id);
        await fail(errs.join(" | ").slice(0, 900));
      }
    }
  }
  return json({ ok: true, results });
});
