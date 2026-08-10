// Sorteios do Evento (painel interno).
// Diferente da Roleta: um pool de participantes concorre a N prêmios, sorteado pela equipe.
// Públicos: confirmed_orders | payers | live_leads.
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

const CONFIRMED_STAGES = [
  "new",
  "awaiting_payment",
  "paid",
  "awaiting_shipping",
  "awaiting_mototaxi",
  "awaiting_pickup",
  "shipped",
  "completed",
];

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
  let code = "SR-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** Índice aleatório criptográfico, sem viés relevante para pools pequenos. */
function randomInt(max: number) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

interface PoolEntry {
  phone: string;
  display_name: string | null;
  order_id: string | null;
  entry_value: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(
    authHeader.replace("Bearer ", ""),
  );
  if (claimsError || !claimsData?.claims) return json({ ok: false, error: "unauthorized" }, 401);
  const userId = claimsData.claims.sub as string;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    const action = String(body?.action || "");

    /** Monta o pool de participantes conforme a configuração do sorteio. */
    async function buildPool(raffle: any): Promise<PoolEntry[]> {
      const eventId = raffle.event_id as string;
      const minValue = Number(raffle.min_purchase_value || 0);

      const { data: orders } = await supabase
        .from("orders")
        .select("id, stage, is_paid, paid_externally, products, customer_id, customer:customers(instagram_handle, whatsapp)")
        .eq("event_id", eventId)
        .neq("stage", "cancelled")
        .limit(5000);

      const orderTotal = (o: any) => {
        const items = Array.isArray(o.products) ? o.products : [];
        return items.reduce(
          (s: number, p: any) => s + Number(p.price || 0) * Number(p.quantity || 1),
          0,
        );
      };

      const byPhone = new Map<string, PoolEntry>();
      const orderPhones = new Set<string>();

      for (const o of orders || []) {
        const cust = (o as any).customer;
        const phone = normalizePhone(cust?.whatsapp || "");
        if (!phone) continue;
        const key = suffix8(phone);
        orderPhones.add(key);

        const paid = Boolean(o.is_paid || o.paid_externally);
        const confirmed = CONFIRMED_STAGES.includes(String(o.stage || ""));

        if (raffle.audience === "confirmed_orders" && !confirmed) continue;
        if (raffle.audience === "payers" && !paid) continue;
        if (raffle.audience === "live_leads") continue;

        const value = orderTotal(o);
        const prev = byPhone.get(key);
        if (prev) {
          prev.entry_value += value;
        } else {
          byPhone.set(key, {
            phone,
            display_name: cust?.instagram_handle || null,
            order_id: o.id,
            entry_value: value,
          });
        }
      }

      if (raffle.audience === "live_leads") {
        const { data: leads } = await supabase
          .from("event_leads")
          .select("name, phone, phone_suffix, instagram, disqualified")
          .eq("event_id", eventId)
          .limit(5000);
        for (const l of leads || []) {
          if (l.disqualified) continue;
          const phone = normalizePhone(l.phone || "");
          if (!phone) continue;
          const key = suffix8(phone);
          if (orderPhones.has(key)) continue; // já montou pedido no evento
          if (byPhone.has(key)) continue;
          byPhone.set(key, {
            phone,
            display_name: l.instagram || l.name || null,
            order_id: null,
            entry_value: 0,
          });
        }
      } else if (minValue > 0) {
        for (const [k, v] of [...byPhone.entries()]) {
          if (v.entry_value < minValue) byPhone.delete(k);
        }
      }

      if (raffle.exclude_previous_winners) {
        const { data: prevRaffles } = await supabase
          .from("event_raffles")
          .select("id")
          .eq("event_id", eventId)
          .neq("id", raffle.id);
        const ids = (prevRaffles || []).map((r: any) => r.id);
        if (ids.length) {
          const { data: winners } = await supabase
            .from("event_raffle_winners")
            .select("phone, voided_at")
            .in("raffle_id", ids);
          for (const w of winners || []) {
            if (w.voided_at) continue;
            byPhone.delete(suffix8(w.phone));
          }
        }
      }

      return [...byPhone.values()];
    }

    async function getRaffle(id: string) {
      const { data } = await supabase.from("event_raffles").select("*").eq("id", id).maybeSingle();
      return data;
    }

    // ---------- PREVIEW ----------
    if (action === "preview") {
      const raffle = body?.raffle_id ? await getRaffle(body.raffle_id) : body?.raffle;
      if (!raffle) return json({ ok: false, error: "raffle_not_found" }, 404);
      const pool = await buildPool(raffle);
      return json({ ok: true, count: pool.length, participants: pool.slice(0, 300) });
    }

    // ---------- DRAW ----------
    if (action === "draw") {
      const raffle = await getRaffle(String(body?.raffle_id || ""));
      if (!raffle) return json({ ok: false, error: "raffle_not_found" }, 404);
      if (raffle.status !== "draft") return json({ ok: false, error: "already_drawn" }, 409);

      const pool = await buildPool(raffle);
      if (!pool.length) return json({ ok: false, error: "empty_pool" }, 400);

      const { data: claimed } = await supabase.rpc("claim_event_raffle_draw", {
        _raffle_id: raffle.id,
      });
      if (!claimed) return json({ ok: false, error: "already_drawn" }, 409);

      await supabase.from("event_raffles").update({ drawn_by: userId }).eq("id", raffle.id);

      const { data: entries } = await supabase
        .from("event_raffle_entries")
        .insert(
          pool.map((p) => ({
            raffle_id: raffle.id,
            phone: p.phone,
            phone_suffix: suffix8(p.phone),
            display_name: p.display_name,
            order_id: p.order_id,
            entry_value: p.entry_value,
          })),
        )
        .select("id, phone, display_name");

      const remaining = [...(entries || [])];
      const winnersCount = Math.min(Number(raffle.winners_count || 1), remaining.length);
      const winners: any[] = [];

      for (let i = 0; i < winnersCount; i++) {
        const idx = randomInt(remaining.length);
        const picked = remaining.splice(idx, 1)[0];

        let customerPrizeId: string | null = null;
        const isCoupon = ["discount_percent", "discount_fixed", "free_shipping"].includes(
          String(raffle.prize_type),
        );
        const expiresAt = new Date(
          Date.now() + Number(raffle.expiry_days || 30) * 86400_000,
        ).toISOString();

        const { data: prize } = await supabase
          .from("customer_prizes")
          .insert({
            customer_phone: picked.phone,
            customer_name: picked.display_name,
            prize_label: raffle.prize_label,
            prize_type: raffle.prize_type,
            prize_value: raffle.prize_value,
            coupon_code: isCoupon ? couponCode() : null,
            expires_at: isCoupon ? expiresAt : null,
            source: "event_raffle",
            event_id: raffle.event_id,
            fulfillment_status: raffle.prize_type === "product" ? "available" : null,
            notes: `Sorteio: ${raffle.name}`,
          })
          .select("id")
          .maybeSingle();
        customerPrizeId = prize?.id || null;

        const { data: winner } = await supabase
          .from("event_raffle_winners")
          .insert({
            raffle_id: raffle.id,
            entry_id: picked.id,
            phone: picked.phone,
            display_name: picked.display_name,
            position: i + 1,
            customer_prize_id: customerPrizeId,
          })
          .select("*")
          .maybeSingle();
        if (winner) winners.push(winner);
      }

      return json({
        ok: true,
        winners,
        pool: (entries || []).map((e: any) => ({ id: e.id, display_name: e.display_name })),
        total: pool.length,
      });
    }

    // ---------- VOID ----------
    if (action === "void") {
      const raffleId = String(body?.raffle_id || "");
      const { data: winners } = await supabase
        .from("event_raffle_winners")
        .select("id, customer_prize_id")
        .eq("raffle_id", raffleId)
        .is("voided_at", null);

      for (const w of winners || []) {
        if (w.customer_prize_id) {
          await supabase
            .from("customer_prizes")
            .update({ fulfillment_status: "forfeited", forfeited_at: new Date().toISOString(), forfeit_reason: "Sorteio anulado" })
            .eq("id", w.customer_prize_id);
        }
      }
      await supabase
        .from("event_raffle_winners")
        .update({ voided_at: new Date().toISOString() })
        .eq("raffle_id", raffleId)
        .is("voided_at", null);
      await supabase.from("event_raffles").update({ status: "draft", drawn_at: null }).eq("id", raffleId);
      await supabase.from("event_raffle_entries").delete().eq("raffle_id", raffleId);

      return json({ ok: true });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    console.error("event-raffle error", e);
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});
