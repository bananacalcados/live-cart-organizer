import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface MediaItem {
  id: string;
  caption: string | null;
  media_type: string | null;          // IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type: string | null;  // FEED | REELS | STORY | AD
  thumbnail: string | null;
  permalink: string | null;
  timestamp: string | null;
}

const GRAPH = "https://graph.instagram.com/v25.0";

async function fetchEdge(
  edge: "media" | "stories",
  token: string,
): Promise<MediaItem[]> {
  const fields =
    "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";
  const url = `${GRAPH}/me/${edge}?fields=${fields}&limit=50&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    console.warn(`[list-media] ${edge} fetch failed ${res.status}: ${txt.slice(0, 200)}`);
    return [];
  }
  const data = await res.json();
  const items = Array.isArray(data?.data) ? data.data : [];
  return items.map((m: Record<string, unknown>) => ({
    id: String(m.id),
    caption: (m.caption as string) || null,
    media_type: (m.media_type as string) || null,
    media_product_type:
      (m.media_product_type as string) || (edge === "stories" ? "STORY" : null),
    thumbnail: (m.thumbnail_url as string) || (m.media_url as string) || null,
    permalink: (m.permalink as string) || null,
    timestamp: (m.timestamp as string) || null,
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const token = Deno.env.get("META_PAGE_ACCESS_TOKEN");
    if (!token) {
      return new Response(
        JSON.stringify({ error: "META_PAGE_ACCESS_TOKEN não configurado" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch feed/reels and active stories in parallel.
    const [media, stories] = await Promise.all([
      fetchEdge("media", token),
      fetchEdge("stories", token),
    ]);

    // Merge, de-dup by id, newest first.
    const byId = new Map<string, MediaItem>();
    for (const m of [...media, ...stories]) byId.set(m.id, m);
    const all = Array.from(byId.values()).sort((a, b) =>
      (b.timestamp || "").localeCompare(a.timestamp || ""),
    );

    return new Response(JSON.stringify({ media: all }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("instagram-list-media error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
