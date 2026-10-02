// Link de Atendimento dos Grupos VIP: /vip-go/CODE ou ?c=CODE → 302 wa.me
// Motor independente da Live (/zap) e do redirect de grupo (/vip).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const BOT_RE = /whatsapp|facebookexternalhit|bot|crawler|preview|curl/i;

const rpc = (fn: string, body: unknown) =>
  fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(body) });

function normPhone(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? "55" + d : d;
}

function notFound() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Link não encontrado</title><body style="font-family:sans-serif;text-align:center;padding:60px 20px"><h2>Link não encontrado</h2></body>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const seg = url.pathname.split("/").filter(Boolean).pop() || "";
  const code = (url.searchParams.get("c") || (seg !== "vip-go" ? seg : "")).trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return notFound();

  const r = await rpc("vip_link_resolve", { p_code: code });
  const rows = r.ok ? await r.json() : [];
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return notFound();

  let phone = row.phone_display;
  if (row.provider === "wasender" && !String(phone || "").replace(/\D/g, "")) phone = row.wasender_phone_number;
  if (!String(phone || "").replace(/\D/g, "")) phone = row.uazapi_owner || row.wasender_phone_number;
  const to = normPhone(phone);

  const ua = req.headers.get("user-agent") || "";
  const track = rpc("vip_link_register_click", {
    p_link_id: row.link_id, p_code: code, p_group: row.group_db_id, p_campaign: row.campaign_id,
    p_ua: ua, p_is_bot: BOT_RE.test(ua), p_dest: row.dest_number_id,
  }).catch((e) => console.error("click log failed", e));
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(track);

  const target = to
    ? `https://wa.me/${to}?text=${encodeURIComponent(row.message_text)}`
    : `https://wa.me/?text=${encodeURIComponent(row.message_text)}`;
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store" } });
});
