import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();

    // Support single comment or batch
    const comments: Array<{
      event_id: string;
      username: string;
      comment_text: string;
      profile_pic_url?: string;
      timestamp?: string;
      source_pc?: string;
    }> = Array.isArray(body) ? body : [body];

    if (!comments.length) {
      return new Response(JSON.stringify({ error: "No comments provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = [];

    for (const comment of comments) {
      if (!comment.event_id || !comment.username || !comment.comment_text) {
        results.push({ status: "skipped", reason: "missing fields" });
        continue;
      }

      // Generate dedup hash: username + text + first 10 chars of timestamp
      const rawId = `${comment.username}|${comment.comment_text}|${(comment.timestamp || "").slice(0, 10)}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(rawId);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const commentId = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);

      // Insert with ON CONFLICT DO NOTHING (dedup)
      const { data: inserted, error } = await supabase
        .from("live_comments")
        .insert({
          event_id: comment.event_id,
          comment_id: commentId,
          username: comment.username,
          comment_text: comment.comment_text,
          profile_pic_url: comment.profile_pic_url || null,
          source_pc: comment.source_pc || null,
          raw_timestamp: comment.timestamp || null,
        })
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505") {
          // Duplicate — already processed
          results.push({ status: "duplicate", comment_id: commentId });
          continue;
        }
        results.push({ status: "error", error: error.message });
        continue;
      }

      // Quick classification: check if comment looks like an order
      const classification = classifyComment(comment.comment_text, comment.username);

      // Update with classification
      await supabase
        .from("live_comments")
        .update({
          is_order: classification.is_order,
          ai_classification: classification.type,
          ai_confidence: classification.confidence,
        })
        .eq("id", inserted.id);

      results.push({
        status: "inserted",
        id: inserted.id,
        comment_id: commentId,
        classification: classification.type,
        is_order: classification.is_order,
      });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Rule-based quick classifier for live comments.
 * Detects order patterns like "eu quero", "34", "manda pix", shoe sizes, etc.
 */
function classifyComment(text: string, username: string): {
  is_order: boolean;
  type: string;
  confidence: number;
} {
  const lower = text.toLowerCase().trim();

  // Spam / irrelevant
  if (lower.length < 2) {
    return { is_order: false, type: "spam", confidence: 0.9 };
  }

  // Strong order signals
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

  // Pure number (shoe size): 33-45
  const pureNumber = /^\d{2}$/.test(lower);
  if (pureNumber) {
    const num = parseInt(lower);
    if (num >= 30 && num <= 46) {
      return { is_order: true, type: "order", confidence: 0.85 };
    }
  }

  for (const pattern of orderPatterns) {
    if (pattern.test(lower)) {
      return { is_order: true, type: "order", confidence: 0.8 };
    }
  }

  // Question patterns
  const questionPatterns = [
    /\?$/,
    /\btem\b.*\b(estoque|tamanho)\b/i,
    /\bqual\b/i,
    /\bquanto\b/i,
    /\bcomo\b/i,
    /\bonde\b/i,
  ];

  for (const pattern of questionPatterns) {
    if (pattern.test(lower)) {
      return { is_order: false, type: "question", confidence: 0.7 };
    }
  }

  // Engagement (emojis, short messages)
  if (/^[❤️🔥😍👏💕💖🥰😻✨💯👑]+$/u.test(lower) || lower.length <= 5) {
    return { is_order: false, type: "engagement", confidence: 0.8 };
  }

  return { is_order: false, type: "comment", confidence: 0.5 };
}
