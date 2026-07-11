// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { globalIgToken } from "../_shared/instagram-account.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_HOSTS = [
  "https://graph.facebook.com/v25.0",
  "https://graph.instagram.com/v25.0",
];

interface IgAccountRow {
  id: string;
  label: string | null;
  instagram_account_id: string | null;
  instagram_username: string | null;
  access_token: string | null;
}

interface GraphComment {
  id: string;
  text?: string | null;
  timestamp?: string | null;
  username?: string | null;
  from?: { id?: string | null; username?: string | null } | null;
}

interface LiveMediaItem {
  id: string;
  media_type?: string | null;
  media_product_type?: string | null;
  username?: string | null;
  comments?: {
    data?: GraphComment[];
    paging?: { next?: string };
  };
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeUsername(value: string | null | undefined): string | null {
  const clean = String(value || "").replace(/^@+/, "").trim().toLowerCase();
  return clean || null;
}

function parseTimestamp(value: string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function classifyComment(text: string): { is_order: boolean; type: string; confidence: number } {
  const lower = text.toLowerCase().trim();
  if (lower.length < 2) return { is_order: false, type: "spam", confidence: 0.9 };

  const pureNumber = /^\d{2}$/.test(lower);
  if (pureNumber) {
    const n = Number(lower);
    if (n >= 30 && n <= 46) return { is_order: true, type: "order", confidence: 0.85 };
  }

  const orderPatterns = [
    /\beu\s*quero\b/i,
    /\bquero\b/i,
    /\bmanda?\s*(pix|link|boleto)\b/i,
    /\bpix\b/i,
    /\bpedido\b/i,
    /\bcomprar\b/i,
    /\bquero\s*esse\b/i,
    /\bmeu\s*(?:numero|número|tamanho|tam)\b/i,
    /\btamanho\s*\d/i,
    /\btam\s*\d/i,
    /\b(?:n[uú]mero|n[º°]?)\s*\d{2}\b/i,
  ];
  if (orderPatterns.some((p) => p.test(lower))) {
    return { is_order: true, type: "order", confidence: 0.8 };
  }

  const questionPatterns = [/\?$/, /\btem\b.*\b(estoque|tamanho)\b/i, /\bqual\b/i, /\bquanto\b/i, /\bcomo\b/i, /\bonde\b/i];
  if (questionPatterns.some((p) => p.test(lower))) return { is_order: false, type: "question", confidence: 0.7 };

  if (/^[❤️🔥😍👏💕💖🥰😻✨💯👑]+$/u.test(lower) || lower.length <= 5) {
    return { is_order: false, type: "engagement", confidence: 0.8 };
  }
  return { is_order: false, type: "comment", confidence: 0.5 };
}

async function graphJson(url: string): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const res = await fetch(url);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, text };
}

async function fetchAllComments(firstPage: LiveMediaItem["comments"]): Promise<GraphComment[]> {
  const out: GraphComment[] = Array.isArray(firstPage?.data) ? [...firstPage!.data!] : [];
  let next = firstPage?.paging?.next || null;
  let pages = 0;
  while (next && pages < 10) {
    pages += 1;
    const res = await graphJson(next);
    if (!res.ok) break;
    if (Array.isArray(res.data?.data)) out.push(...res.data.data);
    next = res.data?.paging?.next || null;
  }
  return out;
}

async function fetchLiveMediaForAccount(account: IgAccountRow, token: string) {
  const accountId = account.instagram_account_id;
  if (!accountId || !token) return { media: [] as LiveMediaItem[], errors: [] as string[] };

  const fields = [
    "id",
    "media_type",
    "media_product_type",
    "username",
    "comments.limit(100){id,text,timestamp,username,from,media,hidden}",
  ].join(",");

  const candidatePaths = [
    `/${encodeURIComponent(accountId)}/live_media`,
    "/me/live_media",
  ];
  const errors: string[] = [];

  for (const host of GRAPH_HOSTS) {
    for (const path of candidatePaths) {
      const url = `${host}${path}?fields=${encodeURIComponent(fields)}&limit=10&access_token=${encodeURIComponent(token)}`;
      const res = await graphJson(url);
      if (res.ok) {
        return {
          media: Array.isArray(res.data?.data) ? res.data.data as LiveMediaItem[] : [],
          errors,
        };
      }
      const message = res.data?.error?.message || res.text.slice(0, 180);
      errors.push(`${host}${path} [${res.status}]: ${message}`);
    }
  }
  return { media: [] as LiveMediaItem[], errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const eventId = typeof body.eventId === "string" ? body.eventId : null;

    const eventQuery = supabase
      .from("events")
      .select("id, name, live_active_until")
      .order("live_active_until", { ascending: false })
      .limit(1);

    const { data: event, error: eventError } = eventId
      ? await supabase.from("events").select("id, name, live_active_until").eq("id", eventId).maybeSingle()
      : await eventQuery.gt("live_active_until", new Date().toISOString()).maybeSingle();

    if (eventError) return json({ error: "event_lookup_failed", details: eventError.message }, 500);
    if (!event?.id) return json({ error: "active_live_event_not_found" }, 404);

    const { data: accounts, error: accountsError } = await supabase
      .from("whatsapp_numbers")
      .select("id, label, instagram_account_id, instagram_username, access_token")
      .eq("provider", "instagram")
      .eq("is_active", true)
      .not("instagram_account_id", "is", null);

    if (accountsError) return json({ error: "instagram_accounts_lookup_failed", details: accountsError.message }, 500);

    const rows = (accounts || []) as IgAccountRow[];
    if (rows.length === 0) return json({ error: "no_instagram_accounts_configured" }, 404);

    const liveRows: any[] = [];
    const messageRows: any[] = [];
    const linkRows: any[] = [];
    const scanned: any[] = [];
    const errors: string[] = [];

    for (const account of rows) {
      const token = account.access_token || globalIgToken();
      const result = await fetchLiveMediaForAccount(account, token);
      errors.push(...result.errors);
      scanned.push({
        account: account.instagram_username || account.label || account.instagram_account_id,
        live_media_count: result.media.length,
      });

      for (const media of result.media) {
        const comments = await fetchAllComments(media.comments);
        for (const c of comments) {
          if (!c?.id) continue;
          const username = normalizeUsername(c.username || c.from?.username);
          const text = String(c.text || "").trim();
          if (!username || !text) continue;

          const createdAt = parseTimestamp(c.timestamp);
          const cls = classifyComment(text);
          liveRows.push({
            event_id: event.id,
            comment_id: c.id,
            username,
            comment_text: text,
            raw_timestamp: createdAt,
            created_at: createdAt,
            source_pc: "meta-live-media-sync",
            is_order: cls.is_order,
            ai_classification: cls.type,
            ai_confidence: cls.confidence,
          });

          messageRows.push({
            phone: c.from?.id || c.id,
            message: `💬 Comentário no Live: ${text}`,
            direction: "incoming",
            message_id: c.id,
            status: "received",
            media_type: "text",
            is_group: false,
            channel: "instagram",
            sender_name: `@${username}`,
            whatsapp_number_id: account.id,
            created_at: createdAt,
          });

          if (c.from?.id) {
            linkRows.push({ username, ig_user_id: c.from.id, source: "live_media_sync" });
          }
        }
      }
    }

    const uniqueLive = Array.from(new Map(liveRows.map((r) => [`${r.event_id}:${r.comment_id}`, r])).values());
    const uniqueMessages = Array.from(new Map(messageRows.map((r) => [`${r.channel}:${r.message_id}`, r])).values());
    const uniqueLinks = Array.from(new Map(linkRows.map((r) => [r.username, r])).values());

    let insertedLive = 0;
    let insertedMessages = 0;

    if (uniqueLive.length > 0) {
      const { data, error } = await supabase
        .from("live_comments")
        .upsert(uniqueLive, { onConflict: "event_id,comment_id", ignoreDuplicates: true })
        .select("id");
      if (error) return json({ error: "live_comments_upsert_failed", details: error.message }, 500);
      insertedLive = data?.length || 0;
    }

    if (uniqueMessages.length > 0) {
      // A constraint de whatsapp_messages já bloqueia duplicados por canal+message_id.
      // Inserimos um a um para ignorar comentários que já chegaram via webhook comum.
      for (const row of uniqueMessages) {
        const { error } = await supabase.from("whatsapp_messages").insert(row);
        if (!error) {
          insertedMessages += 1;
        } else if ((error as any).code !== "23505") {
          console.warn("[instagram-live-sync] whatsapp_messages insert failed:", error.message);
        }
      }
    }

    if (uniqueLinks.length > 0) {
      await supabase
        .from("instagram_user_links")
        .upsert(uniqueLinks, { onConflict: "username", ignoreDuplicates: false });
    }

    return json({
      ok: true,
      event_id: event.id,
      event_name: event.name,
      scanned,
      comments_found: uniqueLive.length,
      live_comments_inserted: insertedLive,
      whatsapp_messages_inserted: insertedMessages,
      provider_errors: errors.slice(0, 4),
    });
  } catch (err) {
    console.error("instagram-live-sync error:", err);
    return json({ error: "internal_error", details: (err as Error).message }, 500);
  }
});