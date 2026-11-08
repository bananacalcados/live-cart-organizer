import { withAccessLog } from "../_shared/withAccessLog.ts";
// Worker da moderação de comentários do Instagram.
// Acordado pelo webhook a cada comentário novo (sem rotina agendada).
// Classifica com IA (1 chamada por comentário), oculta e manda a resposta privada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import { resolveIgAccountByAccountId } from "../_shared/instagram-account.ts";
import {
  buildPrivateReply, decideModeration, firstName, isRateLimitError, normalizeClass, skipReason,
} from "../_shared/ig-moderation-rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const AI_MODEL = "google/gemini-2.5-flash";
const TRACK_BASE = "https://checkout.bananacalcados.com.br/rastreio/";
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SYSTEM = `Você modera comentários do Instagram da loja de calçados Banana Calçados (produtos originais, com nota fiscal, garantia e devolução no prazo).
Classifique o comentário em UMA classe:
- pedido_rastreio: pedido não chegou, atraso, cadê meu pedido, não respondem no WhatsApp/direct.
- acusacao: diz que é falso, réplica, golpe, produto ruim, deprecia a marca.
- ofensa_spam: palavrão, ofensa, golpista oferecendo produto/link, perfil divulgando outra loja.
- duvida: pergunta neutra ("é original?", "tem garantia?", "tem nota?") sem tom de acusação.
- neutro_positivo: elogio, marcação de amigos, perguntas de tamanho/preço, qualquer outra coisa.
Na dúvida entre acusacao e duvida, prefira duvida e use confiança baixa.
Responda com confidence entre 0 e 1 e reason curta (até 12 palavras, em português).`;

async function classify(text: string, caption: string | null, isCustomer: boolean) {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY ausente");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Legenda do post: ${(caption || "(sem legenda)").slice(0, 600)}\nAutor é cliente cadastrada: ${isCustomer ? "sim" : "não"}\nComentário: ${text.slice(0, 1000)}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "moderacao",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["class", "confidence", "reason"],
            properties: {
              class: { type: "string", enum: ["pedido_rastreio", "acusacao", "ofensa_spam", "duvida", "neutro_positivo"] },
              confidence: { type: "number" },
              reason: { type: "string" },
            },
          },
        },
      },
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    const err: any = new Error(`IA [${res.status}]: ${bodyText.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const content = JSON.parse(bodyText)?.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(String(content).replace(/^```json\s*|```$/g, ""));
  return { raw: parsed.class, cls: normalizeClass(parsed.class), confidence: Number(parsed.confidence) || 0, reason: String(parsed.reason || "").slice(0, 200) };
}

Deno.serve(withAccessLog("ig-comment-moderate", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await isAuthorizedCron(req))) return unauthorizedResponse(corsHeaders);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: settings } = await sb.from("ig_moderation_settings").select("*").maybeSingle();
  if (!settings) return json({ ok: false, error: "sem configuração" });
  if (settings.paused_until && new Date(settings.paused_until) > new Date()) return json({ ok: true, paused_until: settings.paused_until });

  const { data: rows, error } = await sb.rpc("ig_moderation_claim", { p_limit: 30 });
  if (error) return json({ ok: false, error: error.message }, 500);

  const out = { claimed: rows?.length || 0, hidden: 0, kept: 0, skipped: 0, failed: 0 };
  let paused = false;

  for (const row of rows || []) {
    if (paused) {
      await sb.from("ig_comment_moderation").update({ status: "pending", attempts: Math.max(0, row.attempts - 1) }).eq("id", row.id);
      continue;
    }
    try {
      const acc = await resolveIgAccountByAccountId(sb, row.ig_account_id);
      const token = acc.accessToken;

      // Contexto do post (1 leitura).
      let media: any = null;
      try {
        const r = await fetch(`https://graph.instagram.com/v25.0/${row.comment_id}?fields=media{id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink}&access_token=${encodeURIComponent(token)}`);
        const b = await r.json();
        if (r.ok) media = b.media || null;
        else if (isRateLimitError(b)) throw Object.assign(new Error("rate_limit"), { rate: true });
      } catch (e) { if ((e as any).rate) throw e; }

      const productType = media?.media_product_type || row.media_product_type || null;
      const { count: liveCopies } = await sb.from("live_comments").select("id", { count: "exact", head: true }).eq("comment_id", row.comment_id);
      const skip = skipReason({
        isLive: String(productType || "").toUpperCase() === "LIVE",
        copiedToLive: (liveCopies || 0) > 0,
        username: row.username, fromId: row.from_id, accountId: row.ig_account_id,
        ownUsernames: [...(settings.own_usernames || []), ...(acc.username ? [acc.username] : [])],
        teamUsernames: settings.team_usernames || [],
      });
      const mediaPatch = {
        media_id: media?.id || row.media_id, media_caption: media?.caption?.slice(0, 2000) || null,
        media_permalink: media?.permalink || null, media_thumb: media?.thumbnail_url || media?.media_url || null,
        media_product_type: productType,
      };
      if (skip) {
        await sb.from("ig_comment_moderation").update({ ...mediaPatch, status: "skipped", skip_reason: skip }).eq("id", row.id);
        out.skipped++; continue;
      }

      // Cliente pelo @ (índice em lower(instagram_handle)).
      const handle = String(row.username || "").replace(/^@/, "").toLowerCase();
      let customer: any = null;
      if (handle) {
        const { data } = await sb.from("customers_unified").select("id, name, phone_e164, phone_suffix8").ilike("instagram_handle", handle).limit(1).maybeSingle();
        customer = data;
      }

      const ai = await classify(row.text_original, media?.caption || null, !!customer);
      if (!ai.cls) throw new Error(`classe inválida: ${ai.raw}`);
      const d = decideModeration(ai.cls, ai.confidence, settings);

      const patch: Record<string, unknown> = {
        ...mediaPatch, class: d.finalClass, ai_class_raw: ai.raw, confidence: ai.confidence, reason: ai.reason,
        ai_model: AI_MODEL, classified_at: new Date().toISOString(),
        customer_id: customer?.id || null, customer_name: customer?.name || null, customer_phone: customer?.phone_e164 || null,
        status: "kept",
      };
      if (d.suggestPublicReply) patch.suggested_reply = settings.public_reply_template;

      if (d.hide) {
        const r = await fetch(`https://graph.instagram.com/v25.0/${row.comment_id}?hide=true&access_token=${encodeURIComponent(token)}`, { method: "POST" });
        const b = await r.json().catch(() => ({}));
        patch.hide_response = JSON.stringify(b).slice(0, 500);
        if (r.ok && b?.success !== false) { patch.hidden_at = new Date().toISOString(); patch.status = "hidden"; }
        else if (isRateLimitError(b)) throw Object.assign(new Error("rate_limit"), { rate: true });
        else patch.status = "failed";
      }
      if (d.toContact) patch.contact_status = "a_contatar";
      await sb.from("ig_comment_moderation").update(patch).eq("id", row.id);

      // Resposta privada: reserva condicional para nunca enviar duas vezes.
      if (d.privateReply && patch.status === "hidden") {
        const { data: reserved } = await sb.from("ig_comment_moderation")
          .update({ private_reply_error: "enviando" })
          .eq("id", row.id).is("private_reply_sent_at", null).is("private_reply_error", null).select("id");
        if (reserved?.length) {
          let trackingUrl: string | null = null;
          if (customer?.phone_suffix8) {
            const { data: sales } = await sb.from("pos_sales").select("id").eq("phone_suffix8", customer.phone_suffix8)
              .neq("sales_channel", "presencial").order("created_at", { ascending: false }).limit(5);
            const ids = (sales || []).map((s: any) => s.id);
            if (ids.length) {
              const { data: sim } = await sb.from("shipment_simulations").select("tracking_code").in("sale_id", ids)
                .is("merged_into_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
              if (sim?.tracking_code) trackingUrl = TRACK_BASE + sim.tracking_code;
            }
          }
          const msg = buildPrivateReply(settings.private_reply_template, settings.private_reply_tracking_suffix,
            firstName(customer?.name, row.username), trackingUrl);
          const r = await fetch("https://graph.instagram.com/v25.0/me/messages", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ recipient: { comment_id: row.comment_id }, message: { text: msg } }),
          });
          const b = await r.json().catch(() => ({}));
          await sb.from("ig_comment_moderation").update(r.ok
            ? { private_reply_sent_at: new Date().toISOString(), private_reply_error: null }
            : { private_reply_error: JSON.stringify(b).slice(0, 500) }).eq("id", row.id);
        }
      }
      if (patch.status === "hidden") out.hidden++; else if (patch.status === "failed") out.failed++; else out.kept++;
    } catch (e) {
      const err = e as any;
      if (err.rate) {
        paused = true;
        await sb.from("ig_moderation_settings").update({ paused_until: new Date(Date.now() + 30 * 60_000).toISOString() }).eq("id", true);
        await sb.from("ig_comment_moderation").update({ status: "pending" }).eq("id", row.id);
        continue;
      }
      // IA sem crédito/negada: pausa a fila inteira em vez de insistir.
      if (err.status === 402 || err.status === 403) {
        paused = true;
        await sb.from("ig_moderation_settings").update({ paused_until: new Date(Date.now() + 6 * 3600_000).toISOString() }).eq("id", true);
      }
      console.error("moderação falhou", row.comment_id, err.message);
      // Falha da IA ou da API nunca oculta: fica como falha (até 3 tentativas).
      await sb.from("ig_comment_moderation").update({
        status: row.attempts >= 3 || err.status === 402 || err.status === 403 ? "failed" : "pending",
        reason: `erro: ${String(err.message).slice(0, 180)}`,
      }).eq("id", row.id);
      out.failed++;
    }
  }
  return json({ ok: true, ...out, paused });
}));
