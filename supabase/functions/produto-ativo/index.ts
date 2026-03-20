import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const url = new URL(req.url);
    const eventoId = url.searchParams.get("evento_id");

    if (!eventoId) {
      return new Response(
        JSON.stringify({ error: "evento_id é obrigatório" }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get event's linked catalog page
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("catalog_lead_page_id, name")
      .eq("id", eventoId)
      .single();

    if (eventErr || !event) {
      return new Response(
        JSON.stringify({ error: "Evento não encontrado" }),
        { status: 404, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    if (!event.catalog_lead_page_id) {
      return new Response(
        JSON.stringify({
          evento: event.name,
          produto_ativo: null,
          todos_produtos: [],
          message: "Nenhuma página de catálogo vinculada a este evento",
        }),
        { status: 200, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    // 2. Get catalog page with selected products
    const { data: page, error: pageErr } = await supabase
      .from("catalog_lead_pages")
      .select("selected_product_ids, title, slug")
      .eq("id", event.catalog_lead_page_id)
      .single();

    if (pageErr || !page) {
      return new Response(
        JSON.stringify({ error: "Página de catálogo não encontrada" }),
        { status: 404, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    const selectedIds: string[] = (page as any).selected_product_ids || [];

    return new Response(
      JSON.stringify({
        evento: event.name,
        catalogo: { titulo: page.title, slug: page.slug },
        produto_ativo_id: selectedIds.length > 0 ? selectedIds[0] : null,
        todos_produto_ids: selectedIds,
        total_produtos: selectedIds.length,
      }),
      { status: 200, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
