// POS Customer 360° AI Insights
// Generates a concise sales playbook for a customer based on purchase history
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SaleItem { product_name: string; size?: string | null; quantity: number; unit_price: number }
interface Sale { created_at: string; total: number; status: string; payment_method?: string | null; pos_sale_items?: SaleItem[] }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { customer, sales, cashbacks } = await req.json() as {
      customer: { name?: string | null; age_range?: string | null; preferred_style?: string | null; shoe_size?: string | null; gender?: string | null; city?: string | null };
      sales: Sale[];
      cashbacks: { coupon_code: string; cashback_amount: number; expires_at: string; is_used: boolean }[];
    };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Compact summary to keep tokens low
    const summary = {
      perfil: customer,
      total_compras: sales.length,
      ltv: sales.reduce((a, s) => a + Number(s.total || 0), 0),
      ultimas_compras: sales.slice(0, 10).map(s => ({
        data: s.created_at?.slice(0, 10),
        total: s.total,
        status: s.status,
        pagamento: s.payment_method,
        itens: (s.pos_sale_items || []).slice(0, 6).map(i => `${i.quantity}x ${i.product_name}${i.size ? " ("+i.size+")" : ""}`),
      })),
      cashbacks_ativos: cashbacks.filter(c => !c.is_used && new Date(c.expires_at) > new Date()).map(c => c.coupon_code),
    };

    const prompt = `Você é Bia, vendedora sênior da Banana Calçados. Analise o histórico do cliente e devolva um playbook DIRETO AO PONTO em JSON com as chaves:
{
  "resumo": "1 linha sobre o cliente (perfil de compra)",
  "tamanho_preferido": "número ou faixa",
  "categorias_favoritas": ["...", "..."],
  "ticket_medio_perfil": "baixo/medio/alto",
  "frequencia": "ocasional/recorrente/vip",
  "proxima_acao": "1 ação concreta de venda",
  "alertas": ["pontos de atenção, no máx 2"]
}
Responda APENAS o JSON puro, sem markdown.

DADOS: ${JSON.stringify(summary)}`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é Bia, assistente de vendas da Banana Calçados. Direto ao ponto, máx 2 linhas por campo." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (r.status === 429) return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (r.status === 402) return new Response(JSON.stringify({ error: "credits_exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: "ai_error", details: t }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content || "{}";
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    let insights;
    try { insights = JSON.parse(cleaned); } catch { insights = { resumo: cleaned }; }

    return new Response(JSON.stringify({ insights }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
