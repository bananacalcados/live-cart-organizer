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
    const { store_id, parent_code, product_name, items } = await req.json();

    if (!store_id || !parent_code || !product_name || !items?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the store's Tiny token
    const { data: store } = await supabase
      .from("pos_stores")
      .select("tiny_token")
      .eq("id", store_id)
      .single();

    const tinyToken = store?.tiny_token || Deno.env.get("TINY_ERP_TOKEN");
    if (!tinyToken) {
      return new Response(JSON.stringify({ error: "Token do Tiny não configurado" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Deduplicate items by size+color, summing quantities
    const mergedMap = new Map<string, any>();
    for (const item of items) {
      const size = item.size || "Único";
      const color = item.color || "Única";
      const key = `${size}|${color}`;
      if (mergedMap.has(key)) {
        const existing = mergedMap.get(key);
        existing.quantity = (existing.quantity || 1) + (item.quantity || 1);
        // Keep the first barcode as primary
        if (!existing.ids) existing.ids = [existing.id];
        if (item.id) existing.ids.push(item.id);
      } else {
        mergedMap.set(key, { ...item, size, color, ids: item.id ? [item.id] : [] });
      }
    }
    const mergedItems = [...mergedMap.values()];

    // Build variations array
    const variacoes = mergedItems.map((item: any) => ({
      variacao: {
        codigo: item.barcode,
        gtin: item.barcode,
        preco: item.price || 0,
        estoque_atual: item.quantity || 0,
        grade: { Tamanho: item.size, Cor: item.color },
      },
    }));

    // Build Tiny product payload
    const produto = {
      produtos: [
        {
          produto: {
            sequencia: 1,
            codigo: parent_code,
            nome: product_name,
            situacao: "A", // Active
            tipo: "P", // Produto
            classe_produto: "V", // Com variações
            origem: "0", // Nacional
            unidade: "UN",
            preco: items[0]?.price || 0,
            variacoes,
          },
        },
      ],
    };

    // Call Tiny API
    const formData = new URLSearchParams();
    formData.append("token", tinyToken);
    formData.append("formato", "JSON");
    formData.append("produto", JSON.stringify(produto));

    const tinyRes = await fetch("https://api.tiny.com.br/api2/produto.incluir.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    const tinyData = await tinyRes.json();
    console.log("Tiny response:", JSON.stringify(tinyData));

    if (tinyData.retorno?.status === "Erro") {
      const erros = tinyData.retorno?.registros?.[0]?.registro?.erros ||
        tinyData.retorno?.erros || [];
      const errorMsg = Array.isArray(erros)
        ? erros.map((e: any) => e.erro || e).join("; ")
        : JSON.stringify(erros);
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Extract the product ID from the response
    const registro = tinyData.retorno?.registros?.[0]?.registro;
    const tinyProductId = registro?.id || null;

    // Update capture items with the Tiny product ID
    if (tinyProductId) {
      for (const item of mergedItems) {
        const allIds = item.ids || (item.id ? [item.id] : []);
        for (const id of allIds) {
          await supabase
            .from("product_capture_items")
            .update({ tiny_product_id: tinyProductId })
            .eq("id", id);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        tiny_product_id: tinyProductId,
        tiny_response: tinyData.retorno,
      }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
