// Roleta de Prêmios do Evento (público).
// Dois públicos: "payers" (quem pagou no evento, acima de X) e "participants" (leads da live).
// Regras: evento precisa estar ativo/dentro da janela, roleta ativa, 1 giro por telefone (configurável),
// e OTP no WhatsApp para participantes quando exigido.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function normalizePhone(input: string): string | null {
  let d = String(input || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55")) d = d.slice(2);
  if (d.length === 10) d = d.slice(0, 2) + "9" + d.slice(2);
  if (d.length !== 11) return null;
  return "55" + d;
}
const suffix8 = (p: string) => String(p || "").replace(/\D/g, "").slice(-8);

function couponCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "RL-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const phone = normalizePhone(body?.phone || "");

    /** Evento corrente: o mesmo critério do link único da área de membros. */
    async function resolveEvent(eventId?: string | null) {
      if (eventId) {
        const { data } = await supabase
          .from("events")
          .select("id, name, is_active, is_live_broadcasting, start_date, end_date")
          .eq("id", eventId)
          .maybeSingle();
        return data || null;
      }
      const base = () =>
        supabase
          .from("events")
          .select("id, name, is_active, is_live_broadcasting, start_date, end_date")
          .neq("is_active", false);
      const { data: live } = await base()
        .eq("is_live_broadcasting", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (live?.[0]) return live[0];
      const { data: latest } = await base().order("created_at", { ascending: false }).limit(1);
      return latest?.[0] || null;
    }

    /** Evento encerrado? (inativo ou data final no passado) */
    function eventClosed(ev: any) {
      if (!ev) return true;
      if (ev.is_active === false) return true;
      if (ev.end_date && new Date(ev.end_date) < new Date()) return true;
      return false;
    }

    function wheelOpen(w: any) {
      const now = Date.now();
      if (!w.is_active) return false;
      if (w.starts_at && new Date(w.starts_at).getTime() > now) return false;
      if (w.ends_at && new Date(w.ends_at).getTime() < now) return false;
      return true;
    }

    /** Total pago pela cliente neste evento (para roleta de pagadores). */
    async function paidTotalInEvent(eventId: string, ph: string) {
      const suf = suffix8(ph);
      const { data: customers } = await supabase
        .from("customers")
        .select("id")
        .not("whatsapp", "is", null)
        .ilike("whatsapp", `%${suf}`);
      const ids = (customers || []).map((c: any) => c.id);
      if (!ids.length) return 0;
      const { data: orders } = await supabase
        .from("orders")
        .select("products, shipping_cost, is_paid")
        .eq("event_id", eventId)
        .in("customer_id", ids)
        .eq("is_paid", true);
      return (orders || []).reduce((sum: number, o: any) => {
        const items = Array.isArray(o.products) ? o.products : [];
        return (
          sum +
          items.reduce(
            (s: number, p: any) => s + Number(p.price || 0) * Number(p.quantity || 1),
            0,
          )
        );
      }, 0);
    }

    async function spinsUsed(wheelId: string, ph: string) {
      const { count } = await supabase
        .from("event_prize_spins")
        .select("id", { count: "exact", head: true })
        .eq("wheel_id", wheelId)
        .eq("phone", ph);
      return count || 0;
    }

    async function otpVerified(ph: string) {
      const { data } = await supabase
        .from("live_phone_verifications")
        .select("id, verified, expires_at, created_at")
        .eq("phone", ph)
        .eq("verified", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return false;
      // Verificação vale por 2 horas
      return new Date(data.created_at).getTime() > Date.now() - 2 * 60 * 60_000;
    }

    // ---------- LIST ----------
    if (action === "list") {
      const ev = await resolveEvent(body?.event_id);
      if (!ev) return json({ ok: true, event: null, wheels: [] });

      const { data: wheels } = await supabase
        .from("event_prize_wheels")
        .select("*, segments:event_prize_wheel_segments(*)")
        .eq("event_id", ev.id)
        .eq("is_active", true);

      const closed = eventClosed(ev);
      const out: any[] = [];

      for (const w of wheels || []) {
        if (!wheelOpen(w)) continue;
        const segments = (w.segments || [])
          .filter((s: any) => s.is_active)
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((s: any) => ({ id: s.id, label: s.label, color: s.color }));
        if (segments.length < 2) continue;

        let eligible = !closed;
        let reason: string | null = closed ? "Este evento já foi encerrado." : null;
        let paidTotal = 0;
        let used = 0;

        if (phone) {
          used = await spinsUsed(w.id, phone);
          if (eligible && used >= w.max_spins_per_customer) {
            eligible = false;
            reason = "Você já girou esta roleta.";
          }
          if (eligible && w.audience === "payers") {
            paidTotal = await paidTotalInEvent(ev.id, phone);
            if (paidTotal <= 0) {
              eligible = false;
              reason = "Esta roleta é exclusiva para quem comprou neste evento.";
            } else if (paidTotal < Number(w.min_purchase_value || 0)) {
              eligible = false;
              reason = `Compre a partir de R$ ${Number(w.min_purchase_value).toFixed(2)} neste evento para girar.`;
            }
          }
        } else if (w.audience === "payers") {
          eligible = false;
          reason = "Identifique-se para verificar sua compra.";
        }

        out.push({
          id: w.id,
          name: w.name,
          audience: w.audience,
          min_purchase_value: Number(w.min_purchase_value || 0),
          require_otp: !!w.require_otp && w.audience === "participants",
          otp_verified: phone ? await otpVerified(phone) : false,
          spins_used: used,
          max_spins: w.max_spins_per_customer,
          eligible,
          reason,
          segments,
        });
      }

      return json({
        ok: true,
        event: { id: ev.id, name: ev.name, closed },
        wheels: out,
      });
    }

    // ---------- SEND OTP ----------
    if (action === "send_otp") {
      if (!phone) return json({ ok: false, error: "Telefone inválido" }, 400);
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/live-send-verification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        return json({ ok: false, error: data?.error || "Falha ao enviar código" }, 500);
      }
      return json({ ok: true });
    }

    // ---------- VERIFY OTP ----------
    if (action === "verify_otp") {
      if (!phone) return json({ ok: false, error: "Telefone inválido" }, 400);
      const code = String(body?.code || "").replace(/\D/g, "");
      const { data: rec } = await supabase
        .from("live_phone_verifications")
        .select("id, code, expires_at")
        .eq("phone", phone)
        .eq("verified", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!rec) return json({ ok: false, error: "Código não encontrado. Solicite um novo." });
      if (new Date(rec.expires_at) < new Date()) return json({ ok: false, error: "Código expirado." });
      if (rec.code !== code) return json({ ok: false, error: "Código incorreto." });
      await supabase.from("live_phone_verifications").update({ verified: true }).eq("id", rec.id);
      return json({ ok: true });
    }

    // ---------- SPIN ----------
    if (action === "spin") {
      if (!phone) return json({ ok: false, error: "Telefone inválido" });
      const wheelId = String(body?.wheel_id || "");
      const name = String(body?.name || "").trim().slice(0, 120) || null;

      const { data: wheel } = await supabase
        .from("event_prize_wheels")
        .select("*, segments:event_prize_wheel_segments(*)")
        .eq("id", wheelId)
        .maybeSingle();
      if (!wheel) return json({ ok: false, error: "Roleta não encontrada" });
      if (!wheelOpen(wheel)) return json({ ok: false, error: "Esta roleta não está ativa." });

      const ev = await resolveEvent(wheel.event_id);
      if (eventClosed(ev)) return json({ ok: false, error: "Este evento já foi encerrado." });

      if ((await spinsUsed(wheel.id, phone)) >= wheel.max_spins_per_customer) {
        return json({ ok: false, error: "Você já girou esta roleta." });
      }

      if (wheel.audience === "payers") {
        const total = await paidTotalInEvent(wheel.event_id, phone);
        if (total <= 0) {
          return json({ ok: false, error: "Esta roleta é exclusiva para quem comprou neste evento." });
        }
        if (total < Number(wheel.min_purchase_value || 0)) {
          return json({
            ok: false,
            error: `Esta roleta exige compras a partir de R$ ${Number(wheel.min_purchase_value).toFixed(2)} neste evento.`,
          });
        }
      } else if (wheel.require_otp && !(await otpVerified(phone))) {
        return json({ ok: false, error: "otp_required" });
      }

      const segments = (wheel.segments || [])
        .filter((s: any) => s.is_active)
        .sort((a: any, b: any) => a.sort_order - b.sort_order);
      if (segments.length < 2) return json({ ok: false, error: "Roleta sem prêmios configurados" });

      // Sorteio ponderado no servidor (o front só anima até o índice retornado)
      const total = segments.reduce((s: number, x: any) => s + Number(x.probability || 0), 0) || 1;
      let r = Math.random() * total;
      let idx = segments.length - 1;
      for (let i = 0; i < segments.length; i++) {
        r -= Number(segments[i].probability || 0);
        if (r <= 0) {
          idx = i;
          break;
        }
      }
      const winner = segments[idx];

      // Lead no CRM (captação da live)
      try {
        await supabase.rpc("find_or_create_unified_customer", {
          p_phone: phone,
          p_name: name,
          p_instagram: null,
          p_cpf: null,
          p_email: null,
          p_source: "prize_wheel",
        });
      } catch (_) { /* não bloqueia o giro */ }

      try {
        const { data: existingLead } = await supabase
          .from("event_leads")
          .select("id")
          .eq("event_id", wheel.event_id)
          .eq("phone", phone)
          .maybeSingle();
        if (!existingLead) {
          await supabase.from("event_leads").insert({
            event_id: wheel.event_id,
            name,
            phone,
            phone_suffix: suffix8(phone),
            source: "prize_wheel",
          });
        }
      } catch (_) { /* idem */ }

      let prizeId: string | null = null;
      let code: string | null = null;
      let expiresAt: string | null = null;

      if (winner.prize_type !== "none") {
        code = couponCode();
        const exp = new Date();
        exp.setDate(exp.getDate() + Number(winner.expiry_days || 30));
        expiresAt = exp.toISOString();

        const { data: prize, error: prizeErr } = await supabase
          .from("customer_prizes")
          .insert({
            customer_phone: phone,
            customer_name: name,
            event_id: wheel.event_id,
            wheel_id: wheel.id,
            event_segment_id: winner.id,
            prize_label: winner.label,
            prize_type: winner.prize_type,
            prize_value: Number(winner.prize_value || 0),
            coupon_code: code,
            expires_at: expiresAt,
            source: "event_wheel",
          })
          .select("id")
          .maybeSingle();
        if (prizeErr) console.error("[event-prize-wheel] prize insert", prizeErr.message);
        prizeId = prize?.id || null;
      }

      await supabase.from("event_prize_spins").insert({
        wheel_id: wheel.id,
        event_id: wheel.event_id,
        phone,
        phone_suffix: suffix8(phone),
        customer_name: name,
        segment_id: winner.id,
        prize_id: prizeId,
        prize_label: winner.label,
      });

      return json({
        ok: true,
        index: idx,
        prize: {
          label: winner.label,
          prize_type: winner.prize_type,
          prize_value: Number(winner.prize_value || 0),
          coupon_code: code,
          expires_at: expiresAt,
        },
      });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    console.error("[event-prize-wheel]", e);
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});
