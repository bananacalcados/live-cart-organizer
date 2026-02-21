import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id, parent_code, product_name, items } = await req.json();

    if (!store_id || !parent_code || !product_name || !items?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build variations array
    const variacoes = items.map((item: any) => {
      const grade: Record<string, string> = {};
      if (item.size) grade["Tamanho"] = item.size;
      if (item.color) grade["Cor"] = item.color;

      return {
        variacao: {
          codigo: item.barcode,
          gtin: item.barcode,
          preco: item.price || 0,
          estoque_atual: item.quantity || 0,
          grade: Object.keys(grade).length > 0 ? grade : { Tamanho: "Único" },
        },
      };
    });

    // Build Tiny product payload
    const produto = {
      produtos: [
        {
          produto: {
            codigo: parent_code,
            nome: product_name,
            situacao: "A", // Active
            tipo: "P", // Produto
            classe_produto: "V", // Com variações
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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract the product ID from the response
    const registro = tinyData.retorno?.registros?.[0]?.registro;
    const tinyProductId = registro?.id || null;

    // Update capture items with the Tiny product ID
    if (tinyProductId) {
      for (const item of items) {
        if (item.id) {
          await supabase
            .from("product_capture_items")
            .update({ tiny_product_id: tinyProductId })
            .eq("id", item.id);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        tiny_product_id: tinyProductId,
        tiny_response: tinyData.retorno,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
